#!/usr/bin/env node
// scripts/runDataQualityBackfill.js
// CALBEAF-110 Phase 5: Backfill via runDataQualityPipeline.
//
// FULL-HISTORY scan (per AIDI migration nudge — not 24h-bounded). Computes
// what runDataQualityPipeline would set on every event and reports diffs.
//
// AIDI Q1=C governance: --dry-run by default. --apply requires AIDI sign-off
// AND Toby personal review of the diff package. Toby gate is non-negotiable.
//
// PROD STAY-OUT: targets TEST only. Refuses PROD URI unless --i-know-prod
// (which Toby has not granted; do not set).
//
// Usage:
//   node scripts/runDataQualityBackfill.js --dry-run                  # default
//   node scripts/runDataQualityBackfill.js --dry-run --sample-size=50 # change sample count
//   node scripts/runDataQualityBackfill.js --apply                    # do not run without Toby auth
//   node scripts/runDataQualityBackfill.js --dry-run --output=/tmp/backfill-diff.json

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { runDataQualityPipeline } = require('../src/utils/enrichment');

function parseArgs() {
    const args = { dryRun: true, knowProd: false, envProd: false, sampleSize: 30, output: null, appId: '1', forceRecompute: false };
    for (const arg of process.argv.slice(2)) {
        if (arg === '--apply') args.dryRun = false;
        else if (arg === '--dry-run') args.dryRun = true;
        else if (arg === '--i-know-prod') args.knowProd = true;
        else if (arg === '--env=prod') { args.envProd = true; args.knowProd = true; }
        else if (arg === '--force-recompute') args.forceRecompute = true;
        else if (arg.startsWith('--sample-size=')) args.sampleSize = parseInt(arg.split('=')[1], 10);
        else if (arg.startsWith('--output=')) args.output = arg.split('=')[1];
        else if (arg.startsWith('--appid=')) args.appId = arg.split('=')[1];
    }
    return args;
}

function loadUri(envProd) {
    const key = envProd ? 'MONGODB_URI_PROD' : 'MONGODB_URI_TEST';
    const uri = process.env[key]
        || (function () {
            try {
                const settings = require('../local.settings.json');
                return settings.Values[key];
            } catch {
                return null;
            }
        })();
    if (!uri) {
        console.error(`ERROR: ${key} not configured`);
        process.exit(1);
    }
    return uri;
}

const TRACKED_FIELDS = [
    'forBeginners', 'beginnerFriendly', 'travelWorthy',
    'masteredCityId', 'masteredCityName',
    'masteredCountryId', 'masteredCountryName',
    'venueGeolocation', 'venueCityName', 'venueTimezone',
    'enrichmentStatus', 'masteringStatus',
];

function snapshot(event) {
    // Only call toString() on non-primitive objects (ObjectId, Date, Buffer).
    // Calling toString on booleans/strings/numbers corrupts the diff (e.g. bool true → "true").
    // AIDI blocker 1 (2026-04-18): previous implementation caused false diffs on booleans + strings.
    const s = {};
    for (const f of TRACKED_FIELDS) {
        const v = event[f];
        if (v === undefined || v === null) {
            s[f] = null;
        } else if (typeof v === 'object' && v.constructor && v.constructor.name === 'ObjectId') {
            s[f] = v.toString();
        } else if (v instanceof Date) {
            s[f] = v.toISOString();
        } else {
            s[f] = v;  // primitives + nested objects (geolocation, etc.) compared via JSON.stringify downstream
        }
    }
    return s;
}

function diff(before, after) {
    const changes = {};
    for (const f of TRACKED_FIELDS) {
        const b = JSON.stringify(before[f]);
        const a = JSON.stringify(after[f]);
        if (b !== a) changes[f] = { before: before[f], after: after[f] };
    }
    return changes;
}

async function main() {
    const args = parseArgs();
    const uri = loadUri(args.envProd);

    if (uri.toLowerCase().includes('prod') && !args.knowProd) {
        console.error('ERROR: URI looks like PROD. Refusing per CALBEAF-110 PROD STAY-OUT.');
        process.exit(2);
    }

    console.log(`=== CALBEAF-110 backfill ===`);
    console.log(`Mode: ${args.dryRun ? 'DRY-RUN (no writes)' : 'APPLY (requires Toby personal authorization)'}`);
    console.log(`AppId scope: ${args.appId}`);
    console.log(`Sample size for diff: ${args.sampleSize}`);
    console.log(`URI host: ${new URL(uri).host}`);
    console.log();

    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();
    const eventsCol = db.collection('events');

    const total = await eventsCol.countDocuments({ appId: args.appId });
    console.log(`Total events in scope: ${total.toLocaleString()}`);
    console.log();

    // Stats
    const fieldChangeCounts = {};
    for (const f of TRACKED_FIELDS) fieldChangeCounts[f] = 0;
    let categoryGateForced = 0;  // category gate flipped flags to false
    const perCategoryCounts = {};
    const sampleDiffs = [];
    let processed = 0;
    let wouldChange = 0;
    let pipelineErrors = 0;

    // Stream cursor
    const cursor = eventsCol.find({ appId: args.appId }).batchSize(500);

    // For --apply, accumulate bulk ops in chunks
    const bulkOpsBuffer = [];
    const BULK_FLUSH = 200;

    for await (const event of cursor) {
        processed++;
        try {
            const before = snapshot(event);
            const eventCopy = JSON.parse(JSON.stringify(event));
            const { event: updated } = await runDataQualityPipeline(eventCopy, db, { appId: args.appId, forceRecompute: args.forceRecompute });
            const after = snapshot(updated);
            const changes = diff(before, after);

            // Track per-category
            const cat = event.categoryFirst || '(unknown)';
            if (!perCategoryCounts[cat]) perCategoryCounts[cat] = { total: 0, changed: 0 };
            perCategoryCounts[cat].total++;

            if (Object.keys(changes).length > 0) {
                wouldChange++;
                perCategoryCounts[cat].changed++;
                for (const f of Object.keys(changes)) fieldChangeCounts[f]++;

                if (sampleDiffs.length < args.sampleSize) {
                    sampleDiffs.push({
                        eventId: event._id.toString(),
                        title: event.title,
                        category: cat,
                        startDate: event.startDate,
                        changes,
                    });
                }

                if (!args.dryRun) {
                    const setDoc = {};
                    for (const f of Object.keys(changes)) setDoc[f] = updated[f];
                    bulkOpsBuffer.push({
                        updateOne: {
                            filter: { _id: event._id },
                            update: { $set: setDoc },
                        }
                    });
                    if (bulkOpsBuffer.length >= BULK_FLUSH) {
                        const r = await eventsCol.bulkWrite(bulkOpsBuffer, { ordered: false });
                        bulkOpsBuffer.length = 0;
                        process.stderr.write(`.`);
                    }
                }
            }
        } catch (err) {
            pipelineErrors++;
            console.error(`Pipeline error on event ${event._id}: ${err.message}`);
        }

        if (processed % 1000 === 0) {
            process.stderr.write(`[${processed}/${total}]`);
        }
    }

    // Flush remaining bulk ops
    if (!args.dryRun && bulkOpsBuffer.length > 0) {
        await eventsCol.bulkWrite(bulkOpsBuffer, { ordered: false });
    }

    process.stderr.write('\n');
    await client.close();

    // Summary
    const summary = {
        meta: {
            mode: args.dryRun ? 'DRY-RUN' : 'APPLY',
            appId: args.appId,
            timestamp: new Date().toISOString(),
            processed,
            wouldChange,
            pipelineErrors,
        },
        fieldChangeCounts,
        perCategoryCounts,
        sampleDiffs,
    };

    console.log();
    console.log('=== SUMMARY ===');
    console.log(`Total processed:    ${processed.toLocaleString()}`);
    console.log(`Would change:       ${wouldChange.toLocaleString()} (${(wouldChange / processed * 100).toFixed(1)}%)`);
    console.log(`Pipeline errors:    ${pipelineErrors}`);
    console.log();
    console.log('--- Per-field change counts ---');
    for (const [f, c] of Object.entries(fieldChangeCounts)) {
        if (c > 0) console.log(`  ${f.padEnd(25)} ${c.toLocaleString()}`);
    }
    console.log();
    console.log('--- Per-category breakdown ---');
    const sortedCats = Object.entries(perCategoryCounts).sort((a, b) => b[1].changed - a[1].changed);
    for (const [cat, counts] of sortedCats) {
        console.log(`  ${cat.padEnd(20)} ${counts.changed.toLocaleString().padStart(6)} / ${counts.total.toLocaleString().padStart(6)} (${(counts.changed / counts.total * 100).toFixed(1)}%)`);
    }
    console.log();
    console.log(`--- ${args.sampleSize} sample diffs ---`);
    for (const s of sampleDiffs.slice(0, args.sampleSize)) {
        console.log();
        console.log(`[${s.eventId}] "${(s.title || '').substring(0, 80)}"`);
        console.log(`  Category: ${s.category}, Start: ${s.startDate}`);
        for (const [f, ch] of Object.entries(s.changes)) {
            console.log(`  ${f.padEnd(25)} ${JSON.stringify(ch.before).padEnd(40)} → ${JSON.stringify(ch.after)}`);
        }
    }

    if (args.output) {
        fs.writeFileSync(args.output, JSON.stringify(summary, null, 2));
        console.log();
        console.log(`Full diff package written to: ${args.output}`);
    }

    if (args.dryRun) {
        console.log();
        console.log('DRY-RUN complete — NO writes performed. Re-run with --apply ONLY after Toby personal authorization.');
    } else {
        console.log();
        console.log(`APPLY complete. ${wouldChange.toLocaleString()} events updated.`);
    }
}

main().catch(err => {
    console.error('FATAL:', err.message);
    console.error(err.stack);
    process.exit(1);
});
