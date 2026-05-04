// CALBEAF-173 M2 golden sweep — directly exercises the parentSlug resolution path
// without needing the Azure Functions runtime. Mirrors what the live endpoint does.
//
// Validates:
//   1. parentSlug → cityIds resolution returns >0 ids for known multi-city parents
//   2. events query with the resolved cityIds returns >0 events
//   3. EVERY returned event's masteredCityId is in the resolved set (region-correctness)
//   4. EVERY returned event's masteredDivisionName/masteredCountryName aligns with the parent
//
// Run:
//   node scripts/test-calbeaf173-golden-sweep.js [test|prod]   (default: test)

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local.settings.json'), 'utf8'));

function toSlug(name) {
    if (!name) return '';
    return name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

async function resolveParentSlugToCityIds(db, parentSlug) {
    if (!parentSlug) return [];
    const cityDocs = await db.collection('masteredcities').find(
        {},
        { projection: { _id: 1, stateName: 1, countryCode: 1 } }
    ).toArray();
    const countries = await db.collection('masteredcountries').find(
        {},
        { projection: { countryCode: 1, countryName: 1 } }
    ).toArray();
    const countryNameByCode = new Map(countries.map(c => [c.countryCode || '', c.countryName]));
    const matched = [];
    for (const city of cityDocs) {
        const isUS = city.countryCode === 'US';
        const parentName = isUS && city.stateName ? city.stateName : countryNameByCode.get(city.countryCode || '');
        if (!parentName) continue;
        if (toSlug(parentName) === parentSlug) matched.push(city._id);
    }
    return matched;
}

const SWEEP = [
    { slug: 'california',   type: 'state',   expectField: 'masteredDivisionName', expectValue: 'California' },
    { slug: 'new-york',     type: 'state',   expectField: 'masteredDivisionName', expectValue: 'New York' },
    { slug: 'texas',        type: 'state',   expectField: 'masteredDivisionName', expectValue: 'Texas' },
    { slug: 'australia',    type: 'country', expectField: 'masteredCountryName',  expectValue: 'Australia' },
    { slug: 'argentina',    type: 'country', expectField: 'masteredCountryName',  expectValue: 'Argentina' },
    { slug: 'italy',        type: 'country', expectField: 'masteredCountryName',  expectValue: 'Italy' },
    // Negative case — fail-closed
    { slug: 'no-such-parent-9d8c7b6a', type: 'unknown', expectEmpty: true },
];

async function main() {
    const env = (process.argv[2] || 'test').toLowerCase();
    const uri = env === 'prod' ? settings.Values.MONGODB_URI_PROD : settings.Values.MONGODB_URI_TEST;
    const client = new MongoClient(uri);

    let pass = 0, fail = 0;
    try {
        await client.connect();
        const db = client.db();
        console.log(`\nGolden sweep: ${db.databaseName} (CALBEAF-173)\n${'='.repeat(60)}`);

        for (const tc of SWEEP) {
            const cityIds = await resolveParentSlugToCityIds(db, tc.slug);

            if (tc.expectEmpty) {
                if (cityIds.length === 0) {
                    console.log(`✅ ${tc.slug.padEnd(30)} resolved 0 cities (fail-closed expected)`);
                    pass++;
                } else {
                    console.log(`❌ ${tc.slug.padEnd(30)} expected 0 cities, got ${cityIds.length}`);
                    fail++;
                }
                continue;
            }

            if (cityIds.length === 0) {
                console.log(`❌ ${tc.slug.padEnd(30)} resolved 0 cities (expected >0)`);
                fail++;
                continue;
            }

            // Query events using the resolved cityIds; mirrors what /api/events would do
            const events = await db.collection('events').find(
                { appId: '1', masteredCityId: { $in: cityIds }, isActive: true },
                { projection: { masteredCityId: 1, masteredCityName: 1, masteredDivisionName: 1, masteredCountryName: 1 } }
            ).limit(500).toArray();

            const cityIdSet = new Set(cityIds.map(id => id.toString()));
            const stray = events.filter(e => !e.masteredCityId || !cityIdSet.has(e.masteredCityId.toString()));
            const wrongRegion = events.filter(e => e[tc.expectField] && e[tc.expectField] !== tc.expectValue);

            const ok = stray.length === 0 && wrongRegion.length === 0 && events.length > 0;
            if (ok) {
                console.log(`✅ ${tc.slug.padEnd(30)} cities=${cityIds.length}  events=${events.length}  all ${tc.expectField}="${tc.expectValue}"`);
                pass++;
            } else {
                console.log(`❌ ${tc.slug.padEnd(30)} cities=${cityIds.length}  events=${events.length}  stray=${stray.length}  wrongRegion=${wrongRegion.length}`);
                if (wrongRegion.length > 0) {
                    const sample = wrongRegion.slice(0, 3).map(e => `${e.masteredCityName} (${e[tc.expectField]})`);
                    console.log(`   Sample wrongRegion: ${sample.join(', ')}`);
                }
                fail++;
            }
        }
    } finally {
        await client.close();
    }

    console.log(`\n${'='.repeat(60)}\nResult: ${pass} pass, ${fail} fail`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(2); });
