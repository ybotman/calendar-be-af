// src/functions/Backup_Firebase.js
// Domain: Backup - Daily Firebase Auth backup to Azure Blob Storage (CALBEAF-77)

const { app } = require('@azure/functions');
const admin = require('firebase-admin');
const {
    uploadBackup,
    listBackups,
    applyRetentionPolicy,
    deleteBlobs,
    generateBackupFilename
} = require('../utils/backupUtils');

const CONTAINER_NAME = process.env.FIREBASE_BACKUP_CONTAINER_NAME || 'firebase-backups';

// Initialize Firebase Admin if not already initialized
function getFirebaseAdmin() {
    if (admin.apps.length === 0) {
        // Initialize from environment variable or default credentials
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(serviceAccount))
            });
        } else {
            // Fall back to application default credentials
            admin.initializeApp({
                credential: admin.credential.applicationDefault()
            });
        }
    }
    return admin;
}

/**
 * Export all Firebase Auth users
 * @param {object} context - Azure Functions context
 * @returns {Promise<object>} - Users export object
 */
async function exportFirebaseUsers(context) {
    const firebaseAdmin = getFirebaseAdmin();
    const auth = firebaseAdmin.auth();

    context.log('Backup_Firebase: Exporting users...');

    const users = [];
    let nextPageToken;
    let pageCount = 0;

    // Iterate through all users (1000 at a time)
    do {
        const listUsersResult = await auth.listUsers(1000, nextPageToken);

        for (const userRecord of listUsersResult.users) {
            // Export relevant user data (excluding sensitive hash info)
            users.push({
                uid: userRecord.uid,
                email: userRecord.email,
                emailVerified: userRecord.emailVerified,
                displayName: userRecord.displayName,
                photoURL: userRecord.photoURL,
                phoneNumber: userRecord.phoneNumber,
                disabled: userRecord.disabled,
                metadata: {
                    creationTime: userRecord.metadata.creationTime,
                    lastSignInTime: userRecord.metadata.lastSignInTime,
                    lastRefreshTime: userRecord.metadata.lastRefreshTime
                },
                customClaims: userRecord.customClaims || {},
                providerData: userRecord.providerData.map(provider => ({
                    providerId: provider.providerId,
                    uid: provider.uid,
                    displayName: provider.displayName,
                    email: provider.email,
                    photoURL: provider.photoURL
                })),
                tenantId: userRecord.tenantId
            });
        }

        nextPageToken = listUsersResult.pageToken;
        pageCount++;
        context.log(`  Page ${pageCount}: ${listUsersResult.users.length} users`);

    } while (nextPageToken);

    const exportData = {
        _metadata: {
            exportedAt: new Date().toISOString(),
            source: 'Firebase Auth',
            version: '1.0',
            totalUsers: users.length,
            exportedFields: [
                'uid', 'email', 'emailVerified', 'displayName', 'photoURL',
                'phoneNumber', 'disabled', 'metadata', 'customClaims', 'providerData'
            ],
            note: 'Password hashes are NOT included for security. Use Firebase Auth import/export CLI for full migration.'
        },
        users
    };

    context.log(`Backup_Firebase: Exported ${users.length} users total`);

    return exportData;
}

/**
 * Backup_Firebase - Daily timer that backs up Firebase Auth users
 *
 * Exports all Firebase Auth users to Azure Blob Storage with tiered retention.
 *
 * Schedule: Daily at 3:15 AM EST (8:15 AM UTC, 15 min after MongoDB backup)
 *
 * Environment variables:
 * - FIREBASE_SERVICE_ACCOUNT_JSON: Firebase service account JSON (stringified)
 * - AZURE_STORAGE_CONNECTION_STRING: Blob storage connection
 * - FIREBASE_BACKUP_CONTAINER_NAME: Container name (default: firebase-backups)
 */
async function firebaseBackupHandler(myTimer, context) {
    const startTime = Date.now();
    context.log('Backup_Firebase: Starting daily backup...');

    const results = {
        timestamp: new Date().toISOString(),
        backup: null,
        retention: { kept: 0, deleted: 0 },
        errors: []
    };

    try {
        if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
            throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
        }

        // Export Firebase users
        try {
            const usersExport = await exportFirebaseUsers(context);
            const filename = generateBackupFilename('FirebaseAuth');
            const uploadResult = await uploadBackup(CONTAINER_NAME, filename, usersExport, context);

            results.backup = {
                filename,
                size: uploadResult.size,
                originalSize: uploadResult.originalSize,
                userCount: usersExport.users.length
            };
        } catch (error) {
            context.error(`Backup_Firebase: Export failed: ${error.message}`);
            results.errors.push(`Export: ${error.message}`);
        }

        // Apply retention policy
        try {
            context.log('Backup_Firebase: Applying retention policy...');
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
            context.warn(`Backup_Firebase: Retention cleanup failed: ${error.message}`);
            results.errors.push(`Retention: ${error.message}`);
        }

    } catch (error) {
        context.error(`Backup_Firebase: Fatal error: ${error.message}`);
        results.errors.push(`Fatal: ${error.message}`);
    }

    const duration = Date.now() - startTime;
    results.durationMs = duration;

    context.log(`Backup_Firebase: Completed in ${duration}ms`, results);

    return results;
}

// Timer trigger: runs daily at 3:15 AM EST (8:15 AM UTC)
// CRON format: second minute hour day month weekday
app.timer('Backup_Firebase', {
    schedule: '0 15 8 * * *',
    handler: firebaseBackupHandler
});

// HTTP trigger for manual backup (admin use)
app.http('Backup_Firebase_Manual', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'admin/backup/firebase',
    handler: async (request, context) => {
        context.log('Backup_Firebase_Manual: Manual backup triggered');

        const results = await firebaseBackupHandler({}, context);

        return {
            status: results.errors.length > 0 ? 207 : 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(results, null, 2)
        };
    }
});

// HTTP trigger to list backups (admin use)
app.http('Backup_Firebase_List', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'admin/backup/firebase/list',
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
