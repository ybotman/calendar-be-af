// src/utils/backupUtils.js
// Shared utilities for MongoDB and Firebase backup functions (CALBEAF-75, CALBEAF-77)

const { BlobServiceClient } = require('@azure/storage-blob');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);

/**
 * Retention policy constants
 * - 7 daily: keep most recent 7 backups
 * - 4 weekly: keep 1 per week for 4 weeks (beyond dailies)
 * - 12 monthly: keep 1 per month for 12 months
 * - 3 yearly: keep 1 per year for 3 years
 */
const RETENTION = {
    DAILY_COUNT: 7,
    WEEKLY_COUNT: 4,
    MONTHLY_COUNT: 12,
    YEARLY_COUNT: 3
};

/**
 * Get Azure Blob container client
 * @param {string} containerName - Container name
 * @returns {ContainerClient}
 */
function getContainerClient(containerName) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) {
        throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
    }
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    return blobServiceClient.getContainerClient(containerName);
}

/**
 * Upload compressed JSON data to Azure Blob Storage
 * @param {string} containerName - Blob container name
 * @param {string} blobName - Blob name (e.g., "2026-02-09T03-00-00_TangoTiempo.json.gz")
 * @param {object|Array} data - Data to serialize and upload
 * @param {object} context - Azure Functions context for logging
 * @returns {Promise<{url: string, size: number}>}
 */
async function uploadBackup(containerName, blobName, data, context) {
    const containerClient = getContainerClient(containerName);

    // Ensure container exists
    await containerClient.createIfNotExists();

    // Serialize and compress
    const jsonString = JSON.stringify(data, null, 2);
    const compressed = await gzip(Buffer.from(jsonString, 'utf-8'));

    // Upload
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.upload(compressed, compressed.length, {
        blobHTTPHeaders: {
            blobContentType: 'application/gzip',
            blobContentEncoding: 'gzip'
        },
        metadata: {
            originalSize: String(jsonString.length),
            compressedSize: String(compressed.length),
            backupTimestamp: new Date().toISOString()
        }
    });

    context.log(`Uploaded ${blobName}: ${compressed.length} bytes (${jsonString.length} uncompressed)`);

    return {
        url: blockBlobClient.url,
        size: compressed.length,
        originalSize: jsonString.length
    };
}

/**
 * List all backups in a container with parsed timestamps
 * @param {string} containerName - Blob container name
 * @param {string} prefix - Optional prefix filter (e.g., "TangoTiempo")
 * @returns {Promise<Array<{name: string, timestamp: Date, properties: object}>>}
 */
async function listBackups(containerName, prefix = '') {
    const containerClient = getContainerClient(containerName);
    const backups = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        // Parse timestamp from blob name: YYYY-MM-DDTHH-MM-SS_DatabaseName.json.gz
        const match = blob.name.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})_/);
        let timestamp = null;
        if (match) {
            // Convert YYYY-MM-DDTHH-MM-SS to Date
            const isoString = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
            timestamp = new Date(isoString);
        }

        backups.push({
            name: blob.name,
            timestamp,
            properties: blob.properties
        });
    }

    // Sort by timestamp descending (newest first)
    backups.sort((a, b) => {
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return b.timestamp - a.timestamp;
    });

    return backups;
}

/**
 * Apply tiered retention policy to backups
 * Returns list of blobs to delete
 *
 * @param {Array} backups - Sorted list of backups (newest first)
 * @param {object} context - Azure Functions context for logging
 * @returns {Array<string>} - Blob names to delete
 */
function applyRetentionPolicy(backups, context) {
    const keep = new Set();
    const now = new Date();

    // Group backups by database (extract from filename)
    const byDatabase = {};
    for (const backup of backups) {
        const match = backup.name.match(/_([^.]+)\.json\.gz$/);
        const dbName = match ? match[1] : 'unknown';
        if (!byDatabase[dbName]) {
            byDatabase[dbName] = [];
        }
        byDatabase[dbName].push(backup);
    }

    // Apply retention per database
    for (const [dbName, dbBackups] of Object.entries(byDatabase)) {
        context.log(`Retention check for ${dbName}: ${dbBackups.length} backups`);

        // Tier 1: Keep 7 most recent
        for (let i = 0; i < Math.min(RETENTION.DAILY_COUNT, dbBackups.length); i++) {
            keep.add(dbBackups[i].name);
        }

        // Tier 2: Keep 1 per week for 4 weeks (beyond dailies)
        const weeklyKept = {};
        for (const backup of dbBackups.slice(RETENTION.DAILY_COUNT)) {
            if (!backup.timestamp) continue;
            const weekKey = getWeekKey(backup.timestamp);
            const weeksAgo = getWeeksAgo(backup.timestamp, now);

            if (weeksAgo <= RETENTION.WEEKLY_COUNT && !weeklyKept[weekKey]) {
                weeklyKept[weekKey] = backup.name;
                keep.add(backup.name);
            }
        }

        // Tier 3: Keep 1 per month for 12 months
        const monthlyKept = {};
        for (const backup of dbBackups) {
            if (!backup.timestamp) continue;
            const monthKey = getMonthKey(backup.timestamp);
            const monthsAgo = getMonthsAgo(backup.timestamp, now);

            if (monthsAgo <= RETENTION.MONTHLY_COUNT && !monthlyKept[monthKey]) {
                monthlyKept[monthKey] = backup.name;
                keep.add(backup.name);
            }
        }

        // Tier 4: Keep 1 per year for 3 years
        const yearlyKept = {};
        for (const backup of dbBackups) {
            if (!backup.timestamp) continue;
            const yearKey = backup.timestamp.getFullYear();
            const yearsAgo = getYearsAgo(backup.timestamp, now);

            if (yearsAgo <= RETENTION.YEARLY_COUNT && !yearlyKept[yearKey]) {
                yearlyKept[yearKey] = backup.name;
                keep.add(backup.name);
            }
        }
    }

    // Return blobs to delete (not in keep set)
    const toDelete = backups
        .filter(b => !keep.has(b.name))
        .map(b => b.name);

    context.log(`Retention: keeping ${keep.size}, deleting ${toDelete.length}`);

    return toDelete;
}

/**
 * Delete blobs from container
 * @param {string} containerName - Blob container name
 * @param {Array<string>} blobNames - Blob names to delete
 * @param {object} context - Azure Functions context for logging
 */
async function deleteBlobs(containerName, blobNames, context) {
    const containerClient = getContainerClient(containerName);

    for (const blobName of blobNames) {
        try {
            await containerClient.deleteBlob(blobName);
            context.log(`Deleted: ${blobName}`);
        } catch (error) {
            context.warn(`Failed to delete ${blobName}: ${error.message}`);
        }
    }
}

// Helper functions for date calculations
function getWeekKey(date) {
    const year = date.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const weekNum = Math.ceil((((date - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
    return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

function getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getWeeksAgo(date, now) {
    return Math.floor((now - date) / (7 * 24 * 60 * 60 * 1000));
}

function getMonthsAgo(date, now) {
    return (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
}

function getYearsAgo(date, now) {
    return now.getFullYear() - date.getFullYear();
}

/**
 * Generate backup filename with timestamp
 * @param {string} databaseName - Database or source name
 * @returns {string} - Filename like "2026-02-09T03-00-00_TangoTiempo.json.gz"
 */
function generateBackupFilename(databaseName) {
    const now = new Date();
    const timestamp = now.toISOString()
        .replace(/:/g, '-')
        .replace(/\.\d{3}Z$/, '');
    return `${timestamp}_${databaseName}.json.gz`;
}

module.exports = {
    RETENTION,
    getContainerClient,
    uploadBackup,
    listBackups,
    applyRetentionPolicy,
    deleteBlobs,
    generateBackupFilename
};
