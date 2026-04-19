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

const uri = settings.Values.MONGODB_URI_TEST;
if (!uri) {
    console.error('ERROR: MONGODB_URI_TEST not set in local.settings.json');
    process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const TRACK_A_CLEARED = process.argv.includes('--track-a-cleared');
const MODE = APPLY ? 'APPLY' : 'DRY_RUN';

// Distance bucket thresholds (km)
const BUCKET_HIGH_MAX_KM = 50;
const BUCKET_MEDIUM_MAX_KM = 200;

// Text-conflict normalization (loose match)
function textConflicts(venueText, nearestCityName) {
    if (!venueText || !nearestCityName) return false;
    const a = String(venueText).trim().toLowerCase();
    const b = String(nearestCityName).trim().toLowerCase();
    if (a === b) return false;
    if (a.includes(b) || b.includes(a)) return false;
    return true;
}

function classifyDistance(distanceKm) {
    if (distanceKm <= BUCKET_HIGH_MAX_KM) return 'AUTO_HIGH';
    if (distanceKm <= BUCKET_MEDIUM_MAX_KM) return 'AUTO_MEDIUM';
    return 'MANUAL';
}

function kmFromMeters(m) {
    return +(m / 1000).toFixed(3);
}

async function chainFromCity(db, cityId) {
    if (!cityId) return null;
    const city = await db.collection('masteredcities').findOne({ _id: cityId });
    if (!city) return null;
    const out = {
        masteredCityId: city._id,
        masteredCityName: city.cityName || null,
    };
    if (city.masteredDivisionId) {
        const div = await db.collection('mastereddivisions').findOne({ _id: city.masteredDivisionId });
        if (div) {
            out.masteredDivisionId = div._id;
            out.masteredDivisionName = div.divisionName || null;
            if (div.masteredRegionId) {
                const reg = await db.collection('masteredregions').findOne({ _id: div.masteredRegionId });
                if (reg) {
                    out.masteredRegionId = reg._id;
                    out.masteredRegionName = reg.regionName || null;
                    if (reg.masteredCountryId) {
                        const cn = await db.collection('masteredcountries').findOne({ _id: reg.masteredCountryId });
                        if (cn) {
                            out.masteredCountryId = cn._id;
                            out.masteredCountryName = cn.countryName || null;
                        }
                    }
                }
            }
        }
    }
    return out;
}

(async () => {
    console.log(`=== Venues_AutoMaster batch — ${MODE} ===`);
    console.log(`TEST only (MONGODB_URI_TEST). PROD is fenced.`);
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
            const coords = venue.geolocation?.coordinates;
            if (!Array.isArray(coords) || coords.length !== 2) {
                errorCount++;
                continue;
            }

            // $geoNear requires aggregation; use findOne with $near for simplicity + distance calc
            const nearestPipeline = [
                {
                    $geoNear: {
                        near: { type: 'Point', coordinates: coords },
                        distanceField: 'distance',
                        spherical: true,
                        maxDistance: 10_000_000, // 10,000 km cap — effectively unlimited
                        key: 'location',
                    },
                },
                { $limit: 1 },
                { $project: { cityName: 1, masteredDivisionId: 1, distance: 1 } },
            ];
            const [nearest] = await db.collection('masteredcities').aggregate(nearestPipeline).toArray();

            if (!nearest) {
                buckets.MANUAL.push({
                    _id: venue._id,
                    name: venue.name,
                    appId: venue.appId,
                    isDiscovered: !!venue.isDiscovered,
                    cityText: venue.city || null,
                    countryText: venue.country || null,
                    distanceKm: null,
                    nearestCityId: null,
                    nearestCityName: null,
                    reason: 'no_mastered_city_in_corpus',
                });
                continue;
            }

            const distanceKm = kmFromMeters(nearest.distance);
            const bucket = classifyDistance(distanceKm);
            const conflict = textConflicts(venue.city, nearest.cityName);
            if (conflict) textConflictCount++;

            buckets[bucket].push({
                _id: venue._id,
                name: venue.name,
                appId: venue.appId,
                isDiscovered: !!venue.isDiscovered,
                cityText: venue.city || null,
                countryText: venue.country || null,
                distanceKm,
                nearestCityId: nearest._id,
                nearestCityName: nearest.cityName,
                masteringTextConflict: conflict,
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
    // Preserve-gate: only $set fields that are currently null. Never overwrite existing mastered* values.
    // Idempotency: skip any venue whose masteringStatus is already set (from a prior run or CALBEAF-114).
    // Audit log: emit per-venue write record to apply-log artifact for reversibility.

    const applyLog = [];
    const applyCounts = { AUTO_HIGH: 0, AUTO_MEDIUM: 0, MANUAL: 0, skipped_already_mastered: 0, errors: 0 };

    if (APPLY) {
        const applyStartTime = new Date();
        console.log('');
        console.log(`=== APPLY START ${applyStartTime.toISOString()} ===`);
        console.log('');

        // Process AUTO_HIGH — write full chain
        for (const row of buckets.AUTO_HIGH) {
            try {
                const existing = await venues.findOne(
                    { _id: row._id },
                    { projection: { masteringStatus: 1, masteredCityId: 1 } }
                );
                if (!existing) { applyCounts.errors++; continue; }
                if (existing.masteringStatus || existing.masteredCityId) {
                    applyCounts.skipped_already_mastered++;
                    continue;
                }

                const chain = await chainFromCity(db, row.nearestCityId);
                if (!chain) { applyCounts.errors++; continue; }

                const setFields = {
                    masteredCityId: chain.masteredCityId,
                    masteredCityName: chain.masteredCityName,
                    masteringDistanceKm: row.distanceKm,
                    masteringTextConflict: row.masteringTextConflict,
                    masteringStatus: 'mastered_by_automaster',
                    masteringAppliedAt: applyStartTime,
                };
                if (chain.masteredDivisionId) {
                    setFields.masteredDivisionId = chain.masteredDivisionId;
                    setFields.masteredDivisionName = chain.masteredDivisionName;
                }
                if (chain.masteredRegionId) {
                    setFields.masteredRegionId = chain.masteredRegionId;
                    setFields.masteredRegionName = chain.masteredRegionName;
                }
                if (chain.masteredCountryId) {
                    setFields.masteredCountryId = chain.masteredCountryId;
                    setFields.masteredCountryName = chain.masteredCountryName;
                }

                await venues.updateOne({ _id: row._id }, { $set: setFields });
                applyCounts.AUTO_HIGH++;
                applyLog.push({
                    _id: row._id,
                    bucket: 'AUTO_HIGH',
                    distanceKm: row.distanceKm,
                    fieldsSet: Object.keys(setFields),
                });
            } catch (err) {
                applyCounts.errors++;
                console.error(`APPLY ERROR AUTO_HIGH ${row._id}: ${err.message}`);
            }
        }

        // Process AUTO_MEDIUM — write country-chain only (no city ID or name)
        for (const row of buckets.AUTO_MEDIUM) {
            try {
                const existing = await venues.findOne(
                    { _id: row._id },
                    { projection: { masteringStatus: 1, masteredCityId: 1, masteredCountryId: 1 } }
                );
                if (!existing) { applyCounts.errors++; continue; }
                if (existing.masteringStatus || existing.masteredCityId) {
                    applyCounts.skipped_already_mastered++;
                    continue;
                }

                const chain = await chainFromCity(db, row.nearestCityId);
                if (!chain) { applyCounts.errors++; continue; }

                // Country-only write: intentionally skip masteredCityId + masteredCityName
                // to prevent /boston-route pollution from far-nearest-city resolves.
                const setFields = {
                    masteringDistanceKm: row.distanceKm,
                    masteringTextConflict: row.masteringTextConflict,
                    masteringStatus: 'country_only_by_automaster',
                    masteringAppliedAt: applyStartTime,
                };
                // Only write country-chain fields. Division + region stay null at this bucket
                // because the 50-200km distance means the nearest city's admin-hierarchy may
                // not align with the actual venue's jurisdiction. Country is safe (nation-scale).
                if (chain.masteredCountryId) {
                    setFields.masteredCountryId = chain.masteredCountryId;
                    setFields.masteredCountryName = chain.masteredCountryName;
                }

                await venues.updateOne({ _id: row._id }, { $set: setFields });
                applyCounts.AUTO_MEDIUM++;
                applyLog.push({
                    _id: row._id,
                    bucket: 'AUTO_MEDIUM',
                    distanceKm: row.distanceKm,
                    fieldsSet: Object.keys(setFields),
                });
            } catch (err) {
                applyCounts.errors++;
                console.error(`APPLY ERROR AUTO_MEDIUM ${row._id}: ${err.message}`);
            }
        }

        // Process MANUAL — flag only, no mastered* writes
        for (const row of buckets.MANUAL) {
            try {
                const existing = await venues.findOne(
                    { _id: row._id },
                    { projection: { masteringStatus: 1 } }
                );
                if (!existing) { applyCounts.errors++; continue; }
                if (existing.masteringStatus) {
                    applyCounts.skipped_already_mastered++;
                    continue;
                }

                const setFields = {
                    masteringDistanceKm: row.distanceKm, // may be null (no city in corpus)
                    masteringStatus: 'corpus-gap-review',
                    masteringAppliedAt: applyStartTime,
                };

                await venues.updateOne({ _id: row._id }, { $set: setFields });
                applyCounts.MANUAL++;
                applyLog.push({
                    _id: row._id,
                    bucket: 'MANUAL',
                    distanceKm: row.distanceKm,
                    fieldsSet: Object.keys(setFields),
                });
            } catch (err) {
                applyCounts.errors++;
                console.error(`APPLY ERROR MANUAL ${row._id}: ${err.message}`);
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
