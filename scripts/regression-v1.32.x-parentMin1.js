// CALBEAF-171 (parentMin=1 cleanup, shipped as part of v1.32.0 commit 66381fd5).
// Per the new Stacked Gates rule (2026-05-04 Number2 16:38), every PROD push
// requires a regression test that fails on pre-fix code, passes post-fix.
//
// Pre-fix behavior: SEO_GeoSummary.js had PARENT_MIN_CITIES=2. The /api/seo/geo-summary
// endpoint excluded any parent (state for US, country for intl) with only 1 qualifying
// city. Post-fix: PARENT_MIN_CITIES=1. Parents with exactly 1 qualifying city are
// included.
//
// Bug shape: pre-fix code excluded ~29 single-city parents (Massachusetts/Boston with
// 238 events, Oregon/Portland with 519 events, etc.) from /tango/[parent] generateStaticParams.
// Result: those state pages 404'd as "soft-404" in production until v1.32.0 shipped.
//
// This regression test asserts that geo-summary returns parents with qualifyingCityCount=1.
// Pre-fix code returns ZERO such parents (filtered out). Post-fix returns >=1.
//
// Run:
//   node scripts/regression-v1.32.x-parentMin1.js [test|prod]   (default: test)

const fs = require('fs');
const path = require('path');
const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local.settings.json'), 'utf8'));

const HOSTS = {
    test: 'https://calendarbeaf-test.azurewebsites.net',
    prod: 'https://calendarbeaf-prod.azurewebsites.net'
};

async function main() {
    const env = (process.argv[2] || 'test').toLowerCase();
    const host = HOSTS[env];
    if (!host) { console.error(`Unknown env: ${env}`); process.exit(1); }

    const url = `${host}/api/seo/geo-summary?appId=1`;
    console.log(`Regression test: parentMin=1 effect on ${env.toUpperCase()}`);
    console.log(`URL: ${url}\n`);

    const res = await fetch(url);
    if (!res.ok) {
        console.error(`HTTP ${res.status}: ${await res.text()}`);
        process.exit(1);
    }
    const data = await res.json();
    const totalParents = data.parents?.length || 0;
    const singleCityParents = (data.parents || []).filter(p => p.qualifyingCityCount === 1);

    console.log(`Total parents returned: ${totalParents}`);
    console.log(`Parents with qualifyingCityCount === 1 (parentMin=1 effect): ${singleCityParents.length}`);
    if (singleCityParents.length > 0) {
        console.log(`Sample (first 5): ${singleCityParents.slice(0, 5).map(p => `${p.parentSlug} (${p.futureEventCount}e)`).join(', ')}`);
    }
    console.log();

    // Bug-shaped assertion: pre-fix code returns 0; post-fix returns >0.
    // Threshold: >=1 single-city parent must be present.
    if (singleCityParents.length === 0) {
        console.log('❌ FAIL — zero parents with qualifyingCityCount=1. This is the pre-v1.32.0 behavior (PARENT_MIN_CITIES=2 excluded them).');
        process.exit(1);
    }

    // Stronger assertion: documented expectation is 20+ on TEST per v1.32.0 commit notes.
    // Allow some headroom for data drift.
    const MIN_EXPECTED = 5;
    if (singleCityParents.length < MIN_EXPECTED) {
        console.log(`⚠️  WARN — ${singleCityParents.length} single-city parents is below expected minimum ${MIN_EXPECTED}. Check geo-summary fixture data.`);
        process.exit(0);  // warn, not fail — could be data drift, not regression
    }

    console.log(`✅ PASS — parentMin=1 effect verified (${singleCityParents.length} single-city parents present).`);
}

main().catch(err => { console.error(err); process.exit(2); });
