// src/functions/Events.js
// Domain: Events - All event CRUD operations with MongoDB integration
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

// ============================================
// FUNCTION 1: GET /api/events
// ============================================

/**
 * GET /api/events
 * List all events with optional filtering
 *
 * Query Parameters:
 * - appId: Application ID (1=TangoTiempo, 2=HarmonyJunction) (required)
 * - startDate: Filter events from date (ISO format)
 * - endDate: Filter events to date (ISO format)
 * - categoryId: Filter by category
 * - venueId: Filter by venue
 * - limit: Results per page (default: 100, max: 500)
 * - page: Page number (default: 1)
 *
 * Response: { events: [...], pagination: { total, page, limit, pages } }
 */
async function eventsGetHandler(request, context) {
    // Extract query parameters
    const appId = request.query.get('appId');
    const startDate = request.query.get('startDate');
    const endDate = request.query.get('endDate');
    const categoryId = request.query.get('categoryId');
    const venueId = request.query.get('venueId');
    const page = request.query.get('page') || '1';
    const limit = request.query.get('limit') || '100';

    // Log request details
    context.log('Events_Get: Request received', {
        appId,
        startDate,
        endDate,
        categoryId,
        venueId,
        page,
        limit
    });

    // Validate required parameters
    if (!appId) {
        context.log('Missing appId in events request');
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'appId is required' })
        };
    }

    let mongoClient;

    try {
        // Parse and validate pagination parameters
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
        const skip = (pageNum - 1) * limitNum;

        context.log(`Fetching events for appId: ${appId} with pagination: page ${pageNum}, limit ${limitNum}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // Build MongoDB query filter
        const filter = { appId };

        // Add date range filtering if provided
        if (startDate || endDate) {
            filter.startTime = {};
            if (startDate) {
                filter.startTime.$gte = new Date(startDate);
            }
            if (endDate) {
                filter.startTime.$lte = new Date(endDate);
            }
        }

        // Add category filter if provided
        if (categoryId) {
            filter.categoryId = categoryId;
        }

        // Add venue filter if provided
        if (venueId) {
            filter.venueId = venueId;
        }

        // Build MongoDB query
        const eventQuery = collection
            .find(filter)
            .sort({ startTime: 1 }) // Sort by start time ascending
            .skip(skip)
            .limit(limitNum);

        // Execute queries in parallel for better performance
        const [events, total] = await Promise.all([
            eventQuery.toArray(),
            collection.countDocuments(filter)
        ]);

        context.log(`Found ${events.length} events for appId: ${appId} (page ${pageNum}/${Math.ceil(total/limitNum)})`);

        // Return response with pagination info
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                events: events || [],
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    pages: Math.ceil(total / limitNum)
                }
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

// Register function with standard middleware
app.http('Events_Get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'events',
    handler: standardMiddleware(eventsGetHandler)
});

// ============================================
// FUNCTION 2: GET /api/events/{eventId}
// ============================================

/**
 * GET /api/events/{eventId}
 * Get single event by ID
 *
 * @param {string} eventId - Event ID (MongoDB ObjectId)
 */
async function eventsGetByIdHandler(request, context) {
    const eventId = request.params.eventId;
    context.log(`Events_GetById: Request for event ${eventId}`);

    let mongoClient;

    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // Find event by ID
        const event = await collection.findOne({ _id: new ObjectId(eventId) });

        if (!event) {
            context.log(`Event not found: ${eventId}`);
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

        context.log(`Event found: ${eventId}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: event,
                timestamp: new Date().toISOString()
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

app.http('Events_GetById', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'events/{eventId}',
    handler: standardMiddleware(eventsGetByIdHandler)
});

// ============================================
// FUNCTION 3: POST /api/events
// ============================================

/**
 * POST /api/events
 * Create new event
 *
 * @body {object} event - Event data
 * Required fields: appId, title, startTime, endTime
 */
async function eventsCreateHandler(request, context) {
    context.log('Events_Create: Request received');

    let mongoClient;

    try {
        const requestBody = await request.json();

        // Validate required fields
        if (!requestBody.appId) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'appId is required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        if (!requestBody.title || !requestBody.startTime || !requestBody.endTime) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'title, startTime, and endTime are required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // Build new event document
        const newEvent = {
            appId: requestBody.appId,
            title: requestBody.title,
            description: requestBody.description || '',
            startTime: new Date(requestBody.startTime),
            endTime: new Date(requestBody.endTime),
            isAllDay: requestBody.isAllDay || false,
            location: requestBody.location || '',
            categoryId: requestBody.categoryId || null,
            venueId: requestBody.venueId || null,
            attendees: requestBody.attendees || [],
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Insert into MongoDB
        const result = await collection.insertOne(newEvent);

        context.log(`Event created: ${result.insertedId}`);

        return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: {
                    _id: result.insertedId,
                    ...newEvent
                },
                timestamp: new Date().toISOString()
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

app.http('Events_Create', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'events',
    handler: standardMiddleware(eventsCreateHandler)
});

// ============================================
// FUNCTION 4: PUT /api/events/{eventId}
// ============================================

/**
 * PUT /api/events/{eventId}
 * Update existing event
 *
 * @param {string} eventId - Event ID
 * @body {object} event - Updated event data
 */
async function eventsUpdateHandler(request, context) {
    const eventId = request.params.eventId;
    context.log(`Events_Update: Request for event ${eventId}`);

    let mongoClient;

    try {
        const requestBody = await request.json();

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // Build update document
        const updateDoc = {
            $set: {
                ...requestBody,
                startTime: requestBody.startTime ? new Date(requestBody.startTime) : undefined,
                endTime: requestBody.endTime ? new Date(requestBody.endTime) : undefined,
                updatedAt: new Date()
            }
        };

        // Remove undefined fields
        Object.keys(updateDoc.$set).forEach(key =>
            updateDoc.$set[key] === undefined && delete updateDoc.$set[key]
        );

        // Update document
        const result = await collection.findOneAndUpdate(
            { _id: new ObjectId(eventId) },
            updateDoc,
            { returnDocument: 'after' }
        );

        if (!result.value) {
            context.log(`Event not found: ${eventId}`);
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

        context.log(`Event updated: ${eventId}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: result.value,
                timestamp: new Date().toISOString()
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

app.http('Events_Update', {
    methods: ['PUT'],
    authLevel: 'function',
    route: 'events/{eventId}',
    handler: standardMiddleware(eventsUpdateHandler)
});

// ============================================
// FUNCTION 5: DELETE /api/events/{eventId}
// ============================================

/**
 * DELETE /api/events/{eventId}
 * Delete event
 *
 * @param {string} eventId - Event ID
 */
async function eventsDeleteHandler(request, context) {
    const eventId = request.params.eventId;
    context.log(`Events_Delete: Request for event ${eventId}`);

    let mongoClient;

    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // Delete document
        const result = await collection.deleteOne({ _id: new ObjectId(eventId) });

        if (result.deletedCount === 0) {
            context.log(`Event not found: ${eventId}`);
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

        context.log(`Event deleted: ${eventId}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: `Event ${eventId} deleted successfully`,
                timestamp: new Date().toISOString()
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

app.http('Events_Delete', {
    methods: ['DELETE'],
    authLevel: 'function',
    route: 'events/{eventId}',
    handler: standardMiddleware(eventsDeleteHandler)
});
