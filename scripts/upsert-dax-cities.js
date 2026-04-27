#!/usr/bin/env node
// scripts/upsert-dax-cities.js
// CALBEAF-128: Upsert masteredcities for DAX Dur>1d audit (54-event city list).
//
// Phases:
//   A — Upsert masteredcountries for countries missing from corpus
//   B — Upsert mastereddivisions for those same countries (CALBEAF-118 bypass)
//   C — Upsert masteredcities — wire each to correct masteredDivisionId
//   D — Update venues — proximity+name join to newly added cities (≤50km, unmastered only)
//   E — DQ backfill — enrichment chain propagates mastered fields onto events
//
// Usage:
//   node scripts/upsert-dax-cities.js            # dry-run (safe, no writes)
//   node scripts/upsert-dax-cities.js --apply    # execute on TEST
//   node scripts/upsert-dax-cities.js --env=prod --apply   # PROD (separate Toby auth)

'use strict';
const { MongoClient, ObjectId } = require('mongodb');
const settings = require('../local.settings.json');

const APPLY = process.argv.includes('--apply');
const PROD_MODE = process.argv.includes('--env=prod');
const uri = PROD_MODE ? settings.Values.MONGODB_URI_PROD : settings.Values.MONGODB_URI_TEST;
const DB_NAME = PROD_MODE ? 'TangoTiempoProd' : 'TangoTiempoTest';
const MODE = APPLY ? 'APPLY' : 'DRY_RUN';

if (PROD_MODE && !APPLY) {
    console.warn('NOTE: --env=prod without --apply is a dry-run against PROD data (read-only).');
}

// ---------------------------------------------------------------------------
// NEW COUNTRIES — not yet in masteredcountries
// ---------------------------------------------------------------------------
const NEW_COUNTRIES = [
    { countryName: 'Slovenia',   countryCode: 'SI' },
    { countryName: 'Croatia',    countryCode: 'HR' },
    { countryName: 'Latvia',     countryCode: 'LV' },
    { countryName: 'Bulgaria',   countryCode: 'BG' },
    { countryName: 'Indonesia',  countryCode: 'ID' },
];

// ---------------------------------------------------------------------------
// EXISTING DIVISION IDs — pre-verified from TEST schema
// Key: countryCode → { divisionId, masteredCountryId, masteredRegionId }
// ---------------------------------------------------------------------------
const DIVISION_MAP = {
    IT: { divisionId: '698a5379fa4266bff71a0208', masteredCountryId: '6751f57e2e74d97609e7dca9', masteredRegionId: '698a5379fa4266bff71a0202' },
    DE: { divisionId: '698a5379fa4266bff71a0207', masteredCountryId: '67f6123c2bbba9c1dd731ea6', masteredRegionId: '698a5379fa4266bff71a0202' },
    NO: { divisionId: '698a5379fa4266bff71a0204', masteredCountryId: '698a5379fa4266bff71a01ff', masteredRegionId: '698a5379fa4266bff71a0202' },
    HU: { divisionId: '69e593f5de1c5ef975037144', masteredCountryId: '698a5379fa4266bff71a0201', masteredRegionId: '69e593f4de1c5ef975037139' },
    ES: { divisionId: '6984c4371360acd655892748', masteredCountryId: '6751f57e2e74d97609e7dcaa', masteredRegionId: '6984c4331360acd65589272b' },
    FR: { divisionId: '6984c4361360acd655892746', masteredCountryId: '6751f57e2e74d97609e7dca7', masteredRegionId: '6984c4331360acd655892729' },
    GB: { divisionId: '6984c4361360acd655892744', masteredCountryId: '6751f57e2e74d97609e7dca8', masteredRegionId: '6984c4331360acd655892728' },
    PL: { divisionId: '6984c4371360acd65589274d', masteredCountryId: '6984c4321360acd65589271c', masteredRegionId: '6984c4331360acd655892730' },
    TR: { divisionId: '6984c4371360acd65589274f', masteredCountryId: '6984c4321360acd655892724', masteredRegionId: '6984c4341360acd655892732' },
    GR: { divisionId: '69e593f5de1c5ef97503713c', masteredCountryId: '69e593f3de1c5ef975037129', masteredRegionId: '69e593f4de1c5ef975037131' },
    // New countries: divisionId is resolved at runtime after Phase B upsert
    SI: { divisionId: null, masteredCountryId: null, masteredRegionId: null },
    HR: { divisionId: null, masteredCountryId: null, masteredRegionId: null },
    LV: { divisionId: null, masteredCountryId: null, masteredRegionId: null },
    BG: { divisionId: null, masteredCountryId: null, masteredRegionId: null },
    ID: { divisionId: null, masteredCountryId: null, masteredRegionId: null },
};

// ---------------------------------------------------------------------------
// CITY MANIFEST
// altCityNames: used for venue name/text matching
// ---------------------------------------------------------------------------
const CITY_MANIFEST = [
    // ── Italy ──
    { cityName: 'Naples',           altCityNames: ['Napoli'],          countryCode: 'IT', lat: 40.8518,  lng: 14.2681,  tz: 'Europe/Rome'      },
    { cityName: 'Mantova',          altCityNames: ['Mantua'],          countryCode: 'IT', lat: 45.1564,  lng: 10.7914,  tz: 'Europe/Rome'      },
    { cityName: 'Pizzo',            altCityNames: [],                  countryCode: 'IT', lat: 38.7408,  lng: 16.1694,  tz: 'Europe/Rome'      },
    { cityName: 'Maratea',          altCityNames: [],                  countryCode: 'IT', lat: 40.0575,  lng: 15.7250,  tz: 'Europe/Rome'      },
    { cityName: 'Casalborsetti',    altCityNames: [],                  countryCode: 'IT', lat: 44.6017,  lng: 12.3403,  tz: 'Europe/Rome'      },
    { cityName: 'Casalbordino',     altCityNames: [],                  countryCode: 'IT', lat: 42.2331,  lng: 14.5869,  tz: 'Europe/Rome'      },
    { cityName: 'Palermo',          altCityNames: [],                  countryCode: 'IT', lat: 38.1157,  lng: 13.3615,  tz: 'Europe/Rome'      },
    { cityName: 'Rimini',           altCityNames: [],                  countryCode: 'IT', lat: 44.0581,  lng: 12.5652,  tz: 'Europe/Rome'      },
    { cityName: 'Paestum',          altCityNames: ['Capaccio'],        countryCode: 'IT', lat: 40.4218,  lng: 15.0040,  tz: 'Europe/Rome'      },
    { cityName: 'Rodi Garganico',   altCityNames: [],                  countryCode: 'IT', lat: 41.9247,  lng: 15.8881,  tz: 'Europe/Rome'      },
    // ── Germany ──
    { cityName: 'Fürth',            altCityNames: ['Furth'],           countryCode: 'DE', lat: 49.4778,  lng: 10.9889,  tz: 'Europe/Berlin'    },
    { cityName: 'Heidelberg',       altCityNames: [],                  countryCode: 'DE', lat: 49.4093,  lng:  8.6942,  tz: 'Europe/Berlin'    },
    { cityName: 'Ludwigshafen',     altCityNames: ['Ludwigshafen am Rhein'], countryCode: 'DE', lat: 49.4748, lng: 8.4352, tz: 'Europe/Berlin' },
    { cityName: 'Frankfurt',        altCityNames: ['Frankfurt am Main'], countryCode: 'DE', lat: 50.1109, lng:  8.6821,  tz: 'Europe/Berlin'   },
    { cityName: 'Cologne',          altCityNames: ['Köln', 'Koeln', 'Koln'], countryCode: 'DE', lat: 50.9333, lng: 6.9500, tz: 'Europe/Berlin' },
    // ── Spain ──
    { cityName: 'Mérida',           altCityNames: ['Merida'],          countryCode: 'ES', lat: 38.9170,  lng:  -6.3417, tz: 'Europe/Madrid'    },
    { cityName: 'El Puerto de Santa María', altCityNames: ['Puerto de Santa Maria', 'El Puerto'], countryCode: 'ES', lat: 36.5950, lng: -6.2274, tz: 'Europe/Madrid' },
    { cityName: 'Benidorm',         altCityNames: [],                  countryCode: 'ES', lat: 38.5392,  lng:  -0.1345, tz: 'Europe/Madrid'    },
    { cityName: 'Salamanca',        altCityNames: [],                  countryCode: 'ES', lat: 40.9650,  lng:  -5.6635, tz: 'Europe/Madrid'    },
    { cityName: 'Santander',        altCityNames: [],                  countryCode: 'ES', lat: 43.4636,  lng:  -3.8069, tz: 'Europe/Madrid'    },
    // ── France ──
    { cityName: 'Crespin',          altCityNames: [],                  countryCode: 'FR', lat: 50.4081,  lng:   3.6256, tz: 'Europe/Paris'     },
    { cityName: 'Noirmoutier',      altCityNames: ["L'Épine", "Noirmoutier-en-l'Ile", 'Epine'], countryCode: 'FR', lat: 46.9863, lng: -2.2550, tz: 'Europe/Paris' },
    { cityName: 'Montpellier',      altCityNames: [],                  countryCode: 'FR', lat: 43.6108,  lng:   3.8767, tz: 'Europe/Paris'     },
    { cityName: 'Albi',             altCityNames: [],                  countryCode: 'FR', lat: 43.9278,  lng:   2.1478, tz: 'Europe/Paris'     },
    // ── Greece ──
    { cityName: 'Rhodes',           altCityNames: ['Rodos'],           countryCode: 'GR', lat: 36.4341,  lng:  28.2176, tz: 'Europe/Athens'    },
    { cityName: 'Samos',            altCityNames: [],                  countryCode: 'GR', lat: 37.7500,  lng:  26.9833, tz: 'Europe/Athens'    },
    // ── Slovenia ──
    { cityName: 'Ljubljana',        altCityNames: [],                  countryCode: 'SI', lat: 46.0569,  lng:  14.5058, tz: 'Europe/Ljubljana' },
    // ── Croatia ──
    { cityName: 'Dubrovnik',        altCityNames: [],                  countryCode: 'HR', lat: 42.6507,  lng:  18.0944, tz: 'Europe/Zagreb'    },
    { cityName: 'Split',            altCityNames: [],                  countryCode: 'HR', lat: 43.5081,  lng:  16.4402, tz: 'Europe/Zagreb'    },
    // ── Poland ──
    { cityName: 'Walbrzych',        altCityNames: ['Wałbrzych'],       countryCode: 'PL', lat: 50.7713,  lng:  16.2843, tz: 'Europe/Warsaw'    },
    // ── UK ──
    { cityName: 'Cheltenham',       altCityNames: [],                  countryCode: 'GB', lat: 51.9000,  lng:  -2.0667, tz: 'Europe/London'    },
    // ── Norway ──
    { cityName: 'Bergen',           altCityNames: [],                  countryCode: 'NO', lat: 60.3913,  lng:   5.3221, tz: 'Europe/Oslo'      },
    // ── Latvia ──
    { cityName: 'Riga',             altCityNames: [],                  countryCode: 'LV', lat: 56.9496,  lng:  24.1052, tz: 'Europe/Riga'      },
    { cityName: 'Jumurda',          altCityNames: [],                  countryCode: 'LV', lat: 57.0167,  lng:  25.6167, tz: 'Europe/Riga'      },
    // ── Bulgaria ──
    { cityName: 'Varna',            altCityNames: [],                  countryCode: 'BG', lat: 43.2048,  lng:  27.9106, tz: 'Europe/Sofia'     },
    // ── Indonesia ──
    { cityName: 'Ubud',             altCityNames: ['Bali'],            countryCode: 'ID', lat:  -8.5069, lng: 115.2625, tz: 'Asia/Makassar'    },
    // ── Turkey ──
    { cityName: 'Antalya',          altCityNames: [],                  countryCode: 'TR', lat: 36.8969,  lng:  30.7133, tz: 'Europe/Istanbul'  },
    { cityName: 'Sirince',          altCityNames: ['Şirince', 'Sirince Village'], countryCode: 'TR', lat: 37.9453, lng: 27.8736, tz: 'Europe/Istanbul' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function haversineKm([lng1, lat1], [lng2, lat2]) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(DB_NAME);

    console.log(`\n=== upsert-dax-cities — ${MODE} ===`);
    console.log(`Target: ${PROD_MODE ? 'PROD' : 'TEST'} (${DB_NAME})\n`);

    const rollbackOps = [];   // printed at end for manual rollback
    const prodReplay  = [];   // printed at end as PROD recipe

    // -----------------------------------------------------------------------
    // Phase A — Upsert new masteredcountries
    // -----------------------------------------------------------------------
    console.log('--- Phase A: masteredcountries ---');
    const countryIdMap = {};  // countryCode → _id string (for phase B reference)

    for (const c of NEW_COUNTRIES) {
        const existing = await db.collection('masteredcountries').findOne({ countryCode: c.countryCode });
        if (existing) {
            console.log(`  SKIP  ${c.countryCode} ${c.countryName} — already exists (_id: ${existing._id})`);
            countryIdMap[c.countryCode] = existing._id.toString();
            continue;
        }
        const doc = {
            countryName: c.countryName,
            countryCode: c.countryCode,
            appId: '1',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        if (APPLY) {
            const r = await db.collection('masteredcountries').insertOne(doc);
            countryIdMap[c.countryCode] = r.insertedId.toString();
            console.log(`  INSERT ${c.countryCode} ${c.countryName} → ${r.insertedId}`);
            rollbackOps.push(`db.masteredcountries.deleteOne({ _id: ObjectId('${r.insertedId}') });`);
            prodReplay.push(`// Country: ${c.countryName} (${c.countryCode})`);
        } else {
            console.log(`  WOULD INSERT ${c.countryCode} ${c.countryName}`);
            countryIdMap[c.countryCode] = `<new-${c.countryCode}-id>`;
        }
    }

    // -----------------------------------------------------------------------
    // Phase B — Upsert new mastereddivisions (CALBEAF-118 bypass pattern)
    // -----------------------------------------------------------------------
    console.log('\n--- Phase B: mastereddivisions ---');

    for (const c of NEW_COUNTRIES) {
        const divisionName = c.countryName;
        const existing = await db.collection('mastereddivisions').findOne({
            divisionName,
            divisionCode: c.countryCode,
        });
        if (existing) {
            console.log(`  SKIP  ${c.countryCode} ${divisionName} — already exists (_id: ${existing._id})`);
            DIVISION_MAP[c.countryCode].divisionId = existing._id.toString();
            DIVISION_MAP[c.countryCode].masteredCountryId = existing.masteredCountryId?.toString();
            continue;
        }
        const masteredCountryId = countryIdMap[c.countryCode];
        const isValidId = masteredCountryId && !String(masteredCountryId).startsWith('<');
        const doc = {
            divisionName,
            divisionCode: c.countryCode,
            masteredCountryId: isValidId ? new ObjectId(masteredCountryId) : null,
            appId: '1',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        if (APPLY) {
            const r = await db.collection('mastereddivisions').insertOne(doc);
            DIVISION_MAP[c.countryCode].divisionId = r.insertedId.toString();
            DIVISION_MAP[c.countryCode].masteredCountryId = masteredCountryId;
            console.log(`  INSERT ${c.countryCode} ${divisionName} → ${r.insertedId}`);
            rollbackOps.push(`db.mastereddivisions.deleteOne({ _id: ObjectId('${r.insertedId}') });`);
        } else {
            console.log(`  WOULD INSERT ${c.countryCode} ${divisionName} → masteredCountryId: ${masteredCountryId || '<pending>'}`);
            DIVISION_MAP[c.countryCode].divisionId = `<new-${c.countryCode}-div-id>`;
        }
    }

    // -----------------------------------------------------------------------
    // Phase C — Upsert masteredcities
    // -----------------------------------------------------------------------
    console.log('\n--- Phase C: masteredcities ---');
    let citiesInserted = 0, citiesSkipped = 0;
    const newCityIds = [];

    for (const city of CITY_MANIFEST) {
        const divInfo = DIVISION_MAP[city.countryCode];
        if (!divInfo) {
            console.log(`  ERROR ${city.cityName} — no division mapping for countryCode ${city.countryCode}`);
            continue;
        }

        // Check if city already exists (by name)
        const nameVariants = [city.cityName, ...city.altCityNames];
        const existing = await db.collection('masteredcities').findOne({
            cityName: { $in: nameVariants },
        });
        if (existing) {
            console.log(`  SKIP  ${city.cityName} (${city.countryCode}) — exists as "${existing.cityName}" (_id: ${existing._id})`);
            citiesSkipped++;
            continue;
        }

        const divisionId = divInfo.divisionId;
        const masteredCountryId = divInfo.masteredCountryId;
        const masteredRegionId  = divInfo.masteredRegionId;

        if (!divisionId || divisionId.startsWith('<new-')) {
            console.log(`  WARN  ${city.cityName} — divisionId not yet resolved (${divisionId || 'null'}) — will be correct on --apply`);
        }

        const doc = {
            cityName: city.cityName,
            countryCode: city.countryCode,
            latitude: city.lat,
            longitude: city.lng,
            timezone: city.tz,
            geolocation: { type: 'Point', coordinates: [city.lng, city.lat] },
            location:    { type: 'Point', coordinates: [city.lng, city.lat] },
            masteredDivisionId: divisionId && !divisionId.startsWith('<') ? new ObjectId(divisionId) : null,
            masteredCountryId:  masteredCountryId && !String(masteredCountryId).startsWith('<') ? new ObjectId(masteredCountryId) : null,
            masteredRegionId:   masteredRegionId  && !String(masteredRegionId).startsWith('<')  ? new ObjectId(masteredRegionId)  : null,
            appId: '1',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        if (APPLY) {
            const r = await db.collection('masteredcities').insertOne(doc);
            newCityIds.push({ _id: r.insertedId.toString(), cityName: city.cityName, lat: city.lat, lng: city.lng });
            citiesInserted++;
            console.log(`  INSERT ${city.cityName} (${city.countryCode}) → ${r.insertedId}`);
            rollbackOps.push(`db.masteredcities.deleteOne({ _id: ObjectId('${r.insertedId}') });`);
        } else {
            console.log(`  WOULD INSERT ${city.cityName} (${city.countryCode}) → div: ${divisionId}`);
            citiesInserted++;
        }
    }
    console.log(`\n  Cities: ${citiesInserted} inserted, ${citiesSkipped} skipped`);

    // -----------------------------------------------------------------------
    // Phase D — Update venues (proximity match to new cities, unmastered only)
    // -----------------------------------------------------------------------
    console.log('\n--- Phase D: venues ---');

    // Load all masteredcities (including newly inserted) for proximity matching
    const allCities = await db.collection('masteredcities').find(
        { isActive: true },
        { projection: { cityName: 1, geolocation: 1, masteredDivisionId: 1, masteredCountryId: 1 } }
    ).toArray();

    // Find venues with no masteredCityId (candidates for matching)
    const unmasteredVenues = await db.collection('venues').find(
        {
            masteredCityId: { $in: [null, undefined] },
            masteringStatus: { $ne: 'manual' },
            'geolocation.coordinates': { $exists: true },
        },
        { projection: { name: 1, geolocation: 1, city: 1 } }
    ).toArray();

    console.log(`  Unmastered venues with coordinates: ${unmasteredVenues.length}`);

    const MAX_VENUE_CITY_KM = 50;
    let venuesUpdated = 0;
    const venueUpdateLog = [];

    for (const venue of unmasteredVenues) {
        const vCoords = venue.geolocation?.coordinates;
        if (!vCoords) continue;

        let closestCity = null, closestKm = Infinity;
        for (const city of allCities) {
            const cCoords = city.geolocation?.coordinates;
            if (!cCoords) continue;
            const km = haversineKm(vCoords, cCoords);
            if (km < closestKm) { closestKm = km; closestCity = city; }
        }

        if (!closestCity || closestKm > MAX_VENUE_CITY_KM) continue;

        venueUpdateLog.push(`  ${venue.name || venue._id} → ${closestCity.cityName} (${Math.round(closestKm)}km)`);

        if (APPLY) {
            await db.collection('venues').updateOne(
                { _id: venue._id },
                {
                    $set: {
                        masteredCityId: closestCity._id,
                        masteredCountryId: closestCity.masteredCountryId || null,
                        updatedAt: new Date(),
                    },
                }
            );
            venuesUpdated++;
        }
    }

    venueUpdateLog.forEach(l => console.log(l));
    if (APPLY) {
        console.log(`\n  Venues updated: ${venuesUpdated}`);
    } else {
        console.log(`\n  Venues WOULD update: ${venueUpdateLog.length}`);
    }

    // -----------------------------------------------------------------------
    // Phase E — DQ backfill
    // runDataQualityPipeline requires the Azure Functions db binding context.
    // Run as a separate step: node scripts/runDataQualityBackfill.js --apply
    // -----------------------------------------------------------------------
    console.log('\n--- Phase E: DQ backfill ---');
    if (APPLY) {
        const nullCount = await db.collection('events').countDocuments({ appId: '1', masteredCountryId: { $in: [null, undefined] } });
        console.log(`  Events with masteredCountryId=null: ${nullCount}`);
        console.log('  Run separately: node scripts/runDataQualityBackfill.js --apply');
    } else {
        const nullCount = await db.collection('events').countDocuments({ appId: '1', masteredCountryId: { $in: [null, undefined] } });
        console.log(`  Events with masteredCountryId=null (backfill candidates): ${nullCount}`);
    }

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n=== SUMMARY ===');
    console.log(`Mode:    ${MODE}`);
    console.log(`DB:      ${DB_NAME}`);
    console.log(`Cities:  ${citiesInserted} ${APPLY ? 'inserted' : 'would insert'}, ${citiesSkipped} skipped`);

    if (APPLY && rollbackOps.length > 0) {
        console.log('\n=== ROLLBACK RECIPE (mongosh against this DB) ===');
        console.log('// Run these in reverse order if you need to undo Phase A/B/C inserts:');
        [...rollbackOps].reverse().forEach(op => console.log(op));
        console.log('// After rollback, any venue/event changes from Phase D/E are NOT automatically reverted.');
        console.log('// Re-run with --apply to re-derive, or restore from backup.\n');
    }

    if (APPLY && !PROD_MODE) {
        console.log('\n=== PROD REPLAY RECIPE ===');
        console.log('// Once TEST is verified, run against PROD with Toby auth:');
        console.log('node scripts/upsert-dax-cities.js --env=prod --apply');
        console.log('// Then verify with Porter: dq-audit-venue-distance.mjs --env=prod\n');
    }

    await client.close();
})().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
