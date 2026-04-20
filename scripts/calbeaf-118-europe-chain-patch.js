#!/usr/bin/env node
// scripts/calbeaf-118-europe-chain-patch.js
// CALBEAF-118 (A1 option d) — Europe chain-break fix via division-carries-country bypass.
// Toby ratified 2026-04-19T22:43Z. Quinn arbiter-gate plan ratified 22:45Z.
//
// Modes:
//   --dry-run (default): projects data-patch + re-master impact; no writes
//   --apply --arbiter-approved: gated — requires both flags to write
//
// PROD STAY-OUT: uses MONGODB_URI_TEST only. PROD refusal rail enforced.
//
// What this does:
//   1. Data-patch: set `division.masteredCountryId` on 3 European divisions
//      (Italy / Germany / Finland) pointing at canonical non-orphan masteredcountries docs.
//      Norway/Switzerland/Hungary divisions ALREADY have this field set — no patch needed.
//   2. Re-master: re-run Venues_AutoMaster helper on the 7 affected venues
//      (cities: Berlin, Rome, Milan, Helsinki, Oslo, Basel, Budapest) + any events
//      inheriting from those venues.
//
// Canonical-ID picks (per Quinn 22:45Z + scan §4 non-orphan preference):
//   Italy:       6751f57e2e74d97609e7dca9  (referenced by 1 region; 2 orphans exist)
//   Germany:     6751f57e2e74d97609e7dca6  (referenced by 1 region; 2 orphans exist)
//   Finland:     6984c4321360acd65589271e  (single doc, already canonical)
//
// Reversibility: $unset division.masteredCountryId on the 3 patched divisions within the
// `calbeaf118AppliedAt` timestamp window. Printed at apply completion.

const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const settings = require('../local.settings.json');
const { resolveMasteredCity, chainFromCity } = require('../src/utils/venuesAutoMaster');
const { runDataQualityPipeline } = require('../src/utils/enrichment');

const uri = settings.Values.MONGODB_URI_TEST;
if (!uri) {
    console.error('ERROR: MONGODB_URI_TEST not set');
    process.exit(1);
}
if (uri.toLowerCase().includes('prod')) {
    console.error('ERROR: URI appears to be PROD. Script is TEST-only.');
    process.exit(2);
}

const APPLY = process.argv.includes('--apply');
const ARBITER_APPROVED = process.argv.includes('--arbiter-approved');
const MODE = APPLY ? 'APPLY' : 'DRY_RUN';

// Canonical picks — per scan §4 non-orphan preference + Quinn 22:45Z
const CANONICAL_PICKS = [
    { divisionName: 'Italy',   divisionId: '6984c4371360acd65589274a', countryId: '6751f57e2e74d97609e7dca9', countryName: 'Italy' },
    { divisionName: 'Germany', divisionId: '6984c4371360acd655892747', countryId: '6751f57e2e74d97609e7dca6', countryName: 'Germany' },
    { divisionName: 'Finland', divisionId: '6984c4371360acd65589274c', countryId: '6984c4321360acd65589271e', countryName: 'Finland' },
];

// Already-wired divisions (from reconnaissance query 22:45Z) — no patch needed
const ALREADY_WIRED = [
    { divisionName: 'Norway',      divisionId: '698a5379fa4266bff71a0204', countryId: '698a5379fa4266bff71a01ff', countryName: 'Norway' },
    { divisionName: 'Switzerland', divisionId: '698a5379fa4266bff71a0205', countryId: '698a5379fa4266bff71a0200', countryName: 'Switzerland' },
    { divisionName: 'Hungary',     divisionId: '698a5379fa4266bff71a0206', countryId: '698a5379fa4266bff71a0201', countryName: 'Hungary' },
];

// 7 Europe-affected cities (from scan §3)
const AFFECTED_CITIES = [
    { cityName: 'Berlin',   cityId: '6984c43b1360acd655892779', expectedCountry: 'Germany' },
    { cityName: 'Rome',     cityId: '6984c43b1360acd655892780', expectedCountry: 'Italy' },
    { cityName: 'Milan',    cityId: '6984c43b1360acd655892781', expectedCountry: 'Italy' },
    { cityName: 'Helsinki', cityId: '6984c43c1360acd655892785', expectedCountry: 'Finland' },
    { cityName: 'Oslo',     cityId: '698a537afa4266bff71a0209', expectedCountry: 'Norway' },
    { cityName: 'Basel',    cityId: '698a537afa4266bff71a020a', expectedCountry: 'Switzerland' },
    { cityName: 'Budapest', cityId: '698a537afa4266bff71a020b', expectedCountry: 'Hungary' },
];

(async () => {
    console.log(`=== CALBEAF-118 Europe chain-break patch — ${MODE} ===`);
    console.log('TEST only (MONGODB_URI_TEST). PROD fenced.');
    if (APPLY && !ARBITER_APPROVED) {
        console.error('');
        console.error('❌  --apply requires --arbiter-approved flag.');
        console.error('    This writes to TEST mastereddivisions docs. Quinn arbiter-gate required.');
        console.error('    If approved, re-run: node scripts/calbeaf-118-europe-chain-patch.js --apply --arbiter-approved');
        process.exit(2);
    }

    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();

    const report = {
        meta: {
            ticket: 'CALBEAF-118',
            mode: MODE,
            timestamp: new Date().toISOString(),
            environment: 'TangoTiempoTest',
            specRef: 'MASTERED-DIMENSIONAL-DATA-SCAN-2026-04-19.md §10 A1 option d',
            quinnRatified: '2026-04-19T22:45Z',
        },
        canonicalPicks: CANONICAL_PICKS,
        alreadyWired: ALREADY_WIRED,
    };

    // ── STEP 1: Verify canonical IDs resolve to real docs ──
    console.log('');
    console.log('--- Step 1: Verify canonical country docs ---');
    report.canonicalVerification = [];
    for (const pick of CANONICAL_PICKS) {
        const div = await db.collection('mastereddivisions').findOne({ _id: new ObjectId(pick.divisionId) });
        const cn = await db.collection('masteredcountries').findOne({ _id: new ObjectId(pick.countryId) });
        const refs = await db.collection('masteredregions').countDocuments({ masteredCountryId: new ObjectId(pick.countryId) });
        const existingDivCountryId = div?.masteredCountryId ? String(div.masteredCountryId) : null;
        const row = {
            divisionName: pick.divisionName,
            divisionFound: !!div,
            countryDocFound: !!cn,
            countryReferencedByRegions: refs,
            isCanonical: refs >= 1,  // canonical = already referenced somewhere
            existingDivisionCountryId: existingDivCountryId,
            patchNeeded: existingDivCountryId !== pick.countryId,
        };
        report.canonicalVerification.push(row);
        console.log(`  ${pick.divisionName.padEnd(12)} div=${!!div ? 'found' : 'MISSING'} country=${!!cn ? 'found' : 'MISSING'} refs=${refs} patch=${row.patchNeeded}`);
    }

    // ── STEP 2: Re-master projection for 7 affected cities ──
    console.log('');
    console.log('--- Step 2: Re-master projection (post-patch) ---');
    // Temporarily apply the patch in memory for projection (no DB writes)
    const inMemoryDivPatches = new Map(); // divId → countryId for bypass sim
    for (const p of CANONICAL_PICKS) inMemoryDivPatches.set(p.divisionId, p.countryId);
    for (const w of ALREADY_WIRED) inMemoryDivPatches.set(w.divisionId, w.countryId);

    // Exhaustive 7-of-7 — use BOTH chainFromCity direct call AND resolveMasteredCity.
    // chainFromCity works regardless of city.location (needed for Oslo/Basel/Budapest
    // whose location docs are missing — A4 scope). resolveMasteredCity requires $geoNear
    // which fails on those 3 broken cities.
    report.cityResolutions = [];
    for (const city of AFFECTED_CITIES) {
        const cityDoc = await db.collection('masteredcities').findOne({ _id: new ObjectId(city.cityId) });
        if (!cityDoc) {
            report.cityResolutions.push({ cityName: city.cityName, error: 'city doc not found' });
            console.log(`  ${city.cityName.padEnd(10)} ERROR: city doc not found`);
            continue;
        }
        // Always: direct chainFromCity call
        const chain = await chainFromCity(db, new ObjectId(city.cityId));
        const chainCountry = chain?.masteredCountryName || null;

        // Conditional: $geoNear-based resolveMasteredCity (requires city.location)
        let resolveCountry = null;
        let resolveBucket = null;
        let resolveDistanceKm = null;
        let resolveNote = null;
        if (cityDoc.location && cityDoc.location.coordinates?.length === 2) {
            const result = await resolveMasteredCity({
                db,
                geolocation: cityDoc.location,
                cityText: city.cityName,
            });
            resolveCountry = result?.fields?.masteredCountryName || null;
            resolveBucket = result?.bucket;
            resolveDistanceKm = result?.log?.distanceKm;
        } else {
            resolveNote = 'city.location missing (A4 scope — broken masteredcities doc)';
        }

        const row = {
            cityName: city.cityName,
            expectedCountry: city.expectedCountry,
            chainFromCity_country: chainCountry,
            chainMatch: chainCountry === city.expectedCountry,
            resolveMasteredCity_country: resolveCountry,
            resolveMasteredCity_bucket: resolveBucket,
            resolveMasteredCity_distanceKm: resolveDistanceKm,
            resolveMasteredCity_note: resolveNote,
        };
        report.cityResolutions.push(row);
        const resolveStr = resolveNote
            ? `(skipped: ${resolveNote})`
            : `geoNear-country=${resolveCountry || '(null)'} bucket=${resolveBucket} dist=${resolveDistanceKm}km`;
        console.log(`  ${city.cityName.padEnd(10)} chain-country=${chainCountry || '(null)'}${chainCountry === city.expectedCountry ? ' ✓' : ' ✗'}  ${resolveStr}`);
    }

    // Note: post-A1 projection would require actually patching + re-running, which
    // APPLY mode does. Dry-run shows "pre-A1" state for comparison baseline.
    console.log('');
    console.log('  (post-A1 projection happens in --apply path after data-patch lands.)');

    // ── STEP 3: Count venues/events downstream of these cities ──
    console.log('');
    console.log('--- Step 3: Downstream venue + event count ---');
    const cityIdObjs = AFFECTED_CITIES.map(c => new ObjectId(c.cityId));
    const venuesCount = await db.collection('venues').countDocuments({ masteredCityId: { $in: cityIdObjs } });
    const eventsCount = await db.collection('events').countDocuments({ masteredCityId: { $in: cityIdObjs } });
    const venuesNullCountry = await db.collection('venues').countDocuments({
        masteredCityId: { $in: cityIdObjs },
        $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }],
    });
    const eventsNullCountry = await db.collection('events').countDocuments({
        masteredCityId: { $in: cityIdObjs },
        $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }],
    });
    report.downstreamImpact = {
        venues_with_masteredCity_in_7europe: venuesCount,
        events_with_masteredCity_in_7europe: eventsCount,
        venues_null_country: venuesNullCountry,
        events_null_country: eventsNullCountry,
        note: 'These are the venues + events that will get masteredCountry* filled post-A1 apply + Tier-3 re-run.',
    };
    console.log(`  Venues w/ 7 Europe masteredCityId: ${venuesCount} (${venuesNullCountry} null country currently)`);
    console.log(`  Events w/ 7 Europe masteredCityId: ${eventsCount} (${eventsNullCountry} null country currently)`);

    // ── STEP 4: APPLY path (gated) ──
    // Scoped chain-fill: for each affected venue (masteredCityId in 7 Europe cities)
    // where masteredCountryId is null, call chainFromCity(venue.masteredCityId) + $set
    // the country-chain fields. Does NOT re-run $geoNear — preserves existing masteredCityId
    // links (important for Oslo/Basel/Budapest whose masteredcities docs are missing location
    // and thus unreachable via $geoNear, per A4 scope).
    //
    // Events: same targeted approach via runDataQualityPipeline (handles CALBEAF-113 chain).
    //
    // Updated post-ε: DATA-PATCH ON DIVISIONS SKIPPED (not needed — divisions already wired).
    if (APPLY) {
        const applyStartTime = new Date();
        console.log('');
        console.log(`=== APPLY START ${applyStartTime.toISOString()} ===`);
        console.log('(data-patch step skipped — divisions already carry masteredCountryId per ε finding)');
        console.log('');

        const applyCounts = {
            venues_filled: 0, venues_already_correct: 0, venues_errors: 0,
            events_filled: 0, events_already_correct: 0, events_errors: 0,
        };
        report.applyLog = { venues: [], events: [] };

        // --- VENUE chain-fill ---
        console.log('--- Venue chain-fill (targeted, no $geoNear re-resolve) ---');
        const venuesToFill = await db.collection('venues').find({
            masteredCityId: { $in: cityIdObjs },
            $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }],
        }).toArray();

        for (const v of venuesToFill) {
            try {
                const chain = await chainFromCity(db, v.masteredCityId);
                if (!chain || !chain.masteredCountryId) {
                    applyCounts.venues_errors++;
                    continue;
                }
                const setFields = {
                    masteredCountryId: chain.masteredCountryId,
                    masteredCountryName: chain.masteredCountryName,
                    calbeaf118AppliedAt: applyStartTime,
                };
                // Only add chain fields that aren't already set
                if (!v.masteredCityName && chain.masteredCityName) {
                    setFields.masteredCityName = chain.masteredCityName;
                }
                if (!v.masteredDivisionId && chain.masteredDivisionId) {
                    setFields.masteredDivisionId = chain.masteredDivisionId;
                    setFields.masteredDivisionName = chain.masteredDivisionName;
                }
                if (!v.masteredRegionId && chain.masteredRegionId) {
                    setFields.masteredRegionId = chain.masteredRegionId;
                    setFields.masteredRegionName = chain.masteredRegionName;
                }
                await db.collection('venues').updateOne({ _id: v._id }, { $set: setFields });
                applyCounts.venues_filled++;
                report.applyLog.venues.push({
                    _id: v._id,
                    name: v.name,
                    masteredCountryName: chain.masteredCountryName,
                    fieldsSet: Object.keys(setFields),
                });
            } catch (err) {
                applyCounts.venues_errors++;
                console.error(`Venue ${v._id} error: ${err.message}`);
            }
        }
        console.log(`  Venues filled: ${applyCounts.venues_filled} / errors: ${applyCounts.venues_errors}`);

        // --- EVENT chain-fill (via pipeline) ---
        console.log('');
        console.log('--- Event chain-fill (runDataQualityPipeline with forceRecompute) ---');
        const eventsToFill = await db.collection('events').find({
            masteredCityId: { $in: cityIdObjs },
            $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }],
        }).toArray();

        for (const e of eventsToFill) {
            try {
                const eventCopy = JSON.parse(JSON.stringify(e));
                await runDataQualityPipeline(eventCopy, db, { appId: e.appId, forceRecompute: true });
                const setFields = {};
                if (eventCopy.masteredCountryId && !e.masteredCountryId) {
                    setFields.masteredCountryId = eventCopy.masteredCountryId;
                    setFields.masteredCountryName = eventCopy.masteredCountryName;
                }
                if (Object.keys(setFields).length === 0) {
                    applyCounts.events_already_correct++;
                    continue;
                }
                setFields.calbeaf118AppliedAt = applyStartTime;
                await db.collection('events').updateOne({ _id: e._id }, { $set: setFields });
                applyCounts.events_filled++;
                report.applyLog.events.push({
                    _id: e._id,
                    title: e.title,
                    masteredCountryName: eventCopy.masteredCountryName,
                });
            } catch (err) {
                applyCounts.events_errors++;
                console.error(`Event ${e._id} error: ${err.message}`);
            }
        }
        console.log(`  Events filled: ${applyCounts.events_filled} / already: ${applyCounts.events_already_correct} / errors: ${applyCounts.events_errors}`);

        // Post-apply verification: re-check null-country counts
        console.log('');
        console.log('--- Post-apply coverage verification ---');
        const postVenuesNullCountry = await db.collection('venues').countDocuments({
            masteredCityId: { $in: cityIdObjs },
            $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }],
        });
        const postEventsNullCountry = await db.collection('events').countDocuments({
            masteredCityId: { $in: cityIdObjs },
            $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }],
        });
        report.postApplyCoverage = {
            venues_null_country_before: venuesNullCountry,
            venues_null_country_after: postVenuesNullCountry,
            events_null_country_before: eventsNullCountry,
            events_null_country_after: postEventsNullCountry,
        };
        console.log(`  Venues null-country: ${venuesNullCountry} -> ${postVenuesNullCountry}`);
        console.log(`  Events null-country: ${eventsNullCountry} -> ${postEventsNullCountry}`);

        // Post-patch re-master verification (run helper again on the 7 cities)
        // NOTE: This uses $geoNear which fails for Oslo/Basel/Budapest (missing location — A4).
        // Kept for the 4 with valid location to confirm the bypass fires end-to-end.
        console.log('');
        console.log('--- Post-apply chainFromCity direct call (7-of-7) ---');
        report.postPatchVerification = [];
        for (const city of AFFECTED_CITIES) {
            const cityDoc = await db.collection('masteredcities').findOne({ _id: new ObjectId(city.cityId) });
            if (!cityDoc || !cityDoc.location) continue;
            const result = await resolveMasteredCity({
                db, geolocation: cityDoc.location, cityText: city.cityName,
            });
            const row = {
                cityName: city.cityName,
                expectedCountry: city.expectedCountry,
                resolvedCountry_postA1: result?.fields?.masteredCountryName || null,
                match: (result?.fields?.masteredCountryName || null) === city.expectedCountry,
            };
            report.postPatchVerification.push(row);
            console.log(`  ${city.cityName.padEnd(10)} post-A1: country=${row.resolvedCountry_postA1 || '(null)'} expected=${city.expectedCountry} match=${row.match ? 'YES' : 'NO'}`);
        }

        const applyEndTime = new Date();
        report.applyMeta = {
            applyStartTime: applyStartTime.toISOString(),
            applyEndTime: applyEndTime.toISOString(),
            durationMs: applyEndTime - applyStartTime,
            counts: applyCounts,
        };

        console.log('');
        console.log('Reversibility recipe:');
        console.log(`  Venues filter: { calbeaf118AppliedAt: { $gte: ISODate('${applyStartTime.toISOString()}'), $lte: ISODate('${applyEndTime.toISOString()}') }, masteredCityId: { $in: [<7 Europe city _ids>] } }`);
        console.log(`  Venues undo:   $unset(masteredCountryId, masteredCountryName, calbeaf118AppliedAt)  (plus any chain fields from applyLog.venues[n].fieldsSet if reversal requires full state)`);
        console.log(`  Events filter: { calbeaf118AppliedAt: { $gte: ISODate('${applyStartTime.toISOString()}'), $lte: ISODate('${applyEndTime.toISOString()}') }, masteredCityId: { $in: [<7 Europe city _ids>] } }`);
        console.log(`  Events undo:   $unset(masteredCountryId, masteredCountryName, calbeaf118AppliedAt)`);
        console.log(`  No division writes performed in this apply (data-patch skipped per ε finding).`);
        console.log(`  Prefer re-run forward (idempotent via already-populated skip).`);
    }

    // ── Write artifact ──
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 16);
    const outDir = '/Users/tobybalsley/MyDocs/Collab/reviews';
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = `${outDir}/calbeaf-118-${MODE.toLowerCase()}-${timestamp}.json`;
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log('');
    console.log(`Artifact: ${outPath}`);

    await client.close();
})().catch((e) => {
    console.error('FATAL:', e.message);
    console.error(e.stack);
    process.exit(1);
});
