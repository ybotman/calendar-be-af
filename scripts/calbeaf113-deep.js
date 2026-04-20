#!/usr/bin/env node
// Why does venue-chain resolve for only 369 of 4,739 null-country-with-venue?
// Check venue.masteredCityId populated rate.

const { MongoClient, ObjectId } = require('mongodb');
const settings = require('../local.settings.json');
const uri = settings.Values.MONGODB_URI_TEST;

(async () => {
    const c = new MongoClient(uri); await c.connect();
    const db = c.db();
    const col = db.collection('events');
    const venCol = db.collection('venues');
    const appId = '1';

    const nullCountryHasVenue = await col.find({
        appId,
        $and: [
            { $or: [{ masteredCountryId: null }, { masteredCountryId: { $exists: false } }] },
            { $or: [{ masteredRegionId: null }, { masteredRegionId: { $exists: false } }] },
            { $or: [{ masteredCityId: null }, { masteredCityId: { $exists: false } }] },
            { venueID: { $ne: null, $exists: true } },
        ],
    }).project({ _id: 1, venueID: 1 }).toArray();

    console.log(`Events null-country + no-region/city + has venueID: ${nullCountryHasVenue.length}`);

    // Check each venue
    const venueIds = [...new Set(nullCountryHasVenue.map(e => e.venueID).filter(Boolean))];
    console.log(`Distinct venues referenced: ${venueIds.length}`);

    const sampleIds = venueIds.slice(0, 500);
    // Try both ObjectId and string match since venueID may be stored as either
    const venuesById = await venCol.find({
        $or: [
            { _id: { $in: sampleIds.map(id => { try { return new ObjectId(id); } catch { return null; } }).filter(Boolean) } },
            { _id: { $in: sampleIds } },
        ],
    }).project({ _id: 1, masteredCityId: 1 }).toArray();

    const vMap = new Map();
    for (const v of venuesById) vMap.set(v._id.toString(), v);

    let found = 0, notFound = 0, withCity = 0, noCity = 0;
    for (const id of sampleIds) {
        const v = vMap.get(id.toString()) || vMap.get(id);
        if (!v) { notFound++; continue; }
        found++;
        if (v.masteredCityId) withCity++; else noCity++;
    }

    console.log(`\nSample of ${sampleIds.length} venues:`);
    console.log(`  Found in venues collection:    ${found}`);
    console.log(`  NOT found (venueID orphan):    ${notFound}`);
    console.log(`  Found + has masteredCityId:    ${withCity}`);
    console.log(`  Found but NO masteredCityId:   ${noCity}`);

    // Check venueID type distribution
    const evWithVenue = await col.findOne({ appId, venueID: { $ne: null, $exists: true } }, { projection: { venueID: 1 } });
    console.log(`\nSample venueID from events:      ${JSON.stringify(evWithVenue?.venueID)} (type: ${typeof evWithVenue?.venueID})`);
    const v0 = await venCol.findOne({}, { projection: { _id: 1 } });
    console.log(`Sample _id from venues:          ${JSON.stringify(v0?._id)} (type: ${typeof v0?._id})`);

    await c.close();
})().catch((e) => { console.error(e); process.exit(1); });
