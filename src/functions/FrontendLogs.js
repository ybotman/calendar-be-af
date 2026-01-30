const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * Frontend Logging Endpoints
 *
 * @description Tracks frontend UI events (modal opens/closes, save requests, views)
 * directly to MongoDB. This is a correct reimplementation that writes to the
 * frontendlogs collection instead of relying on the broken logFrontendEvent
 * from calendar-be.
 *
 * Collection: frontendlogs
 *
 * Endpoint 1: POST /api/frontend-logs        - Log a single event
 * Endpoint 2: POST /api/frontend-logs/batch   - Log multiple events at once
 */

// Valid action types for frontend log events
const VALID_ACTIONS = ['OPEN_MODAL', 'CLOSE_MODAL', 'SAVE_REQUEST', 'VIEW'];

// Valid resource types for frontend log events
const VALID_RESOURCES = ['event', 'venue', 'organizer', 'userLogin', 'frontend'];

// Maximum number of events allowed in a single batch request
const MAX_BATCH_SIZE = 100;

/**
 * Extract client IP address from request headers
 * Checks CloudFlare, X-Forwarded-For, and X-Real-IP headers
 */
function getClientIp(request) {
    const rawIp = request.headers.get('CF-Connecting-IP')
              || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
              || request.headers.get('X-Real-IP')
              || 'unknown';
    return rawIp;
}

/**
 * POST /api/frontend-logs
 *
 * Log a single frontend event.
 *
 * @route POST /api/frontend-logs
 * @auth None (anonymous)
 *
 * @param {Object} body
 * @param {string} body.action - Required. One of: OPEN_MODAL, CLOSE_MODAL, SAVE_REQUEST, VIEW
 * @param {string} body.resource - Required. One of: event, venue, organizer, userLogin, frontend
 * @param {string} [body.resourceId] - Optional. The ID of the resource
 * @param {string} [body.appId="1"] - Optional. Application ID (default "1")
 * @param {Object} [body.details] - Optional. Additional details
 *
 * @returns {{ message: string, timestamp: string }}
 *
 * @example
 * POST /api/frontend-logs
 * Body: { "action": "OPEN_MODAL", "resource": "event", "resourceId": "507f1f77...", "details": {} }
 *
 * Response:
 * { "message": "Event logged successfully", "timestamp": "2026-01-29T..." }
 */
async function frontendLogsCreateHandler(request, context) {
    context.log('FrontendLogs_Create: POST request received');

    let mongoClient;

    try {
        // Parse request body
        const body = await request.json();

        // Validate required fields
        const { action, resource, resourceId, appId, details } = body;

        if (!action || !VALID_ACTIONS.includes(action)) {
            return {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: `Invalid or missing action. Must be one of: ${VALID_ACTIONS.join(', ')}`,
                    timestamp: new Date().toISOString()
                })
            };
        }

        if (!resource || !VALID_RESOURCES.includes(resource)) {
            return {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: `Invalid or missing resource. Must be one of: ${VALID_RESOURCES.join(', ')}`,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Extract metadata from request
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        const ip = getClientIp(request);
        const now = new Date();

        // Build the log document
        const logDocument = {
            action,
            resource,
            resourceId: resourceId || null,
            appId: appId || '1',
            details: details || null,
            userAgent,
            ip,
            timestamp: now,
            createdAt: now
        };

        // Connect to MongoDB and insert
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('frontendlogs');

        await collection.insertOne(logDocument);
        context.log(`FrontendLogs_Create: Logged ${action} on ${resource}`);

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({
                message: 'Event logged successfully',
                timestamp: now.toISOString()
            })
        };

    } catch (error) {
        // Let errorHandler middleware handle the error
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

/**
 * POST /api/frontend-logs/batch
 *
 * Log multiple frontend events in a single request.
 *
 * @route POST /api/frontend-logs/batch
 * @auth None (anonymous)
 *
 * @param {Object} body
 * @param {Array} body.events - Required. Array of event objects (max 100)
 * @param {string} body.events[].action - Required. One of: OPEN_MODAL, CLOSE_MODAL, SAVE_REQUEST, VIEW
 * @param {string} body.events[].resource - Required. One of: event, venue, organizer, userLogin, frontend
 * @param {string} [body.events[].resourceId] - Optional. The ID of the resource
 * @param {Object} [body.events[].details] - Optional. Additional details
 * @param {string} [body.appId="1"] - Optional. Application ID applied to all events
 *
 * @returns {{ message: string, count: number, timestamp: string }}
 *
 * @example
 * POST /api/frontend-logs/batch
 * Body: {
 *   "events": [
 *     { "action": "OPEN_MODAL", "resource": "event", "resourceId": "507f1f77..." },
 *     { "action": "CLOSE_MODAL", "resource": "event" }
 *   ],
 *   "appId": "1"
 * }
 *
 * Response:
 * { "message": "2 events logged successfully", "count": 2, "timestamp": "2026-01-29T..." }
 */
async function frontendLogsBatchHandler(request, context) {
    context.log('FrontendLogs_Batch: POST request received');

    let mongoClient;

    try {
        // Parse request body
        const body = await request.json();

        const { events, appId } = body;

        // Validate events array
        if (!events || !Array.isArray(events) || events.length === 0) {
            return {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'events array is required and must not be empty',
                    timestamp: new Date().toISOString()
                })
            };
        }

        if (events.length > MAX_BATCH_SIZE) {
            return {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} events`,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Validate each event has action and resource
        for (let i = 0; i < events.length; i++) {
            const evt = events[i];

            if (!evt.action || !VALID_ACTIONS.includes(evt.action)) {
                return {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: JSON.stringify({
                        error: `Invalid or missing action at index ${i}. Must be one of: ${VALID_ACTIONS.join(', ')}`,
                        timestamp: new Date().toISOString()
                    })
                };
            }

            if (!evt.resource || !VALID_RESOURCES.includes(evt.resource)) {
                return {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: JSON.stringify({
                        error: `Invalid or missing resource at index ${i}. Must be one of: ${VALID_RESOURCES.join(', ')}`,
                        timestamp: new Date().toISOString()
                    })
                };
            }
        }

        // Extract metadata from request
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        const ip = getClientIp(request);
        const now = new Date();
        const resolvedAppId = appId || '1';

        // Build documents for batch insert
        const documents = events.map((evt) => ({
            action: evt.action,
            resource: evt.resource,
            resourceId: evt.resourceId || null,
            appId: resolvedAppId,
            details: evt.details || null,
            userAgent,
            ip,
            timestamp: now,
            createdAt: now
        }));

        // Connect to MongoDB and insert batch
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('frontendlogs');

        await collection.insertMany(documents);
        context.log(`FrontendLogs_Batch: Logged ${documents.length} events`);

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({
                message: `${documents.length} events logged successfully`,
                count: documents.length,
                timestamp: now.toISOString()
            })
        };

    } catch (error) {
        // Let errorHandler middleware handle the error
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

// Register single event logging function
app.http('FrontendLogs_Create', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'frontend-logs',
    handler: standardMiddleware(frontendLogsCreateHandler)
});

// Register batch event logging function
app.http('FrontendLogs_Batch', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'frontend-logs/batch',
    handler: standardMiddleware(frontendLogsBatchHandler)
});
