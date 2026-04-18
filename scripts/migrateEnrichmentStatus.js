#!/usr/bin/env node
// scripts/migrateEnrichmentStatus.js
// CALBEAF-110 Phase 3: Add enrichmentStatus field + composite index to events collection.
//
// Per spec v1.4 §6:
//   - Field: enrichmentStatus enum ['complete','pending','failed'] default 'pending'
//   - Index: { appId: 1, enrichmentStatus: 1, updatedAt: -1 }
//   - Migration default for existing rows: 'complete' (assumes pre-D classifier ran;
//     Phase 5 backfill catches any genuine gaps via field-nullity check)
//
// PROD STAY-OUT: targets TEST DB only by default. Override env to target other DBs;
// will refuse to run against PROD URI unless explicitly forced via --i-know-prod.
//
// Usage:
//   node scripts/migrateEnrichmentStatus.js --dry-run     # preview, no writes
//   node scripts/migrateEnrichmentStatus.js --apply       # apply on TEST
//   node scripts/migrateEnrichmentStatus.js --apply --appid=1   # scope to specific appId

const { MongoClient } = require('mongodb');

function parseArgs() {
    const args = { dryRun: true, appId: null, knowProd: false };
    for (const arg of process.argv.slice(2)) {
        if (arg === '--apply') args.dryRun = false;
        else if (arg === '--dry-run') args.dryRun = true;
        else if (arg === '--i-know-prod') args.knowProd = true;
        else if (arg.startsWith('--appid=')) args.appId = arg.split('=')[1];
    }
    return args;
}

function loadUri() {
    // Default to TEST per PROD-STAY-OUT
    const uri = process.env.MONGODB_URI_TEST
        || (function () {
            // Fallback to local.settings.json if not in env (dev)
            try {
                const settings = require('../local.settings.json');
                return settings.Values.MONGODB_URI_TEST;
            } catch {
                return null;
            }
        })();
    if (!uri) {
        console.error('ERROR: MONGODB_URI_TEST not configured');
        process.exit(1);
    }
    return uri;
}

async function main() {
    const args = parseArgs();
    const uri = loadUri();

    // PROD-STAY-OUT guard
    if (uri.toLowerCase().includes('prod') && !args.knowProd) {
        console.error('ERROR: URI looks like PROD. Refusing per CALBEAF-110 PROD STAY-OUT hard rail.');
        console.error('       If you really need PROD (you do not), use --i-know-prod and reauthorize via Toby.');
        process.exit(2);
    }

    console.log(`=== CALBEAF-110 enrichmentStatus migration ===`);
    console.log(`Mode: ${args.dryRun ? 'DRY-RUN (no writes)' : 'APPLY'}`);
    console.log(`Scope: appId=${args.appId || 'ALL'}`);
    console.log(`URI host: ${new URL(uri).host}`);
    console.log();

    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();
    const events = db.collection('events');

    // 1. Count rows that would be touched
    const filter = { enrichmentStatus: { $exists: false } };
    if (args.appId) filter.appId = args.appId;

    const totalEventsAll = await events.countDocuments(args.appId ? { appId: args.appId } : {});
    const toAddDefault = await events.countDocuments(filter);
    console.log(`Events total (in scope): ${totalEventsAll.toLocaleString()}`);
    console.log(`Events without enrichmentStatus: ${toAddDefault.toLocaleString()}`);

    // 2. Index status
    const existingIndexes = await events.indexes();
    const targetIndexName = 'appId_1_enrichmentStatus_1_updatedAt_-1';
    const indexExists = existingIndexes.some(ix => ix.name === targetIndexName);
    console.log(`Composite index "${targetIndexName}": ${indexExists ? 'EXISTS' : 'MISSING'}`);

    // 3. Plan
    console.log();
    console.log('=== PLANNED ACTIONS ===');
    if (toAddDefault > 0) {
        console.log(`  + updateMany {enrichmentStatus: { $exists: false }${args.appId ? `, appId: '${args.appId}'` : ''}} → $set { enrichmentStatus: "complete" }`);
        console.log(`    Reason: pre-D events were classified by old pipeline. Phase 5 backfill catches genuine gaps.`);
    } else {
        console.log(`  - No event needs default-set.`);
    }
    if (!indexExists) {
        console.log(`  + createIndex { appId: 1, enrichmentStatus: 1, updatedAt: -1 } (background)`);
    } else {
        console.log(`  - Composite index already exists.`);
    }

    if (args.dryRun) {
        console.log();
        console.log('DRY-RUN — no changes made. Re-run with --apply to execute.');
        await client.close();
        return;
    }

    // 4. Apply
    console.log();
    console.log('=== APPLYING ===');
    const startTime = Date.now();

    if (toAddDefault > 0) {
        const result = await events.updateMany(filter, { $set: { enrichmentStatus: 'complete' } });
        console.log(`  updateMany done: matched=${result.matchedCount}, modified=${result.modifiedCount}`);
    }

    if (!indexExists) {
        await events.createIndex(
            { appId: 1, enrichmentStatus: 1, updatedAt: -1 },
            { background: true, name: targetIndexName }
        );
        console.log(`  createIndex done.`);
    }

    const durationMs = Date.now() - startTime;
    console.log();
    console.log(`Migration complete in ${durationMs}ms.`);

    // 5. Verify
    const remainingMissing = await events.countDocuments({ enrichmentStatus: { $exists: false } });
    console.log(`Verify: events without enrichmentStatus after migration = ${remainingMissing} (expect 0)`);

    await client.close();
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
