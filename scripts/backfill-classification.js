#!/usr/bin/env node
/**
 * CALBEAF-109: Backfill event classification fields
 *
 * Backfills: travelWorthy, beginnerFriendly, masteredCountryId, masteredCountryName
 * Also creates required indexes.
 *
 * Usage:
 *   node scripts/backfill-classification.js --env=test --dry-run
 *   node scripts/backfill-classification.js --env=test
 *   node scripts/backfill-classification.js --env=prod   # requires PROD approval
 *
 * Flags:
 *   --env=test|prod   Target environment (required)
 *   --dry-run         Preview changes without writing (default: true if omitted)
 *   --apply           Actually write changes (must be explicit)
 *   --skip-indexes    Skip index creation
 *   --app-id=1        Application ID (default: 1 = TangoTiempo)
 */

const { MongoClient, ObjectId } = require('mongodb');

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, val] = arg.replace(/^--/, '').split('=');
    acc[key] = val || true;
    return acc;
}, {});

const ENV = args.env;
const DRY_RUN = !args.apply;
const SKIP_INDEXES = !!args['skip-indexes'];
const APP_ID = args['app-id'] || '1';

if (!ENV || !['test', 'prod'].includes(ENV)) {
    console.error('Usage: node scripts/backfill-classification.js --env=test|prod [--apply] [--skip-indexes]');
    process.exit(1);
}

// Categories that never qualify as travelWorthy
const EXCLUDED_CATEGORY_NAMES = ['Class', 'Milonga', 'Practica'];

async function getMongoUri(env) {
    if (env === 'prod') {
        return process.env.MONGODB_URI_PROD || process.env.MONGODB_URI;
    }
    return process.env.MONGODB_URI;
}

async function createIndexes(db) {
    console.log('\n=== Creating indexes ===');
    const events = db.collection('events');

    const indexes = [
        {
            name: 'idx_travelWorthy_compound',
            spec: { appId: 1, travelWorthy: 1, isActive: 1, startDate: 1 },
            options: {}
        },
        {
            name: 'idx_beginnerFriendly_compound',
            spec: { appId: 1, beginnerFriendly: 1, isActive: 1, startDate: 1 },
            options: {}
        },
        {
            name: 'idx_country_travelWorthy_partial',
            spec: { appId: 1, masteredCountryName: 1, startDate: 1 },
            options: { partialFilterExpression: { travelWorthy: true } }
        }
    ];

    for (const idx of indexes) {
        if (DRY_RUN) {
            console.log(`  [DRY-RUN] Would create index: ${idx.name}`);
            console.log(`    spec: ${JSON.stringify(idx.spec)}`);
            if (Object.keys(idx.options).length) {
                console.log(`    options: ${JSON.stringify(idx.options)}`);
            }
        } else {
            try {
                await events.createIndex(idx.spec, { name: idx.name, ...idx.options });
                console.log(`  ✅ Created index: ${idx.name}`);
            } catch (err) {
                if (err.code === 85 || err.code === 86) {
                    console.log(`  ⚠️  Index ${idx.name} already exists (or conflicts) — skipping`);
                } else {
                    throw err;
                }
            }
        }
    }
}

async function backfillEvents(db) {
    console.log('\n=== Backfilling event classification fields ===');
    console.log(`  Environment: ${ENV}`);
    console.log(`  AppId: ${APP_ID}`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (preview only)' : 'APPLY (writing changes)'}`);

    const events = db.collection('events');
    const categories = db.collection('categories');
    const regions = db.collection('masteredregions');
    const countries = db.collection('masteredcountries');

    // Build category exclusion set
    const allCats = await categories.find({ appId: APP_ID }).project({ _id: 1, categoryName: 1 }).toArray();
    const excludedCatIds = new Set(
        allCats.filter(c => EXCLUDED_CATEGORY_NAMES.includes(c.categoryName)).map(c => c._id.toString())
    );
    console.log(`\n  Categories loaded: ${allCats.length} total, ${excludedCatIds.size} excluded (${EXCLUDED_CATEGORY_NAMES.join(', ')})`);

    // Build region→country cache
    const allRegions = await regions.find({}).project({ _id: 1, masteredCountryId: 1 }).toArray();
    const regionToCountryId = new Map();
    for (const r of allRegions) {
        if (r.masteredCountryId) {
            regionToCountryId.set(r._id.toString(), r.masteredCountryId);
        }
    }

    const allCountries = await countries.find({}).project({ _id: 1, countryName: 1 }).toArray();
    const countryIdToName = new Map();
    for (const c of allCountries) {
        countryIdToName.set(c._id.toString(), c.countryName);
    }
    console.log(`  Regions loaded: ${allRegions.length} (${regionToCountryId.size} with country)`);
    console.log(`  Countries loaded: ${allCountries.length}`);

    // Fetch all events for this appId
    const allEvents = await events.find({ appId: APP_ID }).toArray();
    console.log(`\n  Total events: ${allEvents.length}`);

    // Stats
    const stats = {
        total: allEvents.length,
        travelWorthyTrue: 0,
        travelWorthyFalse: 0,
        beginnerFriendlyTrue: 0,
        beginnerFriendlyFalse: 0,
        countryResolved: 0,
        countryNull: 0,
        regionNull: 0,
        alreadyHasFields: 0,
        updated: 0
    };

    const BATCH_SIZE = 100;
    let bulkOps = [];

    for (const event of allEvents) {
        // Check if already backfilled
        if (event.travelWorthy !== undefined && event.masteredCountryName !== undefined) {
            stats.alreadyHasFields++;
            continue;
        }

        // Compute travelWorthy
        let travelWorthy = false;
        if (event.startDate && event.endDate) {
            const durationHours = (new Date(event.endDate) - new Date(event.startDate)) / (1000 * 60 * 60);
            if (durationHours > 24) {
                const catId = event.categoryFirstId ? event.categoryFirstId.toString() : null;
                travelWorthy = catId ? !excludedCatIds.has(catId) : true;
            }
        }

        // Resolve country
        let masteredCountryId = null;
        let masteredCountryName = null;
        if (event.masteredRegionId) {
            const regionKey = event.masteredRegionId.toString();
            const countryId = regionToCountryId.get(regionKey);
            if (countryId) {
                masteredCountryId = countryId;
                masteredCountryName = countryIdToName.get(countryId.toString()) || null;
            }
        }

        // Track stats
        if (travelWorthy) stats.travelWorthyTrue++;
        else stats.travelWorthyFalse++;
        stats.beginnerFriendlyFalse++; // All default false
        if (masteredCountryName) stats.countryResolved++;
        else if (!event.masteredRegionId) stats.regionNull++;
        else stats.countryNull++;

        const updateSet = {
            travelWorthy,
            beginnerFriendly: false,
            travelWorthyOverride: null,
            beginnerFriendlyOverride: null,
            masteredCountryId,
            masteredCountryName
        };

        if (!DRY_RUN) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: event._id },
                    update: { $set: updateSet }
                }
            });

            if (bulkOps.length >= BATCH_SIZE) {
                const result = await events.bulkWrite(bulkOps);
                stats.updated += result.modifiedCount;
                process.stdout.write(`  Updated ${stats.updated}/${stats.total}...\r`);
                bulkOps = [];
            }
        }
    }

    // Flush remaining
    if (!DRY_RUN && bulkOps.length > 0) {
        const result = await events.bulkWrite(bulkOps);
        stats.updated += result.modifiedCount;
    }

    // Report
    console.log('\n\n=== Backfill Results ===');
    console.log(`  Total events:           ${stats.total}`);
    console.log(`  Already had fields:     ${stats.alreadyHasFields}`);
    console.log(`  travelWorthy = true:    ${stats.travelWorthyTrue}`);
    console.log(`  travelWorthy = false:   ${stats.travelWorthyFalse}`);
    console.log(`  beginnerFriendly:       all ${stats.beginnerFriendlyFalse} set to false (conservative default)`);
    console.log(`  Country resolved:       ${stats.countryResolved}`);
    console.log(`  Country null (no region): ${stats.regionNull}`);
    console.log(`  Country null (region exists but no country link): ${stats.countryNull}`);
    if (!DRY_RUN) {
        console.log(`  Documents updated:      ${stats.updated}`);
    } else {
        console.log(`  [DRY-RUN] No documents were modified.`);
    }

    return stats;
}

async function main() {
    console.log('CALBEAF-109: Event Classification Backfill');
    console.log('==========================================');

    // Load env from local.settings.json if available
    try {
        const settings = require('../local.settings.json');
        if (settings.Values) {
            for (const [k, v] of Object.entries(settings.Values)) {
                if (!process.env[k]) {
                    process.env[k] = v;
                }
            }
        }
    } catch {
        // No local.settings.json — rely on environment variables
    }

    const uri = await getMongoUri(ENV);
    if (!uri) {
        console.error(`No MongoDB URI found for env=${ENV}. Set MONGODB_URI or MONGODB_URI_PROD.`);
        process.exit(1);
    }

    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        console.log(`Connected to: ${db.databaseName}`);

        if (!SKIP_INDEXES) {
            await createIndexes(db);
        }

        const stats = await backfillEvents(db);

        console.log('\n✅ Done.');
        if (DRY_RUN) {
            console.log('   This was a dry run. Use --apply to write changes.');
        }

        return stats;
    } finally {
        await client.close();
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
