// src/functions/EventsSummary.js
// Domain: Events - Summary/aggregation endpoint for map clusters, event lists, and city rollups
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

// ============================================
// FUNCTION: GET /api/events/summary
// ============================================

/**
 * GET /api/events/summary
 * Aggregated event data for map display - clusters, event lists, or city rollups
 *
 * Query Parameters:
 * - appId: Application ID (default "1")
 * - format: "clusters" | "events" | "cities" (default "clusters")
 * - zoom: Map zoom level 1-20 (default 5)
 * - bounds: JSON string { north, south, east, west }
 * - startDate: YYYY-MM format
 * - endDate: YYYY-MM format
 * - categories: Comma-separated category IDs
 * - masteredCityId: Filter by mastered city
 * - page: Page number for format=events (default 1)
 * - limit: Results per page for format=events (default 50, max 500)
 */
async function eventsSummaryHandler(request, context) {
    // Extract query parameters with defaults
    const appId = request.query.get('appId') || '1';
    const format = request.query.get('format') || 'clusters';
    const zoom = Math.min(20, Math.max(1, parseInt(request.query.get('zoom')) || 5));
    const boundsParam = request.query.get('bounds');
    const startDateParam = request.query.get('startDate');
    const endDateParam = request.query.get('endDate');
    const categoriesParam = request.query.get('categories');
    const masteredCityId = request.query.get('masteredCityId');
    const page = Math.max(1, parseInt(request.query.get('page')) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(request.query.get('limit')) || 50));

    context.log('EventsSummary: Request received', {
        appId, format, zoom, bounds: boundsParam,
        startDate: startDateParam, endDate: endDateParam,
        categories: categoriesParam, masteredCityId, page, limit
    });

    // Validate format parameter
    const validFormats = ['clusters', 'events', 'cities'];
    if (!validFormats.includes(format)) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `Invalid format "${format}". Must be one of: ${validFormats.join(', ')}`
            })
        };
    }

    let mongoClient;

    try {
        // --- Build date range ---
        const today = new Date();
        let startDate, endDate;

        if (startDateParam) {
            // YYYY-MM format: parse as first day of that month
            const parts = startDateParam.split('-');
            startDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
        } else {
            // Default: first day of current month
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        }

        if (endDateParam) {
            // YYYY-MM format: parse as last day of that month
            const parts = endDateParam.split('-');
            endDate = new Date(parseInt(parts[0]), parseInt(parts[1]), 0); // day 0 = last day of prev month
        } else {
            // Default: last day of 6 months from now
            endDate = new Date(today.getFullYear(), today.getMonth() + 6, 0);
        }

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Invalid date format. Use YYYY-MM.' })
            };
        }

        context.log(`EventsSummary: Date range ${startDate.toISOString()} to ${endDate.toISOString()}`);

        // --- Parse bounds ---
        let bounds = null;
        if (boundsParam) {
            try {
                bounds = JSON.parse(boundsParam);
                if (bounds.north == null || bounds.south == null || bounds.east == null || bounds.west == null) {
                    return {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: 'bounds must include north, south, east, west' })
                    };
                }
            } catch (parseErr) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Invalid bounds JSON format' })
                };
            }
        }

        // --- Parse categories ---
        let categoryIds = null;
        if (categoriesParam) {
            try {
                categoryIds = categoriesParam.split(',').map(id => new ObjectId(id.trim()));
            } catch (catErr) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Invalid category ID format in categories parameter' })
                };
            }
        }

        // --- Connect to MongoDB ---
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // --- Build base query ---
        const baseQuery = { appId, isActive: true };

        // Date conditions: non-recurring in range OR recurring (always included)
        const dateQuery = {
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
        };

        // Combine base + date into $and conditions
        const andConditions = [baseQuery, dateQuery];

        // Bounds filter: check venueGeolocation or masteredCityGeolocation
        if (bounds) {
            andConditions.push({
                $or: [
                    {
                        'venueGeolocation.lat': { $gte: bounds.south, $lte: bounds.north },
                        'venueGeolocation.lng': { $gte: bounds.west, $lte: bounds.east }
                    },
                    {
                        'masteredCityGeolocation.lat': { $gte: bounds.south, $lte: bounds.north },
                        'masteredCityGeolocation.lng': { $gte: bounds.west, $lte: bounds.east }
                    }
                ]
            });
        }

        // Category filter: match categoryFirstId against provided IDs
        if (categoryIds && categoryIds.length > 0) {
            andConditions.push({
                categoryFirstId: { $in: categoryIds }
            });
        }

        // City filter
        if (masteredCityId) {
            andConditions.push({ masteredCityId });
        }

        const matchStage = { $and: andConditions };

        // --- Execute format-specific logic ---
        if (format === 'clusters') {
            return await handleClusters(collection, db, matchStage, zoom, context);
        } else if (format === 'events') {
            return await handleEvents(collection, matchStage, page, limit, context);
        } else if (format === 'cities') {
            return await handleCities(collection, db, matchStage, context);
        }

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

// ============================================
// format=clusters: Aggregate by geographic grouping based on zoom
// ============================================
async function handleClusters(collection, db, matchStage, zoom, context) {
    // Determine aggregation level and grouping field based on zoom
    let groupField, lookupCollection, lookupLocalField, aggregationLevel;

    if (zoom <= 5) {
        groupField = '$masteredRegionId';
        lookupCollection = 'masteredregions';
        lookupLocalField = 'masteredRegionId';
        aggregationLevel = 'region';
    } else if (zoom <= 10) {
        groupField = '$masteredDivisionId';
        lookupCollection = 'mastereddivisions';
        lookupLocalField = 'masteredDivisionId';
        aggregationLevel = 'division';
    } else if (zoom <= 14) {
        groupField = '$masteredCityId';
        lookupCollection = 'masteredcities';
        lookupLocalField = 'masteredCityId';
        aggregationLevel = 'city';
    } else {
        groupField = '$venueID';
        lookupCollection = 'venues';
        lookupLocalField = 'venueID';
        aggregationLevel = 'venue';
    }

    context.log(`EventsSummary clusters: zoom=${zoom}, aggregationLevel=${aggregationLevel}`);

    // Build aggregation pipeline
    const pipeline = [
        { $match: matchStage },
        {
            $group: {
                _id: groupField,
                eventCount: { $sum: 1 },
                // Grab first available coordinate for cluster center
                lat: { $first: { $ifNull: ['$venueGeolocation.lat', '$masteredCityGeolocation.lat'] } },
                lng: { $first: { $ifNull: ['$venueGeolocation.lng', '$masteredCityGeolocation.lng'] } },
                // Collect distinct category IDs for breakdown
                categories: { $addToSet: '$categoryFirstId' }
            }
        },
        // Filter out groups with null _id (events without the grouping field)
        { $match: { _id: { $ne: null } } },
        { $sort: { eventCount: -1 } }
    ];

    const clusterResults = await collection.aggregate(pipeline).toArray();

    // Lookup names from the appropriate collection
    const lookupIds = clusterResults
        .map(c => c._id)
        .filter(id => id != null);

    let nameMap = {};
    if (lookupIds.length > 0) {
        try {
            // Convert string IDs to ObjectId for lookup if needed
            const objectIds = lookupIds.map(id => {
                try {
                    return new ObjectId(id);
                } catch {
                    return id;
                }
            });

            const lookupDocs = await db.collection(lookupCollection)
                .find({ _id: { $in: objectIds } })
                .project({ _id: 1, name: 1 })
                .toArray();

            lookupDocs.forEach(doc => {
                nameMap[doc._id.toString()] = doc.name;
            });
        } catch (lookupErr) {
            context.log(`EventsSummary: Lookup warning for ${lookupCollection}: ${lookupErr.message}`);
        }
    }

    // Build response clusters
    const clusters = clusterResults.map(c => ({
        id: c._id ? c._id.toString() : null,
        name: nameMap[c._id ? c._id.toString() : ''] || 'Unknown',
        center: {
            lat: c.lat || 0,
            lng: c.lng || 0
        },
        eventCount: c.eventCount,
        categories: (c.categories || []).filter(cat => cat != null).map(cat => cat.toString())
    }));

    const totalEvents = clusters.reduce((sum, c) => sum + c.eventCount, 0);

    context.log(`EventsSummary clusters: ${clusters.length} clusters, ${totalEvents} total events`);

    return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            zoomLevel: zoom,
            clusters,
            metadata: {
                totalEvents,
                totalClusters: clusters.length,
                aggregationLevel
            }
        })
    };
}

// ============================================
// format=events: Standard paginated event list
// ============================================
async function handleEvents(collection, matchStage, page, limit, context) {
    const skip = (page - 1) * limit;

    const [events, totalCount] = await Promise.all([
        collection
            .find(matchStage)
            .sort({ startDate: 1 })
            .skip(skip)
            .limit(limit)
            .toArray(),
        collection.countDocuments(matchStage)
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    context.log(`EventsSummary events: ${events.length} of ${totalCount} (page ${page}/${totalPages})`);

    return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            events,
            totalCount,
            pagination: {
                page,
                limit,
                totalPages
            }
        })
    };
}

// ============================================
// format=cities: Aggregate by masteredCityId
// ============================================
async function handleCities(collection, db, matchStage, context) {
    const pipeline = [
        { $match: matchStage },
        {
            $group: {
                _id: '$masteredCityId',
                eventCount: { $sum: 1 },
                lat: { $first: '$masteredCityGeolocation.lat' },
                lng: { $first: '$masteredCityGeolocation.lng' }
            }
        },
        { $match: { _id: { $ne: null } } },
        { $sort: { eventCount: -1 } }
    ];

    const cityResults = await collection.aggregate(pipeline).toArray();

    // Lookup city names from masteredcities collection
    const cityIds = cityResults
        .map(c => c._id)
        .filter(id => id != null);

    let cityNameMap = {};
    if (cityIds.length > 0) {
        try {
            const objectIds = cityIds.map(id => {
                try {
                    return new ObjectId(id);
                } catch {
                    return id;
                }
            });

            const cityDocs = await db.collection('masteredcities')
                .find({ _id: { $in: objectIds } })
                .project({ _id: 1, name: 1 })
                .toArray();

            cityDocs.forEach(doc => {
                cityNameMap[doc._id.toString()] = doc.name;
            });
        } catch (lookupErr) {
            context.log(`EventsSummary: City name lookup warning: ${lookupErr.message}`);
        }
    }

    // Build response
    const cities = cityResults.map(c => ({
        masteredCityId: c._id ? c._id.toString() : null,
        cityName: cityNameMap[c._id ? c._id.toString() : ''] || 'Unknown',
        coordinates: {
            lat: c.lat || 0,
            lng: c.lng || 0
        },
        eventCount: c.eventCount
    }));

    const totalEvents = cities.reduce((sum, c) => sum + c.eventCount, 0);

    context.log(`EventsSummary cities: ${cities.length} cities, ${totalEvents} total events`);

    return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            cities,
            totalCities: cities.length,
            totalEvents
        })
    };
}

// Register function with standard middleware
app.http('EventsSummary_Get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'events/summary',
    handler: standardMiddleware(eventsSummaryHandler)
});
