// Probe TEST data to determine whether read-only regression tests for the
// v1.32.x bundle are viable, or whether mutation tests are required.
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local.settings.json'), 'utf8'));

async function main() {
    const uri = settings.Values.MONGODB_URI_TEST;
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();

        // --- CALBEAF-168 (provenance fields on venues + organizers) ---
        const venuesDiscov = await db.collection('venues').countDocuments({ isDiscovered: true });
        const venuesWithSource = await db.collection('venues').countDocuments({ isDiscovered: true, discoverySource: { $exists: true, $type: 'string', $ne: '' } });
        const venuesWithBatch = await db.collection('venues').countDocuments({ isDiscovered: true, discoveryBatchId: { $exists: true, $type: 'string', $ne: '' } });

        const orgsDiscov = await db.collection('organizers').countDocuments({ isDiscovered: true });
        const orgsWithSource = await db.collection('organizers').countDocuments({ isDiscovered: true, discoverySource: { $exists: true, $type: 'string', $ne: '' } });
        const orgsWithBatch = await db.collection('organizers').countDocuments({ isDiscovered: true, discoveryBatchId: { $exists: true, $type: 'string', $ne: '' } });

        console.log('=== CALBEAF-168 fixture probe ===');
        console.log(`venues isDiscovered=true: ${venuesDiscov}  with discoverySource: ${venuesWithSource}  with discoveryBatchId: ${venuesWithBatch}`);
        console.log(`organizers isDiscovered=true: ${orgsDiscov}  with discoverySource: ${orgsWithSource}  with discoveryBatchId: ${orgsWithBatch}`);

        const sampleVenue = await db.collection('venues').findOne(
            { isDiscovered: true, discoverySource: { $exists: true } },
            { projection: { name: 1, isDiscovered: 1, discoverySource: 1, discoveryBatchId: 1 } }
        );
        console.log('  Sample venue:', sampleVenue ? JSON.stringify(sampleVenue) : 'NONE');

        // --- CALBEAF-172 (RA Create body — categoryFirst/categoryFirstId persisted) ---
        const raEvents = await db.collection('events').countDocuments({ createdByRA: { $exists: true } });
        const raWithCat = await db.collection('events').countDocuments({ createdByRA: { $exists: true }, categoryFirstId: { $exists: true, $ne: null } });
        const raWithIsRepeating = await db.collection('events').countDocuments({ createdByRA: { $exists: true }, isRepeating: { $exists: true } });
        const raWithRecurrenceRule = await db.collection('events').countDocuments({ createdByRA: { $exists: true }, recurrenceRule: { $exists: true, $type: 'string', $ne: '' } });

        console.log('\n=== CALBEAF-172 fixture probe ===');
        console.log(`events createdByRA: ${raEvents}  with categoryFirstId: ${raWithCat}  with isRepeating: ${raWithIsRepeating}  with non-empty recurrenceRule: ${raWithRecurrenceRule}`);

        const sampleRaEvent = await db.collection('events').findOne(
            { createdByRA: { $exists: true }, categoryFirstId: { $exists: true, $ne: null } },
            { projection: { title: 1, categoryFirst: 1, categoryFirstId: 1, isRepeating: 1, recurrenceRule: 1, forBeginners: 1, travelWorthy: 1, createdAt: 1 } }
        );
        console.log('  Sample RA-created event with category:', sampleRaEvent ? JSON.stringify(sampleRaEvent) : 'NONE');

        // --- parentMin=1 (geo-summary — read via API, not direct DB) ---
        // This one is tested via curl — see regression-v1.32.x.js
        console.log('\n=== parentMin=1 fixture probe ===');
        console.log('  Direct DB probe N/A — parentMin is computed at /api/seo/geo-summary request time.');
    } finally {
        await client.close();
    }
}
main().catch(err => { console.error(err); process.exit(1); });
