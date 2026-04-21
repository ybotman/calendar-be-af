#!/usr/bin/env node
// scripts/sweep-bad-venue-mastering.js
// CALBEAF-133 Step 2: Null-clear venue masteredCityId assignments written by
// pre-CALBEAF-118 processes that had no distance guard.
//
// Targets two categories:
//   A) Venues where haversine(venue.geolocation, masteredcity.location) > 200km
//      AND masteringStatus IS undefined (pre-118 origin, no distance guard applied)
//   B) Venues where masteredCityId references a non-existent masteredcity doc
//      (dangling ref — city was deleted after venue was mastered)
//
// Both categories: null-clear the full mastered chain written by the old process.
// Does NOT touch venues written by CALBEAF-118 automaster (masteringStatus IS set).
//
// Usage:
//   node scripts/sweep-bad-venue-mastering.js              # dry-run (default)
//   node scripts/sweep-bad-venue-mastering.js --env=prod   # dry-run against PROD
//   node scripts/sweep-bad-venue-mastering.js --apply      # TEST apply
//   node scripts/sweep-bad-venue-mastering.js --env=prod --apply  # PROD apply (Toby auth required)

const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const PROD_MODE = process.argv.includes('--env=prod');
const MODE = APPLY ? 'APPLY' : 'DRY_RUN';
const DISTANCE_THRESHOLD_KM = 200;

// Fields written by pre-118 process — null-clear all of them.
const FIELDS_TO_CLEAR = [
    'masteredCityId', 'masteredCityName',
    'masteredDivisionId', 'masteredDivisionName',
    'masteredRegionId', 'masteredRegionName',
    'masteredCountryId', 'masteredCountryName',
];

function loadUri() {
    const settings = require('../local.settings.json');
    const key = PROD_MODE ? 'MONGODB_URI_PROD' : 'MONGODB_URI_TEST';
    const uri = settings.Values[key];
    if (!uri) { console.error(`ERROR: ${key} not set`); process.exit(1); }
    return uri;
}

function haversineKm([lng1, lat1], [lng2, lat2]) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

(async () => {
    const uri = loadUri();
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();

    console.log(`=== sweep-bad-venue-mastering — ${MODE} ===`);
    console.log(`Target: ${PROD_MODE ? 'PROD (TangoTiempoProd)' : 'TEST (TangoTiempoTest)'}`);
    console.log(`Distance threshold: >${DISTANCE_THRESHOLD_KM}km`);
    console.log('');

    // Only target venues that were NOT written by CALBEAF-118 automaster.
    // masteringStatus undefined = pre-118 origin.
    const candidates = await db.collection('venues').find(
        { masteredCityId: { $ne: null, $exists: true }, masteringStatus: { $exists: false } },
        { projection: { name: 1, masteredCityId: 1, geolocation: 1 } }
    ).toArray();

    console.log(`Pre-118 venues with masteredCityId set: ${candidates.length}`);
    console.log('');

    const distanceViolations = [];
    const danglingRefs = [];

    for (const venue of candidates) {
        const cityDoc = await db.collection('masteredcities').findOne(
            { _id: venue.masteredCityId },
            { projection: { cityName: 1, location: 1 } }
        );

        if (!cityDoc) {
            danglingRefs.push({ venue, reason: 'masteredCityId references non-existent city doc' });
            continue;
        }

        if (!venue.geolocation?.coordinates || !cityDoc.location?.coordinates) {
            // Can't compute distance — skip conservatively (don't null-clear without proof)
            console.log(`  SKIP (no coords): ${venue.name}`);
            continue;
        }

        const distKm = haversineKm(venue.geolocation.coordinates, cityDoc.location.coordinates);

        if (distKm > DISTANCE_THRESHOLD_KM) {
            distanceViolations.push({ venue, cityName: cityDoc.cityName, distKm });
        }
    }

    // --- Report Category A: distance violations ---
    console.log(`Category A — distance violations (>${DISTANCE_THRESHOLD_KM}km): ${distanceViolations.length}`);
    distanceViolations
        .sort((a, b) => b.distKm - a.distKm)
        .forEach(({ venue, cityName, distKm }) => {
            console.log(`  ${Math.round(distKm).toString().padStart(5)}km  ${venue.name}  →  ${cityName}`);
        });
    console.log('');

    // --- Report Category B: dangling refs ---
    console.log(`Category B — dangling refs (city doc deleted): ${danglingRefs.length}`);
    danglingRefs.forEach(({ venue }) => {
        console.log(`  ${venue.name}  (masteredCityId: ${venue.masteredCityId})`);
    });
    console.log('');

    const allTargets = [...distanceViolations.map(v => v.venue), ...danglingRefs.map(v => v.venue)];
    console.log(`Total venues to null-clear: ${allTargets.length}`);

    if (!APPLY) {
        console.log('');
        console.log('DRY-RUN complete — NO writes performed.');
        console.log('Re-run with --apply to execute.');
        await client.close();
        return;
    }

    // --- Apply: null-clear the full mastered chain ---
    const $unset = {};
    for (const f of FIELDS_TO_CLEAR) $unset[f] = '';

    let nullCleared = 0;
    for (const venue of allTargets) {
        const result = await db.collection('venues').updateOne(
            { _id: venue._id },
            { $unset, $set: { masteringStatus: 'null-cleared-calbeaf-133', masteringAppliedAt: new Date() } }
        );
        if (result.modifiedCount > 0) {
            console.log(`  CLEARED: ${venue.name}`);
            nullCleared++;
        } else {
            console.log(`  SKIP (no change): ${venue.name}`);
        }
    }

    console.log('');
    console.log(`=== APPLY complete: ${nullCleared} venues null-cleared ===`);
    await client.close();
})().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
