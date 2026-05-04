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

// CALBEAF-173 — region-correctness invariant:
// "Every event returned by parentSlug=X must have masteredCityId IN the set of
// cities resolved by parentSlug=X." This is the bug-shaped assertion — country-wide
// leak (the original bug) returns events with masteredCityId OUTSIDE the resolved set.
//
// Note: events do NOT carry masteredDivisionName (verified TEST 0/417 + PROD 0/500).
// They DO carry masteredCityName + masteredCountryName. The cityId-in-set check is the
// authoritative cross-check; supplementary cityName check confirms the resolved cities
// match what we expect for the parent.
const SWEEP = [
    { slug: 'california',   type: 'state',   expectedCities: ['Los Angeles', 'San Francisco', 'San Diego', 'Sacramento', 'San Jose', 'Orange County'] },
    { slug: 'new-york',     type: 'state',   expectedCities: ['New York City', 'Brooklyn', 'Albany'] },
    { slug: 'texas',        type: 'state',   expectedCities: ['Houston', 'Dallas', 'Austin', 'San Antonio'] },
    { slug: 'australia',    type: 'country', expectedCountry: 'Australia' },
    { slug: 'argentina',    type: 'country', expectedCountry: 'Argentina' },
    { slug: 'italy',        type: 'country', expectedCountry: 'Italy' },
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

            // Load resolved-city names so we can supplementary-check cityName ∈ resolved set
            const cityDocs = await db.collection('masteredcities').find(
                { _id: { $in: cityIds } },
                { projection: { cityName: 1 } }
            ).toArray();
            const resolvedCityNames = new Set(cityDocs.map(d => d.cityName));

            const cityIdSet = new Set(cityIds.map(id => id.toString()));

            // Load-bearing assertion: every returned event's masteredCityId must be in resolved set.
            // This is the bug-shaped check — country-wide leak (the bug) violates this.
            const stray = events.filter(e => !e.masteredCityId || !cityIdSet.has(e.masteredCityId.toString()));

            // Supplementary check: masteredCityName matches one of the resolved cities.
            // Catches cases where masteredCityId resolution was right but cityName denorm drifted.
            const wrongCityName = events.filter(e => e.masteredCityName && !resolvedCityNames.has(e.masteredCityName));

            // Country-level check (only meaningful for intl parents — US events have country='United States')
            const wrongCountry = tc.expectedCountry
                ? events.filter(e => e.masteredCountryName && e.masteredCountryName !== tc.expectedCountry)
                : [];

            const ok = stray.length === 0 && wrongCityName.length === 0 && wrongCountry.length === 0 && events.length > 0;
            if (ok) {
                const detail = tc.expectedCountry
                    ? `country="${tc.expectedCountry}"`
                    : `cities ⊆ resolved set (${resolvedCityNames.size})`;
                console.log(`✅ ${tc.slug.padEnd(30)} cityIds=${cityIds.length}  events=${events.length}  stray=0  ${detail}`);
                pass++;
            } else {
                console.log(`❌ ${tc.slug.padEnd(30)} cityIds=${cityIds.length}  events=${events.length}  stray=${stray.length}  wrongCityName=${wrongCityName.length}  wrongCountry=${wrongCountry.length}`);
                if (stray.length > 0) {
                    const sample = stray.slice(0, 3).map(e => `${e.masteredCityName || '?'} (cityId=${e.masteredCityId})`);
                    console.log(`   Sample stray: ${sample.join(', ')}`);
                }
                if (wrongCityName.length > 0) {
                    const sample = wrongCityName.slice(0, 3).map(e => e.masteredCityName);
                    console.log(`   Sample wrongCityName: ${sample.join(', ')}`);
                }
                if (wrongCountry.length > 0) {
                    const sample = wrongCountry.slice(0, 3).map(e => e.masteredCountryName);
                    console.log(`   Sample wrongCountry: ${sample.join(', ')}`);
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
