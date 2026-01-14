#!/usr/bin/env node
/**
 * Backfill script: Add appId to userlogins documents
 *
 * This script adds appId='1' (TangoTiempo) to all userlogins documents
 * that don't have the appId field.
 *
 * Usage:
 *   DRY RUN (default): node scripts/backfill-userlogins-appid.js
 *   EXECUTE:           node scripts/backfill-userlogins-appid.js --execute
 *
 * Environment:
 *   MONGODB_URI - MongoDB connection string (required)
 */

const { MongoClient } = require('mongodb');

// Try to load dotenv, but don't fail if not available
try {
    require('dotenv').config({ path: '.env.local' });
} catch (e) {
    // dotenv not installed, will use env vars directly
}

const DRY_RUN = !process.argv.includes('--execute');

async function backfillAppId() {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
        console.error('ERROR: MONGODB_URI environment variable not set');
        console.error('Set it in .env.local or export it before running');
        process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('Backfill: userlogins.appId');
    console.log('='.repeat(60));
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'EXECUTE (will modify data)'}`);
    console.log(`Database: ${mongoUri.includes('TangoTiempoProd') ? 'PROD' : 'TEST'}`);
    console.log('');

    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        console.log('Connected to MongoDB');

        const db = client.db();
        const userlogins = db.collection('userlogins');

        // Find all docs without appId
        const docsWithoutAppId = await userlogins.countDocuments({
            appId: { $exists: false }
        });

        const totalDocs = await userlogins.countDocuments({});
        const docsWithAppId = await userlogins.countDocuments({
            appId: { $exists: true }
        });

        console.log('Current state:');
        console.log(`  Total userlogins: ${totalDocs}`);
        console.log(`  With appId:       ${docsWithAppId}`);
        console.log(`  Without appId:    ${docsWithoutAppId}`);
        console.log('');

        if (docsWithoutAppId === 0) {
            console.log('All documents already have appId. No backfill needed.');
            return;
        }

        // Show sample of affected docs
        const samples = await userlogins.find(
            { appId: { $exists: false } },
            { projection: { firebaseUserId: 1, 'firebaseUserInfo.email': 1, createdAt: 1 } }
        ).limit(5).toArray();

        console.log('Sample documents to update:');
        samples.forEach((doc, i) => {
            console.log(`  ${i + 1}. ${doc.firebaseUserInfo?.email || doc.firebaseUserId} (created: ${doc.createdAt || 'unknown'})`);
        });
        console.log('');

        if (DRY_RUN) {
            console.log('DRY RUN - No changes made.');
            console.log('Run with --execute flag to apply changes.');
        } else {
            console.log('Executing backfill...');

            const result = await userlogins.updateMany(
                { appId: { $exists: false } },
                { $set: { appId: '1' } }
            );

            console.log(`Updated ${result.modifiedCount} documents with appId='1'`);

            // Verify
            const remainingWithoutAppId = await userlogins.countDocuments({
                appId: { $exists: false }
            });
            console.log(`Remaining without appId: ${remainingWithoutAppId}`);
        }

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        await client.close();
        console.log('');
        console.log('Done.');
    }
}

backfillAppId();
