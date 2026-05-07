// CALBEAF-174 — investigate masteredcity duplicate records.
// Pattern-only investigation per Quinn directive (no fix code).
// Look for: how many duplicates total, what shape, when created (via ObjectId timestamp),
// any common signature in fields beyond cityName.
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');
const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local.settings.json'), 'utf8'));

function objectIdToDate(id) {
    // ObjectId has 4-byte timestamp prefix
    return new Date(parseInt(id.toString().slice(0, 8), 16) * 1000);
}

async function main() {
    const env = (process.argv[2] || 'test').toLowerCase();
    const uri = env === 'prod' ? settings.Values.MONGODB_URI_PROD : settings.Values.MONGODB_URI_TEST;
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        console.log(`\n=== CALBEAF-174 investigation: ${db.databaseName} ===\n`);

        // Step 1: aggregate by (cityName + stateName + countryCode)
        const dupes = await db.collection('masteredcities').aggregate([
            {
                $group: {
                    _id: {
                        cityName: '$cityName',
                        stateName: '$stateName',
                        countryCode: '$countryCode'
                    },
                    count: { $sum: 1 },
                    ids: { $push: '$_id' },
                    docs: { $push: '$$ROOT' }
                }
            },
            { $match: { count: { $gt: 1 } } },
            { $sort: { count: -1, '_id.cityName': 1 } }
        ]).toArray();

        console.log(`Distinct duplicate (cityName, stateName, countryCode) tuples: ${dupes.length}`);
        const totalDupeDocs = dupes.reduce((sum, d) => sum + d.count, 0);
        console.log(`Total duplicate records (sum across tuples): ${totalDupeDocs}`);
        console.log();

        // Group by created-date buckets to see if there are creation-time patterns
        const creationBuckets = {};
        for (const d of dupes) {
            for (const id of d.ids) {
                const date = objectIdToDate(id).toISOString().slice(0, 10);  // YYYY-MM-DD
                creationBuckets[date] = (creationBuckets[date] || 0) + 1;
            }
        }
        console.log('Creation-date buckets (top 10):');
        const sortedBuckets = Object.entries(creationBuckets).sort((a, b) => b[1] - a[1]).slice(0, 10);
        for (const [date, count] of sortedBuckets) {
            console.log(`  ${date}: ${count} records`);
        }
        console.log();

        // Show details for top 5 duplicate tuples
        console.log('Top 5 duplicate tuples (with full record details):');
        for (const d of dupes.slice(0, 5)) {
            const t = d._id;
            console.log(`\n  ${t.cityName}, ${t.stateName || t.countryCode} (count=${d.count})`);
            for (const doc of d.docs) {
                const created = objectIdToDate(doc._id).toISOString().slice(0, 10);
                const fieldSig = Object.keys(doc).filter(k => k !== '_id').sort().join(',');
                console.log(`    _id=${doc._id} (${created}) | latitude=${doc.latitude || 'null'} | longitude=${doc.longitude || 'null'} | fields=[${fieldSig}]`);
            }
        }

        // Check whether duplicates have geo-info diff (suggests geocoder runs created variants)
        let withCoords = 0, withoutCoords = 0;
        for (const d of dupes) {
            for (const doc of d.docs) {
                if (doc.latitude !== undefined && doc.longitude !== undefined) withCoords++;
                else withoutCoords++;
            }
        }
        console.log(`\nDuplicate records with lat/lng: ${withCoords}`);
        console.log(`Duplicate records without lat/lng: ${withoutCoords}`);

        // Check whether events reference the duplicates (different masteredCityIds for same city)
        const sampleDupe = dupes[0];
        if (sampleDupe) {
            console.log(`\nEvent references for "${sampleDupe._id.cityName}, ${sampleDupe._id.stateName || sampleDupe._id.countryCode}":`);
            for (const id of sampleDupe.ids) {
                const eventCount = await db.collection('events').countDocuments({ masteredCityId: id });
                const venueCount = await db.collection('venues').countDocuments({ masteredCityId: id });
                console.log(`  _id=${id}: ${eventCount} events, ${venueCount} venues`);
            }
        }
    } finally {
        await client.close();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
