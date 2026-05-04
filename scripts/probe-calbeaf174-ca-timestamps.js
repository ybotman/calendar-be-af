// CALBEAF-174 — quick CA timestamp distribution probe.
// Hypothesis: California has 3 records per dupe-tuple (vs 2 elsewhere) because
// the geocoding-backfill script ran a SECOND time on a CA-specific subset.
// Test: pull all CA masteredcities, examine ObjectId timestamps, look for
// distinct creation cohorts.
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local.settings.json'), 'utf8'));

function objectIdToDate(id) {
    return new Date(parseInt(id.toString().slice(0, 8), 16) * 1000);
}

async function main() {
    const env = (process.argv[2] || 'test').toLowerCase();
    const uri = env === 'prod' ? settings.Values.MONGODB_URI_PROD : settings.Values.MONGODB_URI_TEST;
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        const cities = await db.collection('masteredcities').find(
            { stateName: 'California' },
            { projection: { _id: 1, cityName: 1, latitude: 1, __v: 1, active: 1 } }
        ).toArray();

        console.log(`California masteredcities on ${db.databaseName}: ${cities.length}\n`);
        const grouped = {};
        for (const c of cities) {
            grouped[c.cityName] = grouped[c.cityName] || [];
            grouped[c.cityName].push({
                _id: c._id.toString(),
                created: objectIdToDate(c._id).toISOString().slice(0, 10),
                hasLatLng: c.latitude !== undefined && c.latitude !== null,
                hasMongoose: c.__v !== undefined,
                hasLegacyActive: c.active !== undefined,
            });
        }

        for (const [name, records] of Object.entries(grouped)) {
            const dates = records.map(r => r.created).join(', ');
            console.log(`  ${name.padEnd(20)} (${records.length}x):  ${dates}`);
        }

        // Aggregate dupe counts by date pair signature
        const sigCounts = {};
        for (const records of Object.values(grouped)) {
            if (records.length < 2) continue;
            const sig = records.map(r => r.created).sort().join(' + ');
            sigCounts[sig] = (sigCounts[sig] || 0) + 1;
        }
        console.log('\nDupe-tuple signatures (date combinations):');
        for (const [sig, count] of Object.entries(sigCounts)) {
            console.log(`  ${sig}: ${count} tuples`);
        }
    } finally {
        await client.close();
    }
}
main().catch(err => { console.error(err); process.exit(1); });
