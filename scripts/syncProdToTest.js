// scripts/syncProdToTest.js
/**
 * Synchronize data from PRODUCTION to TEST MongoDB
 * 
 * This script copies collections from production to test environment
 * IMPORTANT: Existing TEST collections are RENAMED with timestamp backup, not deleted
 * Example: venues → venues_backup_2025-07-24T03-45-00-000Z
 * 
 * Collections synchronized:
 * - Dimensional data: categories, masteredcities, masteredcountries, mastereddivisions, masteredregions
 * - Master data: organizers, venues, roles
 * - Optional: events, userlogins (with various filtering options)
 * 
 * Usage:
 *   # Copy only dimensional/master data
 *   node scripts/syncProdToTest.js
 *   
 *   # Include all events and users (backward compatible)
 *   node scripts/syncProdToTest.js --include-transactional
 *   
 *   # Include events with date filtering
 *   node scripts/syncProdToTest.js --include-events --events-from 2024-01-01 --events-to 2024-12-31
 *   node scripts/syncProdToTest.js --include-events --events-days 30 --events-future
 *   node scripts/syncProdToTest.js --include-events --events-all
 *   
 *   # Include only users
 *   node scripts/syncProdToTest.js --include-users
 *   
 *   # Dry run mode
 *   node scripts/syncProdToTest.js --include-events --events-future --dry-run
 * 
 * Event filtering options:
 *   --include-events      Include events collection
 *   --include-users       Include userlogins collection
 *   --events-all          Copy all events (no date filtering)
 *   --events-from <date>  Start date for events (YYYY-MM-DD format)
 *   --events-to <date>    End date for events (YYYY-MM-DD format)
 *   --events-days <n>     Include events from last n days
 *   --events-future       Include all future events (from today)
 * 
 * Required environment variables:
 *   MONGODB_URI_PROD - Production database connection string
 *   MONGODB_URI_TEST - Test database connection string
 * 
 * Backup collections are preserved and can be manually dropped later if desired
 */

// Load environment from local.settings.json (Azure Functions style)
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// Try to load local.settings.json for Azure Functions projects
const localSettingsPath = path.join(__dirname, '../local.settings.json');
if (fs.existsSync(localSettingsPath)) {
  const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf8'));
  Object.assign(process.env, localSettings.Values || {});
}

// Simple logger (no external dependency)
const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || '')
};

// Parse command line arguments
const args = process.argv.slice(2);
const includeTransactional = args.includes('--include-transactional');
const dryRun = args.includes('--dry-run');

// CALBEAF-110 FTPNTD fix (Toby 2026-04-18): events + users default ON.
// Prior behavior (opt-in via --include-events) led to silent TEST gaps where dimensional
// data was synced but real events were missing — operators thought "I did a full pull"
// but the test mirror excluded events. Use --skip-events / --skip-users to opt out.
const skipEvents = args.includes('--skip-events');
const skipUsers = args.includes('--skip-users');
const includeEvents = !skipEvents || args.includes('--include-events') || includeTransactional;
const includeUsers = !skipUsers || args.includes('--include-users') || includeTransactional;

// Events filtering — if not specified, default to --events-all (full-history mirror).
// Prior default was a narrow window that further contributed to silent gaps.
const eventsAll = args.includes('--events-all') || (includeEvents && !args.some(a => a === '--events-future' || a.startsWith('--events-from') || a.startsWith('--events-to') || a.startsWith('--events-days')));
const eventsFuture = args.includes('--events-future');

// Date range parsing
const eventsFromIndex = args.indexOf('--events-from');
const eventsToIndex = args.indexOf('--events-to');
const eventsDaysIndex = args.indexOf('--events-days');

const eventsFrom = eventsFromIndex > -1 ? args[eventsFromIndex + 1] : null;
const eventsTo = eventsToIndex > -1 ? args[eventsToIndex + 1] : null;
const eventsDays = eventsDaysIndex > -1 ? parseInt(args[eventsDaysIndex + 1]) : null;

// Collections to copy - dimensional and master data
const DIMENSIONAL_COLLECTIONS = [
  'categories',
  'masteredcities',
  'masteredcountries',
  'mastereddivisions',
  'masteredregions',
  'organizers',
  'roles',
  'venues'
];

// Transactional collections (optional)
const TRANSACTIONAL_COLLECTIONS = [
  'events',
  'userlogins'
];

// Build collections list based on flags
let collectionsToSync = [...DIMENSIONAL_COLLECTIONS];
if (includeEvents) collectionsToSync.push('events');
if (includeUsers) collectionsToSync.push('userlogins');

// Logging setup
const LOG_DIR = path.join(__dirname, '../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const timestamp = new Date().toISOString().split('T')[0];
const logFile = path.join(LOG_DIR, `syncProdToTest_${timestamp}.json`);

// Initialize operation log
const operationLog = {
  timestamp: new Date().toISOString(),
  operation: 'syncProdToTest',
  dryRun,
  includeTransactional,
  includeEvents,
  includeUsers,
  eventFilters: {
    eventsAll,
    eventsFuture,
    eventsFrom,
    eventsTo,
    eventsDays
  },
  collections: collectionsToSync,
  results: {},
  errors: [],
  summary: {
    totalCollections: collectionsToSync.length,
    successfulCollections: 0,
    failedCollections: 0,
    totalDocumentsCopied: 0
  }
};

// Build event query filter based on flags
function buildEventQuery() {
  // If --events-all or --include-transactional, no filtering
  if (eventsAll || (includeTransactional && !eventsFrom && !eventsTo && !eventsDays && !eventsFuture)) {
    return {};
  }

  const query = {};
  const dateConditions = [];
  const now = new Date();

  // Date range from --events-from and --events-to
  if (eventsFrom || eventsTo) {
    const dateRange = {};
    if (eventsFrom) {
      dateRange.$gte = new Date(eventsFrom);
    }
    if (eventsTo) {
      const endDate = new Date(eventsTo);
      endDate.setHours(23, 59, 59, 999); // Include entire end day
      dateRange.$lte = endDate;
    }
    dateConditions.push({ startDate: dateRange });
  }

  // Days filter
  if (eventsDays) {
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - eventsDays);
    dateConditions.push({ startDate: { $gte: daysAgo } });
  }

  // Future events
  if (eventsFuture) {
    dateConditions.push({ startDate: { $gte: now } });
  }

  // Combine conditions with OR if multiple exist
  if (dateConditions.length > 0) {
    query.$or = dateConditions;
  }

  return query;
}

async function syncProdToTest() {
  const prodUri = process.env.MONGODB_URI_PROD;
  const testUri = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI; // Fallback to default URI

  if (!prodUri) {
    const error = 'MONGODB_URI_PROD not set in .env file';
    logger.error(error);
    operationLog.errors.push(error);
    await saveLog();
    process.exit(1);
  }
  
  if (!testUri) {
    const error = 'MONGODB_URI_TEST not set in .env file';
    logger.error(error);
    operationLog.errors.push(error);
    await saveLog();
    process.exit(1);
  }

  logger.info('Starting PROD to TEST synchronization', {
    dryRun,
    includeTransactional,
    includeEvents,
    includeUsers,
    eventFilters: operationLog.eventFilters,
    collections: collectionsToSync
  });

  let prodClient, testClient;

  try {
    // Connect to PROD
    logger.info('Connecting to PRODUCTION MongoDB...');
    prodClient = new MongoClient(prodUri);
    await prodClient.connect();
    logger.info('Connected to PRODUCTION MongoDB');
    
    // Connect to TEST
    logger.info('Connecting to TEST MongoDB...');
    testClient = new MongoClient(testUri);
    await testClient.connect();
    logger.info('Connected to TEST MongoDB');

    // Get database references
    const prodDb = prodClient.db('TangoTiempoProd');
    const testDb = testClient.db('TangoTiempoTest'); // Adjust if your test DB has different name

    // Sync each collection
    for (const collectionName of collectionsToSync) {
      logger.info(`\n--- Processing collection: ${collectionName} ---`);
      
      try {
        const prodCollection = prodDb.collection(collectionName);
        const testCollection = testDb.collection(collectionName);

        // Build query for events collection
        const query = collectionName === 'events' ? buildEventQuery() : {};
        
        // Count documents in source
        const sourceCount = await prodCollection.countDocuments(query);
        logger.info(`Found ${sourceCount} documents in PROD ${collectionName}`);

        if (dryRun) {
          // Dry run - just count and log
          const targetCount = await testCollection.countDocuments({});
          const backupName = `${collectionName}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
          logger.info(`DRY RUN: Would rename TEST ${collectionName} to ${backupName}`);
          logger.info(`DRY RUN: Would copy ${sourceCount} docs to TEST ${collectionName}`);
          
          operationLog.results[collectionName] = {
            status: 'dry-run',
            sourceCount,
            targetCountBefore: targetCount,
            wouldBackupAs: backupName,
            wouldCopy: sourceCount
          };
        } else {
          // Actual sync
          // Create backup collection name with timestamp
          const backupName = `${collectionName}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
          
          // Check if collection exists and has data
          const targetCount = await testCollection.countDocuments({});
          
          if (targetCount > 0) {
            // Rename existing collection to backup
            logger.info(`Renaming TEST ${collectionName} to ${backupName} (${targetCount} documents)`);
            await testCollection.rename(backupName);
            logger.info(`Backup created: ${backupName}`);
          } else {
            logger.info(`TEST ${collectionName} is empty, no backup needed`);
          }

          // Copy documents from PROD to TEST (with filtering for events)
          if (sourceCount > 0) {
            const documents = await prodCollection.find(query).toArray();
            const insertResult = await testCollection.insertMany(documents);
            logger.info(`Inserted ${insertResult.insertedCount} documents into TEST ${collectionName}`);
            
            operationLog.results[collectionName] = {
              status: 'success',
              sourceCount,
              backupName: targetCount > 0 ? backupName : null,
              backupDocCount: targetCount,
              insertedCount: insertResult.insertedCount,
              ...(collectionName === 'events' && Object.keys(query).length > 0 ? { eventQuery: query } : {})
            };
            
            operationLog.summary.totalDocumentsCopied += insertResult.insertedCount;
          } else {
            operationLog.results[collectionName] = {
              status: 'success',
              sourceCount: 0,
              backupName: targetCount > 0 ? backupName : null,
              backupDocCount: targetCount,
              insertedCount: 0,
              ...(collectionName === 'events' && Object.keys(query).length > 0 ? { eventQuery: query } : {})
            };
          }
        }
        
        operationLog.summary.successfulCollections++;
        
      } catch (collectionError) {
        logger.error(`Error processing collection ${collectionName}:`, collectionError);
        operationLog.results[collectionName] = {
          status: 'error',
          error: collectionError.message
        };
        operationLog.summary.failedCollections++;
        operationLog.errors.push(`${collectionName}: ${collectionError.message}`);
      }
    }

    // Recreate essential indexes on synced collections
    // The sync renames old collections (with indexes) to backups and creates fresh ones
    // without indexes. Geo indexes are critical for location queries.
    //
    // Canonical geo field inventory (verified 2026-04-17):
    //   locations.geolocation            (GeoJSON Point)
    //   events.venueGeolocation          (denormalized from venue)
    //   events.masteredCityGeolocation   (denormalized from mastered city)
    //   masteredcities.location          (GeoJSON Point)
    //   venues.geolocation               (GeoJSON Point — NOT venueGeolocation)
    //   calculatedcities.location        (GeoJSON Point)
    //
    // WARNING: venues uses 'geolocation', but events uses 'venueGeolocation'.
    // Do not conflate. Getting this wrong silently creates an index on a
    // non-existent field (was the root cause of Porter's $geoNear failure).
    if (!dryRun) {
      logger.info('\n--- Recreating essential indexes ---');
      try {
        if (collectionsToSync.includes('masteredcities')) {
          await testDb.collection('masteredcities').createIndex({ location: '2dsphere' });
          logger.info('  ✅ masteredcities.location (2dsphere)');
        }
        if (collectionsToSync.includes('venues')) {
          await testDb.collection('venues').createIndex({ geolocation: '2dsphere' });
          logger.info('  ✅ venues.geolocation (2dsphere)');
        }
        if (collectionsToSync.includes('events')) {
          await testDb.collection('events').createIndex({ venueGeolocation: '2dsphere' });
          await testDb.collection('events').createIndex({ masteredCityGeolocation: '2dsphere' });
          logger.info('  ✅ events.venueGeolocation (2dsphere)');
          logger.info('  ✅ events.masteredCityGeolocation (2dsphere)');
        }
        logger.info('Index recreation complete');
      } catch (indexError) {
        logger.error('Index recreation failed (non-fatal):', indexError.message);
        operationLog.errors.push(`Index recreation: ${indexError.message}`);
      }
    } else {
      logger.info('\nDRY RUN: Would recreate 2dsphere indexes on masteredcities, venues, events');
    }

    // Generate summary
    const summary = dryRun ? 'DRY RUN COMPLETED' : 'SYNC COMPLETED';
    logger.info(`\n${summary}`);
    logger.info('Summary:', operationLog.summary);

    // CALBEAF-110 FTPNTD (Toby 2026-04-18): post-sync sanity check fails LOUD if TEST
    // event count is suspiciously low vs PROD for known-active organizers. Addresses
    // the "I thought I did a full pull" false-confidence scenario.
    if (!dryRun && includeEvents) {
      try {
        const prodDb = prodClient.db('TangoTiempoProd');
        const testDb = testClient.db('TangoTiempoTest');
        const prodCount = await prodDb.collection('events').countDocuments({ appId: '1' });
        const testCount = await testDb.collection('events').countDocuments({ appId: '1' });
        const ratio = prodCount > 0 ? testCount / prodCount : 1;
        logger.info(`\n--- Post-sync sanity check ---`);
        logger.info(`  PROD events (appId=1): ${prodCount}`);
        logger.info(`  TEST events (appId=1): ${testCount}`);
        logger.info(`  Ratio (TEST/PROD): ${(ratio * 100).toFixed(1)}%`);
        if (ratio < 0.5) {
          logger.error(`SANITY CHECK FAILED: TEST event count (${testCount}) is less than 50% of PROD (${prodCount}). This usually means events were NOT synced. Re-run with explicit --include-events --events-all flag, or investigate filter logic.`);
          process.exitCode = 3;
        } else {
          logger.info(`  ✓ Sanity check passed.`);
        }
      } catch (err) {
        logger.warn(`Sanity check threw: ${err.message}`);
      }
    }

  } catch (error) {
    logger.error('Fatal error during sync:', error);
    operationLog.errors.push(`Fatal: ${error.message}`);
    throw error;
  } finally {
    // Close connections
    if (prodClient) await prodClient.close();
    if (testClient) await testClient.close();
    logger.info('Disconnected from MongoDB instances');
    
    // Save operation log
    await saveLog();
  }
}

async function saveLog() {
  try {
    fs.writeFileSync(logFile, JSON.stringify(operationLog, null, 2));
    logger.info(`Operation log saved to: ${logFile}`);
  } catch (error) {
    logger.error('Failed to save operation log:', error);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  logger.info('Process interrupted, saving log...');
  operationLog.errors.push('Process interrupted by user');
  await saveLog();
  process.exit(1);
});

// Execute sync
syncProdToTest()
  .then(() => {
    logger.info('Sync process completed successfully');
    process.exit(0);
  })
  .catch(error => {
    logger.error('Sync process failed:', error);
    process.exit(1);
  });