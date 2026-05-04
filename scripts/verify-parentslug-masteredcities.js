// CALBEAF-173 M1 pre-work: verify whether parentSlug is denormalized on masteredcities
// in both TEST and PROD MongoDB.
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, '..', 'local.settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

async function checkEnv(label, uri) {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        console.log(`\n=== ${label} (db: ${db.databaseName}) ===`);

        const total = await db.collection('masteredcities').countDocuments();
        console.log(`Total masteredcities docs: ${total}`);

        const withParentSlug = await db.collection('masteredcities').countDocuments({
            parentSlug: { $exists: true, $ne: null, $ne: '' }
        });
        console.log(`Docs with non-empty parentSlug: ${withParentSlug}`);
        console.log(`Coverage: ${total > 0 ? ((withParentSlug / total) * 100).toFixed(1) : 0}%`);

        // Sample doc to inspect actual schema
        const sample = await db.collection('masteredcities').findOne(
            {},
            { projection: { cityName: 1, stateName: 1, stateCode: 1, countryCode: 1, parentSlug: 1, parentName: 1, citySlug: 1 } }
        );
        console.log('Sample doc fields:', JSON.stringify(sample, null, 2));

        // Coverage of stateName + stateCode + countryCode (the fields needed to compute parentSlug)
        const usCities       = await db.collection('masteredcities').countDocuments({ countryCode: 'US' });
        const usWithState    = await db.collection('masteredcities').countDocuments({ countryCode: 'US', stateName: { $exists: true, $ne: null, $ne: '' } });
        const usWithCode     = await db.collection('masteredcities').countDocuments({ countryCode: 'US', stateCode: { $exists: true, $ne: null, $ne: '' } });
        const intl           = await db.collection('masteredcities').countDocuments({ countryCode: { $ne: 'US' } });
        const intlWithCC     = await db.collection('masteredcities').countDocuments({ countryCode: { $ne: 'US', $exists: true, $ne: null, $ne: '' } });
        console.log(`US cities: ${usCities} | with stateName: ${usWithState} | with stateCode: ${usWithCode}`);
        console.log(`Intl cities: ${intl} | with countryCode: ${intlWithCC}`);

        // Find California cities by stateName
        const calCities = await db.collection('masteredcities').find(
            { stateName: 'California' },
            { projection: { cityName: 1, stateName: 1, stateCode: 1, _id: 1 } }
        ).limit(10).toArray();
        console.log(`California cities (by stateName, ${calCities.length}):`, JSON.stringify(calCities, null, 2));
    } finally {
        await client.close();
    }
}

(async () => {
    await checkEnv('TEST', settings.Values.MONGODB_URI_TEST);
    await checkEnv('PROD', settings.Values.MONGODB_URI_PROD);
})().catch(err => { console.error(err); process.exit(1); });
