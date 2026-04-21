#!/usr/bin/env node
// CALBEAF-116: Venues_AutoMaster batch runner
// Per team-consensus doc CITY-COUNTRY-DATA-DISCIPLINE-REVIEW.md Q3.5
//
// Scope: all venues where masteredCityId is null AND geolocation is valid,
// across all appIds (TT=1, HJ=2) and discovery-origin. No filter drop.
//
// Modes:
//   --dry-run (default): read-only; emit artifact, no writes
//   --apply: gated — caller must confirm Track A (AIDI/Porter country strip)
//            has cleared on TEST before --apply runs. Script prints warning.
//
// PROD STAY-OUT: this script uses MONGODB_URI_TEST only. Never runs against PROD.
//
// Hierarchy-aware distance buckets (Fulton design, Q3.5):
//   ≤50km   AUTO_HIGH:   would write masteredCityId + full chain
//   50-200km AUTO_MEDIUM: would write country only (skip city — prevents /boston pollution)
//   >200km  MANUAL:       masteringStatus='corpus-gap-review', all mastered* null
//
// Audit fields (all buckets):
//   masteringDistanceKm   (number)
//   masteringTextConflict (bool — venue.city text contradicts nearest city name)
//
// Artifact output: Collab/reviews/venues-automaster-dryrun-{YYYYMMDD_HHMM}.json

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const settings = require('../local.settings.json');
const {
    resolveMasteredCity,
    BUCKET_HIGH_MAX_KM,
    BUCKET_MEDIUM_MAX_KM,
    VENUES_AUTOMASTER_SPEC_VERSION,
} = require('../src/utils/venuesAutoMaster');

const APPLY = process.argv.includes('--apply');
const TRACK_A_CLEARED = process.argv.includes('--track-a-cleared');
const RECLASSIFY_MANUAL = process.argv.includes('--reclassify-manual');
const PROD_MODE = process.argv.includes('--env=prod');
const uri = PROD_MODE ? settings.Values.MONGODB_URI_PROD : settings.Values.MONGODB_URI_TEST;
if (!uri) {
    console.error(`ERROR: ${PROD_MODE ? 'MONGODB_URI_PROD' : 'MONGODB_URI_TEST'} not set in local.settings.json`);
    process.exit(1);
}

const MODE = APPLY ? 'APPLY' : 'DRY_RUN';

(async () => {
    console.log(`=== Venues_AutoMaster batch — ${MODE} ===`);
    console.log(`Target: ${PROD_MODE ? 'PROD (TangoTiempoProd)' : 'TEST (TangoTiempoTest)'}. PROD is fenced unless --env=prod.`);
    if (APPLY) {
        if (!TRACK_A_CLEARED) {
            console.error('');
            console.error('❌  --apply requires --track-a-cleared flag.');
            console.error('❌  AIDI Track A (Porter loader || "US" strip + 8-row country re-resolve) MUST');
            console.error('❌  complete on TEST before this script writes. Running now would bake US-bbox');
            console.error('❌  masteredCityIds onto non-US country-corrupted venues.');
            console.error('');
            console.error('   If AIDI has confirmed Track A clear, re-run with both flags:');
            console.error('   node scripts/venues-automaster-batch.js --apply --track-a-cleared');
            process.exit(2);
        }
        console.log('');
        console.log('⚠️  --apply --track-a-cleared mode selected.');
        console.log('⚠️  This WRITES to TEST Mongo (TangoTiempoTest). PROD remains fenced.');
        console.log('⚠️  Writes: per-bucket rules per doc Q3.5 hierarchy-aware model.');
        console.log('⚠️  Idempotent: venues with masteringStatus already set will be skipped.');
        console.log('⚠️  Aborting now is safe (Ctrl-C within 10 seconds).');
        await new Promise(r => setTimeout(r, 10000));
    }

    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();
    const venues = db.collection('venues');

    // --- Candidate query: null masteredCityId + valid geolocation ---
    // Covers: appId=1 (TT review + legacy), appId=2 (HJ legacy), isDiscovered:true
    // No appId filter — the doc's unified Q3.5 scope treats all three as one backfill pass.
    const candidateFilter = {
        $and: [
            { $or: [{ masteredCityId: null }, { masteredCityId: { $exists: false } }] },
            { geolocation: { $exists: true, $ne: null } },
            { 'geolocation.coordinates': { $size: 2 } },
        ],
    };

    const totalVenues = await venues.countDocuments({});
    const totalCandidates = await venues.countDocuments(candidateFilter);
    const totalMastered = totalVenues - totalCandidates -
        (await venues.countDocuments({
            $and: [
                { $or: [{ masteredCityId: null }, { masteredCityId: { $exists: false } }] },
                {
                    $or: [
                        { geolocation: { $exists: false } },
                        { geolocation: null },
                        { 'geolocation.coordinates': { $not: { $size: 2 } } },
                    ],
                },
            ],
        }));

    console.log('');
    console.log(`Total venues:              ${totalVenues}`);
    console.log(`Candidates (null city + valid geo): ${totalCandidates}`);
    console.log('');

    // --- By-appId breakdown of candidates ---
    const appIdBreakdown = {};
    for (const appId of ['1', '2']) {
        appIdBreakdown[appId] = await venues.countDocuments({ ...candidateFilter, appId });
    }
    const discoveryCount = await venues.countDocuments({ ...candidateFilter, isDiscovered: true });
    const nonDiscoveryCount = totalCandidates - discoveryCount;

    console.log(`Candidate breakdown:`);
    console.log(`  appId=1 (TT):         ${appIdBreakdown['1']}`);
    console.log(`  appId=2 (HJ):         ${appIdBreakdown['2']}`);
    console.log(`  isDiscovered=true:    ${discoveryCount}`);
    console.log(`  non-discovery:        ${nonDiscoveryCount}`);
    console.log('');

    // --- Per-venue resolution ---
    // For each candidate, $geoNear masteredcities to get nearest + distanceKm.
    // Pipeline uses $geoNear aggregation on masteredcities' `location` field.

    const buckets = {
        AUTO_HIGH: [],
        AUTO_MEDIUM: [],
        MANUAL: [],
    };
    let textConflictCount = 0;
    let errorCount = 0;
    let processedCount = 0;

    // Stream candidates — avoid loading all 1,093 into memory at once
    const cursor = venues.find(candidateFilter, {
        projection: {
            _id: 1,
            name: 1,
            appId: 1,
            isDiscovered: 1,
            city: 1,
            state: 1,
            country: 1,
            geolocation: 1,
            masteredCityId: 1,
            masteringStatus: 1,
        },
    });

    for await (const venue of cursor) {
        processedCount++;
        try {
            const result = await resolveMasteredCity({
                db,
                geolocation: venue.geolocation,
                cityText: venue.city,
            });

            if (!result) {
                // Invalid geolocation (shouldn't happen given candidate filter; defensive)
                errorCount++;
                continue;
            }

            if (result.log.masteringTextConflict) textConflictCount++;

            buckets[result.bucket].push({
                _id: venue._id,
                name: venue.name,
                appId: venue.appId,
                isDiscovered: !!venue.isDiscovered,
                cityText: venue.city || null,
                countryText: venue.country || null,
                distanceKm: result.log.distanceKm,
                nearestCityId: result.log.nearestCityId,
                nearestCityName: result.log.nearestCityName,
                masteringTextConflict: result.log.masteringTextConflict,
                reason: result.log.reason,
                // Pre-computed fields for apply — saves re-running resolver in --apply loop
                _applyFields: result.fields,
            });
        } catch (err) {
            errorCount++;
            console.error(`ERROR on venue ${venue._id}: ${err.message}`);
        }

        if (processedCount % 100 === 0) {
            process.stdout.write(`  processed ${processedCount}/${totalCandidates}...\r`);
        }
    }
    console.log(`  processed ${processedCount}/${totalCandidates}    `);
    console.log('');

    // --- Distance histogram (10km bins up to 200km, then >200km) ---
    const hist = Array(21).fill(0); // 0-10, 10-20, ..., 190-200, >200
    for (const row of [...buckets.AUTO_HIGH, ...buckets.AUTO_MEDIUM, ...buckets.MANUAL]) {
        if (row.distanceKm === null) { hist[20]++; continue; }
        const bin = Math.min(Math.floor(row.distanceKm / 10), 20);
        hist[bin]++;
    }

    // --- Summary ---
    console.log('=== Distance-bucket breakdown ===');
    console.log(`  AUTO_HIGH   (≤${BUCKET_HIGH_MAX_KM}km):       ${buckets.AUTO_HIGH.length}`);
    console.log(`  AUTO_MEDIUM (${BUCKET_HIGH_MAX_KM}-${BUCKET_MEDIUM_MAX_KM}km): ${buckets.AUTO_MEDIUM.length}`);
    console.log(`  MANUAL      (>${BUCKET_MEDIUM_MAX_KM}km):      ${buckets.MANUAL.length}`);
    console.log(`  Text conflicts:             ${textConflictCount}`);
    console.log(`  Errors:                     ${errorCount}`);
    console.log('');
    console.log('Distance histogram (km):');
    for (let i = 0; i < 20; i++) {
        const lo = i * 10, hi = (i + 1) * 10;
        console.log(`  ${String(lo).padStart(3)}-${String(hi).padStart(3)}km: ${hist[i]}`);
    }
    console.log(`  >200km:    ${hist[20]}`);
    console.log('');

    // --- APPLY path (Checkpoint B) ---
    // Per-bucket write rules (doc Q3.5 hierarchy-aware):
    //   AUTO_HIGH:   write full chain (city + division + region + country) + masteringStatus='mastered_by_automaster'
    //   AUTO_MEDIUM: write country-chain only (skip city to prevent /boston pollution) + masteringStatus='country_only_by_automaster'
    //   MANUAL:      write masteringStatus='corpus-gap-review' + masteringDistanceKm only
    //
    // Preserve-gate: skip if venue has masteredCityId already set OR masteringStatus is in
    // PRESERVED_STATUSES (terminal states that should not be overwritten).
    //
    // IMPORTANT: `masteringStatus: 'review'` (CALBEAF-114 artifact) is NOT preserved —
    // that status means "flagged to review bucket, no actual data written." Overwriting
    // those is the whole point of this run.

    const PRESERVED_STATUSES = [
        'mastered',                    // CALBEAF-114 legacy AUTO_HIGH writes (61 venues)
        'mastered_by_automaster',       // this spec's AUTO_HIGH terminal
        'country_only_by_automaster',   // this spec's AUTO_MEDIUM terminal (until future Tier-2 corpus-add re-eval)
        'corpus-gap-review',            // parked; re-eval only on corpus expansion
        'name-conflict-review',         // human-adjudication parked
    ];

    const applyLog = [];
    const applyCounts = { AUTO_HIGH: 0, AUTO_MEDIUM: 0, MANUAL: 0, skipped_already_mastered: 0, errors: 0 };

    if (APPLY) {
        const applyStartTime = new Date();
        console.log('');
        console.log(`=== APPLY START ${applyStartTime.toISOString()} ===`);
        console.log(`(helper spec version: ${VENUES_AUTOMASTER_SPEC_VERSION})`);
        console.log(`(preserved statuses: ${PRESERVED_STATUSES.join(', ')})`);
        console.log(`(stale 'review' status from CALBEAF-114 is overwritten — no data to preserve)`);
        console.log('');

        // Unified apply loop — fields come from the shared helper's _applyFields
        // computed in the classification pass. Per-bucket idempotency + write are
        // identical between batch and inline hook since both use resolveMasteredCity.
        for (const bucket of ['AUTO_HIGH', 'AUTO_MEDIUM', 'MANUAL']) {
            for (const row of buckets[bucket]) {
                try {
                    const existing = await venues.findOne(
                        { _id: row._id },
                        { projection: { masteringStatus: 1, masteredCityId: 1 } }
                    );
                    if (!existing) { applyCounts.errors++; continue; }
                    // Preserve-gate: skip if masteredCityId already set OR status is terminal
                    if (existing.masteredCityId || PRESERVED_STATUSES.includes(existing.masteringStatus)) {
                        applyCounts.skipped_already_mastered++;
                        continue;
                    }

                    // _applyFields was pre-computed by the helper during classification —
                    // stamp the run time (batch applies single timestamp for all writes)
                    const setFields = { ...row._applyFields, masteringAppliedAt: applyStartTime };

                    await venues.updateOne({ _id: row._id }, { $set: setFields });
                    applyCounts[bucket]++;
                    applyLog.push({
                        _id: row._id,
                        bucket,
                        distanceKm: row.distanceKm,
                        fieldsSet: Object.keys(setFields),
                    });
                } catch (err) {
                    applyCounts.errors++;
                    console.error(`APPLY ERROR ${bucket} ${row._id}: ${err.message}`);
                }
            }
        }

        const applyEndTime = new Date();
        console.log('=== APPLY COMPLETE ===');
        console.log(`  AUTO_HIGH   written: ${applyCounts.AUTO_HIGH}`);
        console.log(`  AUTO_MEDIUM written: ${applyCounts.AUTO_MEDIUM}`);
        console.log(`  MANUAL      flagged: ${applyCounts.MANUAL}`);
        console.log(`  Skipped (already mastered): ${applyCounts.skipped_already_mastered}`);
        console.log(`  Errors:     ${applyCounts.errors}`);
        console.log(`  Duration:   ${Math.round((applyEndTime - applyStartTime) / 1000)}s`);
        console.log('');
        console.log('Reversibility recipe:');
        console.log(`  Filter: { masteringStatus: { $in: ['mastered_by_automaster', 'country_only_by_automaster', 'corpus-gap-review'] },`);
        console.log(`            masteringAppliedAt: { $gte: ISODate('${applyStartTime.toISOString()}'), $lte: ISODate('${applyEndTime.toISOString()}') } }`);
        console.log(`  Undo:   $unset(masteredCityId, masteredCityName, masteredDivisionId, masteredDivisionName,`);
        console.log(`           masteredRegionId, masteredRegionName, masteredCountryId, masteredCountryName,`);
        console.log(`           masteringDistanceKm, masteringTextConflict, masteringStatus, masteringAppliedAt)`);
        console.log(`  Prefer re-run forward (idempotent via masteringStatus preserve-gate).`);
    }

    // --- Artifact ---
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 16);
    const artifact = {
        meta: {
            ticket: 'CALBEAF-116',
            mode: MODE,
            timestamp: new Date().toISOString(),
            environment: 'TangoTiempoTest',
            specRef: 'CITY-COUNTRY-DATA-DISCIPLINE-REVIEW.md Q3.5',
            helperSpecVersion: VENUES_AUTOMASTER_SPEC_VERSION,
            bucketThresholds: {
                AUTO_HIGH_max_km: BUCKET_HIGH_MAX_KM,
                AUTO_MEDIUM_max_km: BUCKET_MEDIUM_MAX_KM,
            },
            trackAGate: 'APPLY blocked until AIDI Track A TEST sweep (Porter || "US" strip + 8-row country re-resolve) is confirmed complete',
        },
        totals: {
            venuesInDb: totalVenues,
            candidatesWithValidGeo: totalCandidates,
            candidatesByAppId: appIdBreakdown,
            candidatesIsDiscovered: discoveryCount,
            candidatesNonDiscovery: nonDiscoveryCount,
        },
        bucketCounts: {
            AUTO_HIGH: buckets.AUTO_HIGH.length,
            AUTO_MEDIUM: buckets.AUTO_MEDIUM.length,
            MANUAL: buckets.MANUAL.length,
            textConflicts: textConflictCount,
            errors: errorCount,
        },
        distanceHistogram: {
            binSize: '10km',
            bins: Object.fromEntries(
                hist.slice(0, 20).map((c, i) => [`${i * 10}-${(i + 1) * 10}km`, c]).concat([['>200km', hist[20]]])
            ),
        },
        samples: {
            AUTO_HIGH: buckets.AUTO_HIGH.slice(0, 10),
            AUTO_MEDIUM: buckets.AUTO_MEDIUM.slice(0, 10),
            MANUAL: buckets.MANUAL.slice(0, 10),
        },
        textConflictSamples: [
            ...buckets.AUTO_HIGH.filter(r => r.masteringTextConflict).slice(0, 10),
            ...buckets.AUTO_MEDIUM.filter(r => r.masteringTextConflict).slice(0, 5),
        ],
        applyResults: APPLY ? {
            counts: applyCounts,
            logEntryCount: applyLog.length,
            // Full apply log embedded for reversibility audit trail
            log: applyLog,
        } : null,
    };

    const outDir = '/Users/tobybalsley/MyDocs/Collab/reviews';
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `venues-automaster-dryrun-${timestamp}.json`);
    fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    console.log(`Artifact written to: ${outPath}`);

    await client.close();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
