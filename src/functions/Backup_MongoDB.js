// src/functions/Backup_MongoDB.js
// Domain: Backup - Daily MongoDB backup to Azure Blob Storage (CALBEAF-75)

const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const {
    uploadBackup,
    listBackups,
    applyRetentionPolicy,
    deleteBlobs,
    generateBackupFilename
} = require('../utils/backupUtils');

const CONTAINER_NAME = process.env.BACKUP_CONTAINER_NAME || 'mongodb-backups';

// Collections to backup (core data collections)
const COLLECTIONS_TO_BACKUP = [
    'events',
    'organizers',
    'Venues',
    'users',
    'categories',
    'masteredlocations',
    'roles'
];

/**
 * Export a MongoDB database to JSON format
 * @param {string} uri - MongoDB connection string
 * @param {string} dbName - Database name for labeling
 * @param {object} context - Azure Functions context
 * @returns {Promise<object>} - Database export object
 */
async function exportDatabase(uri, dbName, context) {
    let mongoClient;

    try {
        context.log(`Backup_MongoDB: Connecting to ${dbName}...`);

        mongoClient = new MongoClient(uri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const actualDbName = db.databaseName;
        context.log(`Backup_MongoDB: Connected to ${actualDbName}`);

        const exportData = {
            _metadata: {
                exportedAt: new Date().toISOString(),
                databaseName: actualDbName,
                labelName: dbName,
                version: '1.0',
                collections: []
            },
            collections: {}
        };

        // Export each collection
        for (const collectionName of COLLECTIONS_TO_BACKUP) {
            try {
                const collection = db.collection(collectionName);
                const documents = await collection.find({}).toArray();

                exportData.collections[collectionName] = documents;
                exportData._metadata.collections.push({
                    name: collectionName,
                    count: documents.length
                });

                context.log(`  ${collectionName}: ${documents.length} documents`);
            } catch (error) {
                context.warn(`  ${collectionName}: Error - ${error.message}`);
                exportData.collections[collectionName] = [];
                exportData._metadata.collections.push({
                    name: collectionName,
                    count: 0,
                    error: error.message
                });
            }
        }

        return exportData;

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

/**
 * Backup_MongoDB - Daily timer that backs up MongoDB databases
 *
 * Backs up both TangoTiempo (dev/test) and TangoTiempoProd databases
 * to Azure Blob Storage with tiered retention.
 *
 * Schedule: Daily at 3:00 AM UTC
 *
 * Environment variables:
 * - MONGODB_URI: Dev/test database connection string
 * - MONGODB_URI_PROD: Production database connection string
 * - AZURE_STORAGE_CONNECTION_STRING: Blob storage connection
 * - BACKUP_CONTAINER_NAME: Container name (default: mongodb-backups)
 */
async function mongoBackupHandler(myTimer, context) {
    const startTime = Date.now();
    context.log('Backup_MongoDB: Starting daily backup...');

    const results = {
        timestamp: new Date().toISOString(),
        databases: [],
        retention: { kept: 0, deleted: 0 },
        errors: []
    };

    try {
        // Get connection strings
        const devUri = process.env.MONGODB_URI;
        const prodUri = process.env.MONGODB_URI_PROD;

        if (!devUri) {
            results.errors.push('MONGODB_URI not configured');
        }
        if (!prodUri) {
            results.errors.push('MONGODB_URI_PROD not configured');
        }

        if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
            throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
        }

        // Backup dev/test database
        if (devUri) {
            try {
                const devExport = await exportDatabase(devUri, 'TangoTiempo', context);
                const devFilename = generateBackupFilename('TangoTiempo');
                const devResult = await uploadBackup(CONTAINER_NAME, devFilename, devExport, context);

                results.databases.push({
                    name: 'TangoTiempo',
                    filename: devFilename,
                    size: devResult.size,
                    originalSize: devResult.originalSize,
                    collections: devExport._metadata.collections.length,
                    totalDocuments: devExport._metadata.collections.reduce((sum, c) => sum + c.count, 0)
                });
            } catch (error) {
                context.error(`Backup_MongoDB: TangoTiempo backup failed: ${error.message}`);
                results.errors.push(`TangoTiempo: ${error.message}`);
            }
        }

        // Backup production database
        if (prodUri) {
            try {
                const prodExport = await exportDatabase(prodUri, 'TangoTiempoProd', context);
                const prodFilename = generateBackupFilename('TangoTiempoProd');
                const prodResult = await uploadBackup(CONTAINER_NAME, prodFilename, prodExport, context);

                results.databases.push({
                    name: 'TangoTiempoProd',
                    filename: prodFilename,
                    size: prodResult.size,
                    originalSize: prodResult.originalSize,
                    collections: prodExport._metadata.collections.length,
                    totalDocuments: prodExport._metadata.collections.reduce((sum, c) => sum + c.count, 0)
                });
            } catch (error) {
                context.error(`Backup_MongoDB: TangoTiempoProd backup failed: ${error.message}`);
                results.errors.push(`TangoTiempoProd: ${error.message}`);
            }
        }

        // Apply retention policy
        try {
            context.log('Backup_MongoDB: Applying retention policy...');
            const allBackups = await listBackups(CONTAINER_NAME);
            const toDelete = applyRetentionPolicy(allBackups, context);

            if (toDelete.length > 0) {
                await deleteBlobs(CONTAINER_NAME, toDelete, context);
            }

            results.retention = {
                kept: allBackups.length - toDelete.length,
                deleted: toDelete.length
            };
        } catch (error) {
            context.warn(`Backup_MongoDB: Retention cleanup failed: ${error.message}`);
            results.errors.push(`Retention: ${error.message}`);
        }

    } catch (error) {
        context.error(`Backup_MongoDB: Fatal error: ${error.message}`);
        results.errors.push(`Fatal: ${error.message}`);
    }

    const duration = Date.now() - startTime;
    results.durationMs = duration;

    context.log(`Backup_MongoDB: Completed in ${duration}ms`, results);

    // Return summary (for testing/debugging)
    return results;
}

// Timer trigger: runs daily at 3:00 AM UTC
// CRON format: second minute hour day month weekday
app.timer('Backup_MongoDB', {
    schedule: '0 0 3 * * *',
    handler: mongoBackupHandler
});

// HTTP trigger for manual backup (admin use)
app.http('Backup_MongoDB_Manual', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'admin/backup/mongodb',
    handler: async (request, context) => {
        context.log('Backup_MongoDB_Manual: Manual backup triggered');

        const results = await mongoBackupHandler({}, context);

        return {
            status: results.errors.length > 0 ? 207 : 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(results, null, 2)
        };
    }
});

// HTTP trigger to list backups (admin use)
app.http('Backup_MongoDB_List', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'admin/backup/mongodb/list',
    handler: async (request, context) => {
        try {
            const backups = await listBackups(CONTAINER_NAME);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    container: CONTAINER_NAME,
                    count: backups.length,
                    backups: backups.map(b => ({
                        name: b.name,
                        timestamp: b.timestamp?.toISOString(),
                        size: b.properties?.contentLength
                    }))
                }, null, 2)
            };
        } catch (error) {
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: error.message })
            };
        }
    }
});
