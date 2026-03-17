// src/functions/Events_InstanceOverrides.js
// Domain: Events - Instance-level overrides for recurring events (TIEMPO-362)
// Allows modifying/canceling individual occurrences without affecting the series

const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');

// ============================================
// HELPER: Convert string IDs to ObjectId in patch
// ============================================
function convertPatchIdFields(patch) {
    if (!patch) return patch;

    const idFields = ['djId', 'venueID'];

    for (const field of idFields) {
        if (patch[field] && typeof patch[field] === 'string') {
            try {
                patch[field] = new ObjectId(patch[field]);
            } catch {
                // Invalid ObjectId string - leave as-is
            }
        }
    }

    return patch;
}

// ============================================
// FUNCTION 1: POST /api/events/:eventId/override
// Create or update an instance override
// ============================================
async function createOverrideHandler(request, context) {
    const eventId = request.params.eventId;
    context.log(`Events_InstanceOverride_Create: Request for event ${eventId}`);

    // Firebase auth required for mutations
    const user = await firebaseAuth(request, context);
    if (!user) {
        return unauthorizedResponse();
    }
    context.log(`Events_InstanceOverride_Create: Authenticated user ${user.uid}`);

    let mongoClient;

    try {
        const requestBody = await request.json();
        const { instanceKey, overrideType, patch } = requestBody;

        // Validate required fields
        if (!instanceKey) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'instanceKey is required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        if (!overrideType || !['modify', 'cancel', 'restore'].includes(overrideType)) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'overrideType must be "modify", "cancel", or "restore"',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // For "modify" type, patch is required
        if (overrideType === 'modify' && (!patch || Object.keys(patch).length === 0)) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'patch is required for "modify" overrideType',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // Fetch the event
        const event = await collection.findOne({ _id: new ObjectId(eventId) });

        if (!event) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Event not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Verify event is recurring
        if (!event.recurrenceRule) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Cannot add override to non-recurring event',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Parse instanceKey as Date for storage
        const instanceKeyDate = new Date(instanceKey);
        if (isNaN(instanceKeyDate.getTime())) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid instanceKey date format',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Build the override object
        const overrideObj = {
            instanceKey: instanceKeyDate,
            overrideType,
            patch: overrideType === 'modify' ? convertPatchIdFields(patch) : {},
            modifiedBy: new ObjectId(user.uid.length === 24 ? user.uid : '000000000000000000000000'),
            modifiedAt: new Date()
        };

        // Note: Firebase UID is not an ObjectId, store as string instead
        overrideObj.modifiedByFirebaseUid = user.uid;
        delete overrideObj.modifiedBy;

        // Check if override for this instanceKey already exists
        const existingOverrideIndex = (event.instanceOverrides || []).findIndex(
            o => new Date(o.instanceKey).getTime() === instanceKeyDate.getTime()
        );

        let updateResult;

        if (existingOverrideIndex >= 0) {
            // Update existing override
            updateResult = await collection.updateOne(
                { _id: new ObjectId(eventId) },
                {
                    $set: {
                        [`instanceOverrides.${existingOverrideIndex}`]: overrideObj,
                        updatedAt: new Date()
                    }
                }
            );
        } else {
            // Add new override
            updateResult = await collection.updateOne(
                { _id: new ObjectId(eventId) },
                {
                    $push: { instanceOverrides: overrideObj },
                    $set: { updatedAt: new Date() }
                }
            );
        }

        if (updateResult.modifiedCount === 0) {
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Failed to update event',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Fetch updated event
        const updatedEvent = await collection.findOne({ _id: new ObjectId(eventId) });

        context.log(`Events_InstanceOverride_Create: Override ${existingOverrideIndex >= 0 ? 'updated' : 'created'} for ${instanceKey}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                event: updatedEvent,
                timestamp: new Date().toISOString()
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Events_InstanceOverride_Create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'events/{eventId}/override',
    handler: standardMiddleware(createOverrideHandler)
});

// ============================================
// FUNCTION 2: DELETE /api/events/:eventId/override/:instanceKey
// Remove an override (restore to regular schedule)
// ============================================
async function deleteOverrideHandler(request, context) {
    const eventId = request.params.eventId;
    const instanceKey = request.params.instanceKey;
    context.log(`Events_InstanceOverride_Delete: Request for event ${eventId}, instance ${instanceKey}`);

    // Firebase auth required for mutations
    const user = await firebaseAuth(request, context);
    if (!user) {
        return unauthorizedResponse();
    }
    context.log(`Events_InstanceOverride_Delete: Authenticated user ${user.uid}`);

    let mongoClient;

    try {
        // Parse instanceKey
        const instanceKeyDate = new Date(decodeURIComponent(instanceKey));
        if (isNaN(instanceKeyDate.getTime())) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid instanceKey date format',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // Remove the override using $pull
        const updateResult = await collection.updateOne(
            { _id: new ObjectId(eventId) },
            {
                $pull: {
                    instanceOverrides: {
                        instanceKey: instanceKeyDate
                    }
                },
                $set: { updatedAt: new Date() }
            }
        );

        if (updateResult.matchedCount === 0) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Event not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        context.log(`Events_InstanceOverride_Delete: Override removed for ${instanceKey}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'Occurrence restored to regular schedule',
                timestamp: new Date().toISOString()
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Events_InstanceOverride_Delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'events/{eventId}/override/{instanceKey}',
    handler: standardMiddleware(deleteOverrideHandler)
});

// ============================================
// FUNCTION 3: GET /api/events/:eventId/overrides
// List all overrides for a series
// ============================================
async function listOverridesHandler(request, context) {
    const eventId = request.params.eventId;
    context.log(`Events_InstanceOverride_List: Request for event ${eventId}`);

    let mongoClient;

    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // Fetch the event
        const event = await collection.findOne(
            { _id: new ObjectId(eventId) },
            { projection: { instanceOverrides: 1, title: 1, recurrenceRule: 1 } }
        );

        if (!event) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Event not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        context.log(`Events_InstanceOverride_List: Found ${(event.instanceOverrides || []).length} overrides`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                overrides: event.instanceOverrides || [],
                eventId: event._id,
                eventTitle: event.title,
                isRecurring: !!event.recurrenceRule,
                timestamp: new Date().toISOString()
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Events_InstanceOverride_List', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'events/{eventId}/overrides',
    handler: standardMiddleware(listOverridesHandler)
});
