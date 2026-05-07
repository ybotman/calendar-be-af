#!/usr/bin/env node
// CALBEAF-151 one-off backfill: every userlogin with RegionalOrganizer in roleIds
// also gets Spotlighter via $addToSet. Idempotent.
//
// Usage:
//   node scripts/backfill-spotlighter-for-ro.js                     # DRY-RUN against TEST
//   node scripts/backfill-spotlighter-for-ro.js --apply              # write to TEST
//   node scripts/backfill-spotlighter-for-ro.js --env=prod           # DRY-RUN against PROD
//   node scripts/backfill-spotlighter-for-ro.js --env=prod --apply --i-confirm-prod   # write to PROD
//
// Safety:
//   - --env=prod requires --i-confirm-prod
//   - aborts if URI doesn't match expected env DB
//   - prints affected list before write

'use strict';
const fs = require('fs');
const { MongoClient, ObjectId } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const PROD_MODE = process.argv.includes('--env=prod');
const PROD_CONFIRMED = process.argv.includes('--i-confirm-prod');

(async () => {
    if (PROD_MODE && APPLY && !PROD_CONFIRMED) {
        console.error('REFUSE: --env=prod --apply requires --i-confirm-prod');
        process.exit(1);
    }

    const settings = JSON.parse(fs.readFileSync('local.settings.json', 'utf8'));
    const uri = PROD_MODE ? settings.Values.MONGODB_URI_PROD : settings.Values.MONGODB_URI;
    const expectedDb = PROD_MODE ? 'TangoTiempoProd' : 'TangoTiempoTest';

    if (!uri) {
        console.error(`ERROR: ${PROD_MODE ? 'MONGODB_URI_PROD' : 'MONGODB_URI'} not in local.settings.json`);
        process.exit(1);
    }
    if (!uri.toLowerCase().includes(expectedDb.toLowerCase())) {
        console.error(`SAFETY ABORT: URI does not target ${expectedDb}`);
        process.exit(1);
    }

    console.log('=== CALBEAF-151 backfill: SL for RO users ===');
    console.log('Env:', PROD_MODE ? 'PROD' : 'TEST');
    console.log('Expected DB:', expectedDb);
    console.log('Mode:', APPLY ? 'APPLY' : 'DRY_RUN');
    console.log('');

    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();
    if (db.databaseName !== expectedDb) {
        console.error('SAFETY ABORT: db.databaseName =', db.databaseName, '— expected', expectedDb);
        await client.close();
        process.exit(1);
    }
    console.log('✅ Connected to', db.databaseName);

    // Look up role _ids for appId=1
    const ro = await db.collection('roles').findOne({ roleName: 'RegionalOrganizer', appId: '1' });
    const sl = await db.collection('roles').findOne({ roleName: 'Spotlighter', appId: '1' });
    if (!ro || !sl) {
        console.error('ABORT: missing roles. RO:', !!ro, 'SL:', !!sl);
        await client.close();
        process.exit(1);
    }
    console.log('RO _id:', ro._id.toString());
    console.log('SL _id:', sl._id.toString());

    // Find userlogins with RO but not SL
    const candidates = await db.collection('userlogins').find({
        appId: '1',
        roleIds: ro._id,
        $nor: [{ roleIds: sl._id }]
    }).toArray();

    console.log('\n=== AFFECTED USERLOGINS (have RO, lack SL) ===');
    console.log('Count:', candidates.length);
    for (const u of candidates) {
        console.log('  _id:', u._id.toString(),
            ' uid:', u.firebaseUserId,
            ' email:', u.firebaseUserInfo?.email || '(none)',
            ' roleIds count:', (u.roleIds || []).length);
    }

    if (candidates.length === 0) {
        console.log('\nNothing to do.');
        await client.close();
        return;
    }

    if (!APPLY) {
        console.log('\nDRY-RUN — no writes. Re-run with --apply to add SL via $addToSet to all listed.');
        await client.close();
        return;
    }

    // Apply
    console.log('\n=== APPLY ===');
    const result = await db.collection('userlogins').updateMany(
        { _id: { $in: candidates.map(c => c._id) } },
        { $addToSet: { roleIds: sl._id }, $set: { updatedAt: new Date() } }
    );
    console.log('updateMany:', { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });

    // Verify
    const stillMissing = await db.collection('userlogins').countDocuments({
        appId: '1',
        roleIds: ro._id,
        $nor: [{ roleIds: sl._id }]
    });
    console.log('Post-state: userlogins with RO-but-no-SL:', stillMissing, '(expected 0)');

    await client.close();
    console.log('Done.');
})().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
