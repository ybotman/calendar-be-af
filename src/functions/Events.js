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
 * List all events with optional filtering - CALBEAF-65: Express parity
 *
 * Query Parameters:
 * - appId: Application ID (1=TangoTiempo, 2=HarmonyJunction) (required)
 * - start: Filter events from date (YYYY-MM-DD) - Express parity
 * - end: Filter events to date (YYYY-MM-DD) - Express parity
 * - startDate: Alias for start (legacy support)
 * - endDate: Alias for end (legacy support)
 * - categoryId: Filter by category
 * - venueId: Filter by venue
 * - limit: Results per page (default: 100, max: 500)
 * - page: Page number (default: 1)
 *
 * Default Date Behavior (if no dates provided):
 * - start: First day of current month
 * - end: Last day of 6 months from now
 *
 * IMPORTANT: Recurring events are ALWAYS returned regardless of date filter!
 *
 * Response: { events: [...], pagination: { total, page, limit, pages } }
 */
async function eventsGetHandler(request, context) {
    // Extract query parameters - support both 'start/end' (Express) and 'startDate/endDate' (legacy)
    const appId = request.query.get('appId');
    const startParam = request.query.get('start') || request.query.get('startDate');
    const endParam = request.query.get('end') || request.query.get('endDate');
    const categoryId = request.query.get('categoryId');
    const venueId = request.query.get('venueId');
    const page = request.query.get('page') || '1';
    const limit = request.query.get('limit') || '100';

    // Log request details
    context.log('Events_Get: Request received', {
        appId,
        start: startParam,
        end: endParam,
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

        // CALBEAF-65 v1.13.9: Match Express date calculation EXACTLY
        // Express uses: new Date(year, month, day) which is LOCAL server time
        // Since Azure Functions runs in UTC, we need to match Express (EST) behavior
        const today = new Date();
        let startDate, endDate;

        if (startParam) {
            startDate = new Date(startParam);
            if (isNaN(startDate.getTime())) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Invalid date format for start parameter' })
                };
            }
        } else {
            // Default: First day of current month (matches Express line 301)
            // Express: new Date(today.getFullYear(), today.getMonth(), 1)
            // This creates a LOCAL time date - we replicate the same logic
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        }

        if (endParam) {
            endDate = new Date(endParam);
            if (isNaN(endDate.getTime())) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Invalid date format for end parameter' })
                };
            }
        } else {
            // Default: Last day of 6 months from now (matches Express line 302)
            // Express: new Date(today.getFullYear(), today.getMonth() + 6, 0)
            endDate = new Date(today.getFullYear(), today.getMonth() + 6, 0);
        }

        context.log(`Events_Get: Date range ${startDate.toISOString()} to ${endDate.toISOString()}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // CALBEAF-65: Build query with Express parity - recurring events ALWAYS included
        // Express logic: Regular events within date range OR any recurring events
        const baseFilter = { appId };

        // CALBEAF-65 v1.13.4: Express has active="true" as DEFAULT (line 267)
        // So isActive=true IS applied by default (Ben's correction)
        const activeParam = request.query.get('active');
        if (activeParam === 'false') {
            baseFilter.isActive = false;
        } else {
            // Default: isActive=true (matches Express default active="true" on line 267)
            baseFilter.isActive = true;
        }

        // Collection for $and conditions (like calendar-be's andConditions array)
        const andConditions = [];

        // Add category filter if provided
        // CALBEAF-65: Match calendar-be - search all 3 category fields with $or
        if (categoryId) {
            try {
                const categoryObjId = new ObjectId(categoryId);
                andConditions.push({
                    $or: [
                        { categoryFirstId: categoryObjId },
                        { categorySecondId: categoryObjId },
                        { categoryThirdId: categoryObjId }
                    ]
                });
            } catch (err) {
                context.log(`Invalid categoryId format: ${categoryId}`);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Invalid categoryId format' })
                };
            }
        }

        // Add venue filter if provided
        // CALBEAF-65: Match calendar-be - use venueID (capital ID)
        if (venueId) {
            try {
                baseFilter.venueID = new ObjectId(venueId);
            } catch (err) {
                context.log(`Invalid venueId format: ${venueId}`);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Invalid venueId format' })
                };
            }
        }

        // Combined query: (regular events in date range) OR (recurring events)
        // CALBEAF-65 v1.13.6: Match Express EXACTLY (serverEvents.js lines 311-325)
        //
        // Express uses Mongoose which interprets { $ne: null, $ne: '' } by internally
        // converting it. For native MongoDB driver, we need explicit structure.
        //
        // Key insight: Express { $exists: true, $ne: null, $ne: '' } is INVALID syntax
        // but Mongoose converts it. For native driver, use $and array.
        const dateConditions = [
            // Condition 1: Regular events in date range (non-recurring)
            {
                startDate: { $gte: startDate, $lte: endDate },
                $or: [
                    { recurrenceRule: { $exists: false } },
                    { recurrenceRule: null },
                    { recurrenceRule: '' }
                ]
            },
            // Condition 2: ALL recurring events (no date filter)
            // Use $and to properly check: exists AND not null AND not empty
            {
                $and: [
                    { recurrenceRule: { $exists: true } },
                    { recurrenceRule: { $ne: null } },
                    { recurrenceRule: { $ne: '' } }
                ]
            }
        ];

        // Build final filter: baseFilter + dateConditions + andConditions
        // CALBEAF-65: Use $and to combine multiple $or clauses (like calendar-be)
        let filter = {
            ...baseFilter,
            $or: dateConditions
        };

        // If we have andConditions (e.g., category filter), wrap everything in $and
        if (andConditions.length > 0) {
            filter = {
                $and: [
                    { ...baseFilter, $or: dateConditions },
                    ...andConditions
                ]
            };
        }

        // CALBEAF-65 v1.13.10: Enhanced debug logging - check recurring counts
        context.log('Events_Get: baseFilter:', JSON.stringify(baseFilter));
        context.log('Events_Get: final filter:', JSON.stringify(filter));
        context.log(`Fetching events for appId: ${appId} with pagination: page ${pageNum}, limit ${limitNum}`);

        // Debug: Count recurring events with different query approaches
        const recurringQuery1 = await collection.countDocuments({
            ...baseFilter,
            recurrenceRule: { $exists: true, $ne: null, $ne: '' }
        });
        const recurringQuery2 = await collection.countDocuments({
            ...baseFilter,
            $and: [
                { recurrenceRule: { $exists: true } },
                { recurrenceRule: { $ne: null } },
                { recurrenceRule: { $ne: '' } }
            ]
        });
        const recurringQuery3 = await collection.countDocuments({
            ...baseFilter,
            recurrenceRule: { $exists: true, $type: 'string', $ne: '' }
        });
        // Check for any recurrenceRule that exists (including empty/null)
        const hasAnyRecurrence = await collection.countDocuments({
            ...baseFilter,
            recurrenceRule: { $exists: true }
        });
        context.log(`RECURRING DEBUG - Query1(mongoose-style): ${recurringQuery1}, Query2($and): ${recurringQuery2}, Query3($type string): ${recurringQuery3}, HasAny: ${hasAnyRecurrence}`);

        // Build MongoDB query
        const eventQuery = collection
            .find(filter)
            .sort({ startDate: 1 }) // Sort by startDate ascending (Express uses startDate)
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
        const mongoUri = process.env.MONGODB_URI;
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

        // Return event at root level to match calendar-be response format
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event)
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
    route: 'events/id/{eventId}',
    handler: standardMiddleware(eventsGetByIdHandler)
});

// ============================================
// FUNCTION 3: POST /api/events
// ============================================

/**
 * POST /api/events
 * Create new event - Express parity with calendar-be
 *
 * @body {object} event - Event data
 * Required fields: appId, title, startDate, endDate (matches calendar-be)
 */
async function eventsCreateHandler(request, context) {
    context.log('Events_Create: Request received');

    let mongoClient;

    try {
        const requestBody = await request.json();

        // Validate required fields - match calendar-be exactly
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

        // Express parity: calendar-be requires title, startDate, endDate
        if (!requestBody.title || !requestBody.startDate || !requestBody.endDate) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Title, Start Date, and End Date are required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Parse and validate dates
        const parsedStartDate = new Date(requestBody.startDate);
        if (isNaN(parsedStartDate.getTime())) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid startDate format',
                    timestamp: new Date().toISOString()
                })
            };
        }

        const parsedEndDate = new Date(requestBody.endDate);
        if (isNaN(parsedEndDate.getTime())) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid endDate format',
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

        // Build new event document - use startDate/endDate like calendar-be
        // Pass through all fields from request, with explicit date parsing
        const newEvent = {
            ...requestBody,
            startDate: parsedStartDate,
            endDate: parsedEndDate,
            isAllDay: requestBody.isAllDay || false,
            isActive: requestBody.isActive !== undefined ? requestBody.isActive : true,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Insert into MongoDB
        const result = await collection.insertOne(newEvent);

        context.log(`Event created: ${result.insertedId}`);

        // CALBEAF-57: Reactivate venue if it's currently inactive
        // When an event is created with an inactive venue, set venue.isActive=true
        // Note: calendar-be uses venueID (capital ID)
        const venueId = newEvent.venueID || newEvent.venueId;
        if (venueId) {
            try {
                const venuesCollection = db.collection('Venues');
                const venueObjectId = typeof venueId === 'string'
                    ? new ObjectId(venueId)
                    : venueId;

                const venueUpdateResult = await venuesCollection.updateOne(
                    { _id: venueObjectId, isActive: false },
                    {
                        $set: {
                            isActive: true,
                            reactivatedAt: new Date(),
                            reactivatedByEventId: result.insertedId
                        }
                    }
                );

                if (venueUpdateResult.modifiedCount > 0) {
                    context.log(`CALBEAF-57: Venue ${venueId} reactivated due to event creation ${result.insertedId}`);
                }
            } catch (venueError) {
                // Log but don't fail event creation if venue update fails
                context.warn(`CALBEAF-57: Failed to check/reactivate venue ${venueId}: ${venueError.message}`);
            }
        }

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
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // Build update document - use startDate/endDate like calendar-be
        const updateDoc = {
            $set: {
                ...requestBody,
                startDate: requestBody.startDate ? new Date(requestBody.startDate) : undefined,
                endDate: requestBody.endDate ? new Date(requestBody.endDate) : undefined,
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
        const mongoUri = process.env.MONGODB_URI;
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

// ============================================
// DEBUG: GET /api/events-debug - Recurring events analysis
// ============================================
async function eventsDebugHandler(request, context) {
    const appId = request.query.get('appId') || '1';

    let mongoClient;
    try {
        const mongoUri = process.env.MONGODB_URI;
        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        const baseFilter = { appId, isActive: true };

        // CALBEAF-65: Calculate date range like Express
        const today = new Date();
        const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        const endDate = new Date(today.getFullYear(), today.getMonth() + 6, 0);

        // Various recurring event queries
        const results = {
            // Date range info
            dateRange: {
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                todayLocal: today.toISOString(),
                month: today.getMonth(),
                monthPlusSix: today.getMonth() + 6
            },

            // Total active events
            totalActive: await collection.countDocuments(baseFilter),

            // Recurring: all queries return same (30)
            recurringCount: await collection.countDocuments({
                ...baseFilter,
                $and: [
                    { recurrenceRule: { $exists: true } },
                    { recurrenceRule: { $ne: null } },
                    { recurrenceRule: { $ne: '' } }
                ]
            }),

            // Non-recurring in date range (Express query logic)
            nonRecurringInRange: await collection.countDocuments({
                ...baseFilter,
                startDate: { $gte: startDate, $lte: endDate },
                $or: [
                    { recurrenceRule: { $exists: false } },
                    { recurrenceRule: null },
                    { recurrenceRule: '' }
                ]
            }),

            // Alternative: events with startDate in range, without recurrenceRule filter
            eventsInRangeNoRecurrenceFilter: await collection.countDocuments({
                ...baseFilter,
                startDate: { $gte: startDate, $lte: endDate }
            }),

            // Total from combined query (what AF Events returns)
            combinedQuery: await collection.countDocuments({
                ...baseFilter,
                $or: [
                    {
                        startDate: { $gte: startDate, $lte: endDate },
                        $or: [
                            { recurrenceRule: { $exists: false } },
                            { recurrenceRule: null },
                            { recurrenceRule: '' }
                        ]
                    },
                    {
                        $and: [
                            { recurrenceRule: { $exists: true } },
                            { recurrenceRule: { $ne: null } },
                            { recurrenceRule: { $ne: '' } }
                        ]
                    }
                ]
            }),

            // Without applying recurrence conditions at all
            simpleRangeOnly: await collection.countDocuments({
                ...baseFilter,
                startDate: { $gte: startDate, $lte: endDate }
            }),

            // Events before start date
            beforeRange: await collection.countDocuments({
                ...baseFilter,
                startDate: { $lt: startDate }
            }),

            // Events after end date
            afterRange: await collection.countDocuments({
                ...baseFilter,
                startDate: { $gt: endDate }
            }),

            // Has recurrenceRule field at all
            hasField: await collection.countDocuments({
                ...baseFilter,
                recurrenceRule: { $exists: true }
            }),

            // Events with empty string recurrenceRule
            emptyStringRecurrence: await collection.countDocuments({
                ...baseFilter,
                recurrenceRule: ''
            }),

            // Sample of recurrenceRule values
            sampleRecurrenceRules: await collection.aggregate([
                { $match: { ...baseFilter, recurrenceRule: { $exists: true } } },
                { $group: { _id: '$recurrenceRule', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]).toArray()
        };

        // Calculate expected total
        results.expectedTotal = results.recurringCount + results.nonRecurringInRange;
        results.mathCheck = `${results.recurringCount} + ${results.nonRecurringInRange} = ${results.expectedTotal}`;
        results.rangeCheck = `before:${results.beforeRange} + inRange:${results.eventsInRangeNoRecurrenceFilter} + after:${results.afterRange} = ${results.beforeRange + results.eventsInRangeNoRecurrenceFilter + results.afterRange} (should be ${results.totalActive})`;

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(results, null, 2)
        };
    } finally {
        if (mongoClient) await mongoClient.close();
    }
}

app.http('Events_Debug', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'events-debug',
    handler: eventsDebugHandler
});

// ============================================
// DEBUG: GET /api/db-info - MongoDB connection info
// ============================================
async function dbInfoHandler(request, context) {
    let mongoClient;
    try {
        const mongoUri = process.env.MONGODB_URI;

        // Extract host (masked) and database name from URI
        const uriParts = mongoUri.match(/mongodb\+srv:\/\/[^@]+@([^\/]+)\/([^?]+)/);
        const clusterHost = uriParts ? uriParts[1] : 'unknown';
        const dbName = uriParts ? uriParts[2] : 'unknown';

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const actualDbName = db.databaseName;

        // Get total counts (no filters)
        const totalEvents = await db.collection('events').countDocuments({ appId: '1' });
        const totalOrganizers = await db.collection('organizers').countDocuments({ appId: '1' });
        const totalVenues = await db.collection('venues').countDocuments({ appId: '1' });

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                version: require('../../package.json').version,
                mongodb: {
                    clusterHost,
                    configuredDb: dbName,
                    actualDb: actualDbName
                },
                rawCounts: {
                    events: totalEvents,
                    organizers: totalOrganizers,
                    venues: totalVenues
                },
                timestamp: new Date().toISOString()
            }, null, 2)
        };
    } finally {
        if (mongoClient) await mongoClient.close();
    }
}

app.http('DB_Info', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'db-info',
    handler: dbInfoHandler
});
