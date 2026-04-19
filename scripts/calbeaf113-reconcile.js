#!/usr/bin/env node
// CALBEAF-113 math reconciliation — Quinn 04:48Z audit ask
// Why does dry-run show 369 would-change when earlier diagnosis said 4,771 null?
//
// Expected answer: Phase 5 backfill (CALBEAF-110, 2026-04-18) already filled
// region-chain-resolvable country for most events. The 369 are the residual
// that need the new priority-4 venue-chain fallback.

const { MongoClient } = require('mongodb');
const settings = require('../local.settings.json');
const uri = settings.Values.MONGODB_URI_TEST;

(async () => {
    const c = new MongoClient(uri); await c.connect();
    const col = c.db().collection('events');
    const appId = '1';

    const total = await col.countDocuments({ appId });
    const nullCountry = await col.countDocuments({ appId, $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }] });
    const hasCountry = total - nullCountry;

    const nullHasRegion = await col.countDocuments({
        appId,
        $and: [
            { $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }] },
            { masteredRegionId: { $ne: null, $exists: true } },
        ],
    });
    const nullNoRegionHasCity = await col.countDocuments({
        appId,
        $and: [
            { $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }] },
            { $or: [{ masteredRegionId: null }, { masteredRegionId: { $exists: false } }] },
            { masteredCityId: { $ne: null, $exists: true } },
        ],
    });
    const nullNoRegionNoCityHasVenue = await col.countDocuments({
        appId,
        $and: [
            { $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }] },
            { $or: [{ masteredRegionId: null }, { masteredRegionId: { $exists: false } }] },
            { $or: [{ masteredCityId: null }, { masteredCityId: { $exists: false } }] },
            { venueID: { $ne: null, $exists: true } },
        ],
    });
    const nullAllUpstreamNull = await col.countDocuments({
        appId,
        $and: [
            { $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }] },
            { $or: [{ masteredRegionId: null }, { masteredRegionId: { $exists: false } }] },
            { $or: [{ masteredCityId: null }, { masteredCityId: { $exists: false } }] },
            { $or: [{ venueID: null }, { venueID: { $exists: false } }] },
        ],
    });

    console.log('=== CALBEAF-113 country reconciliation (TEST, appId=1) ===');
    console.log(`Total events:                                  ${total}`);
    console.log(`Has masteredCountryId (non-null):              ${hasCountry}  (${(hasCountry / total * 100).toFixed(1)}%)`);
    console.log(`Null masteredCountryId:                        ${nullCountry}  (${(nullCountry / total * 100).toFixed(1)}%)`);
    console.log(`  └─ null AND has masteredRegionId:            ${nullHasRegion}  [region-chain reachable]`);
    console.log(`  └─ null, no region, has masteredCityId:      ${nullNoRegionHasCity}  [city-chain reachable]`);
    console.log(`  └─ null, no region/city, has venueID:        ${nullNoRegionNoCityHasVenue}  [PRIORITY-4 venue-chain]`);
    console.log(`  └─ null, all upstream null (stays null):     ${nullAllUpstreamNull}  [never-invent, correct]`);
    console.log();
    console.log(`Dry-run reported wouldChange: 369 (should ≈ sum of reachable rows above)`);
    console.log(`Reachable sum:                                 ${nullHasRegion + nullNoRegionHasCity + nullNoRegionNoCityHasVenue}`);
    console.log();
    console.log(`Post-apply prediction:`);
    console.log(`  With country:  ${hasCountry + nullHasRegion + nullNoRegionHasCity + nullNoRegionNoCityHasVenue} / ${total} (${((hasCountry + nullHasRegion + nullNoRegionHasCity + nullNoRegionNoCityHasVenue) / total * 100).toFixed(1)}%)`);
    console.log(`  Still null:    ${nullAllUpstreamNull} / ${total} (${(nullAllUpstreamNull / total * 100).toFixed(1)}%)  [correct — never-invent]`);

    await c.close();
})().catch((e) => { console.error(e); process.exit(1); });
