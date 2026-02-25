/**
 * EventActivityLog Utility
 *
 * Provides audit trail logging for all event CRUD operations.
 * Captures who did what, when, and what changed.
 *
 * Collection: EventActivityLog
 */

const COLLECTION_NAME = 'EventActivityLog';

/**
 * Log an event activity (CREATE, UPDATE, DELETE)
 *
 * @param {Db} db - MongoDB database instance
 * @param {Object} params - Activity parameters
 * @param {ObjectId} params.eventId - The event affected
 * @param {string} params.action - "CREATE", "UPDATE", or "DELETE"
 * @param {string} params.appId - Application ID
 * @param {string} params.firebaseUserId - Firebase UID of the actor
 * @param {ObjectId} [params.userLoginId] - Reference to userlogins collection
 * @param {string} [params.userEmail] - User's email for easy reading
 * @param {string} params.roleName - Role name (e.g., "RegionalAdmin", "Chapter Admin")
 * @param {ObjectId} [params.roleId] - Reference to roles collection
 * @param {string} params.endpoint - API endpoint used
 * @param {string} [params.ipAddress] - Client IP address
 * @param {Object} [params.createdEvent] - For CREATE: full event document
 * @param {Object} [params.changes] - For UPDATE: { before: {}, after: {} }
 * @param {Object} [params.deletedEvent] - For DELETE: full event document
 * @param {Object} [params.context] - Azure Functions context for logging
 * @returns {Promise<ObjectId>} - The inserted log entry ID
 */
async function logEventActivity(db, params) {
    const {
        eventId,
        action,
        appId,
        firebaseUserId,
        userLoginId = null,
        userEmail = null,
        roleName,
        roleId = null,
        endpoint,
        ipAddress = null,
        createdEvent = null,
        changes = null,
        deletedEvent = null,
        context = null
    } = params;

    // Validate required fields
    if (!eventId || !action || !appId || !firebaseUserId || !roleName || !endpoint) {
        const error = 'Missing required fields for activity log';
        if (context) context.log.error(error, { eventId, action, appId, firebaseUserId, roleName, endpoint });
        throw new Error(error);
    }

    // Validate action
    const validActions = ['CREATE', 'UPDATE', 'DELETE'];
    if (!validActions.includes(action)) {
        throw new Error(`Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`);
    }

    const logEntry = {
        eventId,
        action,
        appId,
        firebaseUserId,
        userLoginId,
        userEmail,
        roleName,
        roleId,
        endpoint,
        ipAddress,
        timestamp: new Date()
    };

    // Add full event for CREATE (preserve what was created)
    if (action === 'CREATE' && createdEvent) {
        logEntry.createdEvent = createdEvent;
    }

    // Add changes for UPDATE
    if (action === 'UPDATE' && changes) {
        logEntry.changes = changes;
    }

    // Add full event for DELETE (preserve what was deleted)
    if (action === 'DELETE' && deletedEvent) {
        logEntry.deletedEvent = deletedEvent;
    }

    try {
        const result = await db.collection(COLLECTION_NAME).insertOne(logEntry);

        if (context) {
            context.log(`EventActivityLog: ${action} on event ${eventId} by ${firebaseUserId} (${roleName})`);
        }

        return result.insertedId;
    } catch (error) {
        if (context) {
            context.log.error('Failed to write EventActivityLog', { error: error.message, logEntry });
        }
        // Don't throw - logging failure shouldn't break the main operation
        console.error('EventActivityLog write failed:', error.message);
        return null;
    }
}

/**
 * Get the changes between two objects (for UPDATE logging)
 * Only includes fields that actually changed
 *
 * @param {Object} before - Original document
 * @param {Object} after - Updated document
 * @param {string[]} [ignoreFields] - Fields to ignore (e.g., updatedAt)
 * @returns {Object} - { before: {changedFields}, after: {changedFields} }
 */
function getChanges(before, after, ignoreFields = ['updatedAt', 'lastModifiedByRA', '_id']) {
    const changedBefore = {};
    const changedAfter = {};

    // Get all keys from both objects
    const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

    for (const key of allKeys) {
        if (ignoreFields.includes(key)) continue;

        const beforeVal = before?.[key];
        const afterVal = after?.[key];

        // Compare as JSON strings to handle nested objects
        const beforeStr = JSON.stringify(beforeVal);
        const afterStr = JSON.stringify(afterVal);

        if (beforeStr !== afterStr) {
            if (beforeVal !== undefined) changedBefore[key] = beforeVal;
            if (afterVal !== undefined) changedAfter[key] = afterVal;
        }
    }

    return {
        before: changedBefore,
        after: changedAfter
    };
}

/**
 * Extract IP address from request
 *
 * @param {Request} request - Azure Functions request
 * @returns {string|null} - IP address or null
 */
function getIpAddress(request) {
    // Azure Functions / proxied requests
    const forwarded = request.headers?.get?.('x-forwarded-for')
        || request.headers?.['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }

    // Direct connection
    return request.headers?.get?.('x-client-ip')
        || request.headers?.['x-client-ip']
        || null;
}

/**
 * Look up user email from userlogins collection
 * Use when Firebase token doesn't include email
 *
 * @param {Db} db - MongoDB database instance
 * @param {string} firebaseUserId - Firebase UID
 * @param {string} appId - Application ID (default '1')
 * @returns {Promise<string|null>} - User email or null
 */
async function getUserEmailForLog(db, firebaseUserId, appId = '1') {
    try {
        const userRecord = await db.collection('userlogins').findOne(
            { firebaseUserId, appId },
            { projection: { email: 1 } }
        );
        return userRecord?.email || null;
    } catch (error) {
        console.error('getUserEmailForLog failed:', error.message);
        return null;
    }
}

module.exports = {
    logEventActivity,
    getChanges,
    getIpAddress,
    getUserEmailForLog,
    COLLECTION_NAME
};
