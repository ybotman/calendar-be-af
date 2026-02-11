// src/functions/Events.js
// Domain: Events - All event CRUD operations with MongoDB integration
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');
const { enrichEventsWithTimezone } = require('../utils/timezoneService');

// ============================================
// HELPER: Convert string IDs to ObjectId
// ============================================
/**
 * Convert string ID fields to MongoDB ObjectId
 * Handles the common case where frontend sends IDs as strings in JSON
 * @param {object} data - Event data object
 * @returns {object} - Data with ID fields converted to ObjectId
 */
function convertIdFields(data) {
    const idFields = [
        'ownerOrganizerID',
        'authorOrganizerID',
        'grantedOrganizerID',
        'alternateOrganizerID',
        'venueID',
        'categoryFirstId',
        'categorySecondId',
        'categoryThirdId',
        'masteredCityId',
        'masteredDivisionId',
        'masteredRegionId'
    ];

    for (const field of idFields) {
        if (data[field] && typeof data[field] === 'string') {
            try {
                data[field] = new ObjectId(data[field]);
            } catch (err) {
                // Invalid ObjectId string - leave as-is, will fail validation later
            }
        }
    }

    return data;
}

// ============================================
// FUNCTION 1: GET /api/events
// ============================================

/**
 * GET /api/events
 * List all events with optional filtering - CALBEAF-65/74: Express parity
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
 * - active: Filter by isActive (default: "true")
 * - featured: Filter by isFeatured ("true"/"false")
 * - canceled: Filter by isCanceled ("true"/"false")
 * - discovered: Filter by isDiscovered ("true"/"false")
 * - includeAiGenerated: Include AI-generated events ("true"/"false", default excludes them)
 * - masteredRegionName: Filter by region name (string equality)
 * - masteredDivisionName: Filter by division name (string equality)
 * - masteredCityName: Filter by city name (string equality)
 * - cityIds: Filter by city ObjectIds (comma-separated or single)
 * - organizerId: Filter by organizer ownership (matches owner, granted, or alternate)
 * - authorOrganizerId: Filter by original event creator (immutable field)
 * - useGeoSearch: Enable geo search ("true") — requires lat, lng
 * - lat: Latitude for geo search (-90 to 90)
 * - lng: Longitude for geo search (-180 to 180)
 * - radius: Search radius with unit (default: "50km", supports km/m/mi)
 * - useCity: Use masteredCityGeolocation instead of venueGeolocation ("true"/"false")
 * - sortByDistance: Sort results by distance from lat/lng ("true"/"false")
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

    // CALBEAF-74: Additional query params — Express parity (items 1-6)
    // Boolean flags
    const featured = request.query.get('featured');
    const canceled = request.query.get('canceled');
    const discovered = request.query.get('discovered');
    const includeAiGenerated = request.query.get('includeAiGenerated');

    // Location name filters
    const masteredRegionName = request.query.get('masteredRegionName');
    const masteredDivisionName = request.query.get('masteredDivisionName');
    const masteredCityName = request.query.get('masteredCityName');

    // Multi-city filter
    const cityIds = request.query.get('cityIds');

    // Organizer ownership filter (for RO filtering their own events)
    const organizerId = request.query.get('organizerId');
    // Author organizer filter (original creator - immutable)
    const authorOrganizerId = request.query.get('authorOrganizerId');

    // Geo search params
    const useGeoSearch = request.query.get('useGeoSearch');
    const lat = request.query.get('lat');
    const lng = request.query.get('lng');
    const radius = request.query.get('radius');
    const useCity = request.query.get('useCity');
    const sortByDistance = request.query.get('sortByDistance');

    // Log request details
    context.log('Events_Get: Request received', {
        appId,
        start: startParam,
        end: endParam,
        categoryId,
        venueId,
        page,
        limit,
        featured,
        canceled,
        discovered,
        includeAiGenerated,
        masteredRegionName,
        masteredDivisionName,
        masteredCityName,
        cityIds,
        organizerId,
        authorOrganizerId,
        useGeoSearch,
        lat,
        lng,
        sortByDistance
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

        // CALBEAF-74: Boolean flag filters (Express parity — items 5, 6)
        // Note: request.query.get() returns null (not undefined) for missing params
        if (featured) {
            baseFilter.isFeatured = featured === 'true';
        }
        if (canceled) {
            baseFilter.isCanceled = canceled === 'true';
        }
        if (discovered) {
            baseFilter.isDiscovered = discovered === 'true';
        }
        // CALBEAF-74 item 6: includeAiGenerated — Express never implemented this filter
        // but both frontends send it. We implement it properly: exclude AI-generated events
        // by default unless explicitly included.
        if (includeAiGenerated !== 'true') {
            baseFilter.isAiGenerated = { $ne: true };
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

        // Add organizer ownership filter if provided
        // Matches events where organizerId is owner, granted, or alternate organizer
        // Same logic as /api/events/count endpoint
        if (organizerId) {
            try {
                const organizerObjId = new ObjectId(organizerId);
                andConditions.push({
                    $or: [
                        { ownerOrganizerID: organizerObjId },
                        { grantedOrganizerID: organizerObjId },
                        { alternateOrganizerID: organizerObjId }
                    ]
                });
            } catch (err) {
                context.log(`Invalid organizerId format: ${organizerId}`);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Invalid organizerId format' })
                };
            }
        }

        // Add author organizer filter if provided (immutable original creator)
        if (authorOrganizerId) {
            try {
                baseFilter.authorOrganizerID = new ObjectId(authorOrganizerId);
            } catch (err) {
                context.log(`Invalid authorOrganizerId format: ${authorOrganizerId}`);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Invalid authorOrganizerId format' })
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

        // CALBEAF-74 item 1: Mastered location name filters (Express parity)
        // String equality match on event document fields
        if (masteredRegionName) {
            baseFilter.masteredRegionName = masteredRegionName;
        }
        if (masteredDivisionName) {
            baseFilter.masteredDivisionName = masteredDivisionName;
        }
        if (masteredCityName) {
            baseFilter.masteredCityName = masteredCityName;
        }

        // CALBEAF-74 item 2: Multi-city filtering (Express parity)
        // cityIds can be a single ID or comma-separated list
        if (cityIds) {
            try {
                const idArray = Array.isArray(cityIds) ? cityIds : cityIds.split(',');
                const cityObjectIds = idArray
                    .map(id => id.trim())
                    .filter(id => id.length > 0)
                    .map(id => new ObjectId(id));
                if (cityObjectIds.length > 0) {
                    baseFilter.masteredCityId = { $in: cityObjectIds };
                }
            } catch (_err) {
                context.log(`Invalid cityIds format: ${cityIds}`);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Invalid cityIds format — expected ObjectId strings' })
                };
            }
        }

        // CALBEAF-74 item 3: Geospatial search (Express parity)
        // Uses $geoWithin / $centerSphere for location-based filtering
        let geoLat = null;
        let geoLng = null;
        if (useGeoSearch === 'true' && lat && lng) {
            geoLat = parseFloat(lat);
            geoLng = parseFloat(lng);

            if (isNaN(geoLat) || isNaN(geoLng) ||
                geoLat < -90 || geoLat > 90 ||
                geoLng < -180 || geoLng > 180) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Invalid lat/lng values. lat: -90 to 90, lng: -180 to 180' })
                };
            }

            // Parse radius: number + optional unit (km, m, mi). Default 50km
            let radiusMeters = 50000; // 50km default
            if (radius) {
                const radiusMatch = radius.match(/^([\d.]+)\s*(km|m|mi)?$/i);
                if (radiusMatch) {
                    const radiusValue = parseFloat(radiusMatch[1]);
                    const radiusUnit = (radiusMatch[2] || 'km').toLowerCase();
                    if (radiusUnit === 'km') {
                        radiusMeters = radiusValue * 1000;
                    } else if (radiusUnit === 'mi') {
                        radiusMeters = radiusValue * 1609.344;
                    } else {
                        radiusMeters = radiusValue;
                    }
                }
            }

            // Convert meters to radians (Earth radius = 6378137m)
            const radiusRadians = radiusMeters / 6378137;

            // Choose geo field based on useCity param (Express parity)
            const geoField = useCity === 'true'
                ? 'masteredCityGeolocation'
                : 'venueGeolocation';

            baseFilter[geoField] = {
                $geoWithin: {
                    $centerSphere: [[geoLng, geoLat], radiusRadians]
                }
            };

            context.log(`Events_Get: Geo search enabled — ${geoField}, radius ${radiusMeters}m (${radiusRadians.toFixed(6)} rad)`);
        } else if (lat && lng) {
            // Basic geo filter without explicit useGeoSearch (Express fallback — lines 646-669)
            geoLat = parseFloat(lat);
            geoLng = parseFloat(lng);
            if (!isNaN(geoLat) && !isNaN(geoLng) &&
                geoLat >= -90 && geoLat <= 90 &&
                geoLng >= -180 && geoLng <= 180) {
                const defaultRadiusRadians = 50000 / 6378137; // 50km default
                const geoField = useCity === 'true'
                    ? 'masteredCityGeolocation'
                    : 'venueGeolocation';
                baseFilter[geoField] = {
                    $geoWithin: {
                        $centerSphere: [[geoLng, geoLat], defaultRadiusRadians]
                    }
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

        // CALBEAF-74 item 4: sortByDistance — when enabled with lat/lng, sort results
        // by distance from the provided coordinates using Haversine formula.
        // For distance sorting we need ALL matching docs first, then sort, then paginate.
        const wantDistanceSort = sortByDistance === 'true' && geoLat !== null && geoLng !== null;

        let events, total;

        if (wantDistanceSort) {
            // Fetch all matching events (no skip/limit yet — we sort then paginate)
            const [allEvents, count] = await Promise.all([
                collection.find(filter).sort({ startDate: 1 }).toArray(),
                collection.countDocuments(filter)
            ]);
            total = count;

            // Haversine distance calculation (Express parity — serverEvents.js lines 767-786)
            const toRad = (deg) => deg * Math.PI / 180;
            const haversine = (lat1, lon1, lat2, lon2) => {
                const R = 6371; // Earth radius in km
                const dLat = toRad(lat2 - lat1);
                const dLon = toRad(lon2 - lon1);
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                return R * c;
            };

            // Calculate distance for each event and attach it
            const geoField = useCity === 'true' ? 'masteredCityGeolocation' : 'venueGeolocation';
            for (const event of allEvents) {
                const geo = event[geoField];
                if (geo && geo.coordinates && geo.coordinates.length === 2) {
                    // GeoJSON coordinates are [lng, lat]
                    event.distance = Math.round(haversine(geoLat, geoLng, geo.coordinates[1], geo.coordinates[0]) * 100) / 100;
                    event.distanceUnit = 'km';
                } else {
                    event.distance = null;
                    event.distanceUnit = 'km';
                }
            }

            // Sort by distance (nulls at end), then paginate
            allEvents.sort((a, b) => {
                if (a.distance === null && b.distance === null) return 0;
                if (a.distance === null) return 1;
                if (b.distance === null) return -1;
                return a.distance - b.distance;
            });

            events = allEvents.slice(skip, skip + limitNum);
        } else {
            // Standard query path — sort by startDate, paginate in MongoDB
            const eventQuery = collection
                .find(filter)
                .sort({ startDate: 1 })
                .skip(skip)
                .limit(limitNum);

            [events, total] = await Promise.all([
                eventQuery.toArray(),
                collection.countDocuments(filter)
            ]);

            // If lat/lng provided but no sortByDistance, still compute distance for display
            if (geoLat !== null && geoLng !== null) {
                const toRad = (deg) => deg * Math.PI / 180;
                const haversine = (lat1, lon1, lat2, lon2) => {
                    const R = 6371;
                    const dLat = toRad(lat2 - lat1);
                    const dLon = toRad(lon2 - lon1);
                    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    return R * c;
                };
                const geoField = useCity === 'true' ? 'masteredCityGeolocation' : 'venueGeolocation';
                for (const event of events) {
                    const geo = event[geoField];
                    if (geo && geo.coordinates && geo.coordinates.length === 2) {
                        event.distance = Math.round(haversine(geoLat, geoLng, geo.coordinates[1], geo.coordinates[0]) * 100) / 100;
                        event.distanceUnit = 'km';
                    }
                }
            }
        }

        context.log(`Found ${events.length} events for appId: ${appId} (page ${pageNum}/${Math.ceil(total/limitNum)})`);

        // Return response with pagination info
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                events: enrichEventsWithTimezone(events || []),
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    pages: Math.ceil(total / limitNum)
                }
            })
        };

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
// FUNCTION 1b: GET /api/events/count
// ============================================

/**
 * GET /api/events/count
 * Return count of events matching appId and ownerId - used by useMigratedOrganizers.js
 *
 * Query Parameters:
 * - appId: Application ID (required)
 * - ownerId: Organizer ObjectId (required) — matches ownerOrganizerID, grantedOrganizerID, or alternateOrganizerID
 *
 * Response: { count: <number> }
 */
async function eventsCountHandler(request, context) {
    const appId = request.query.get('appId');
    const ownerId = request.query.get('ownerId');

    context.log('Events_Count: Request received', { appId, ownerId });

    if (!appId) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'appId is required' })
        };
    }

    if (!ownerId) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'ownerId is required' })
        };
    }

    let mongoClient;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('events');

        // Match Express owner lookup: check all 3 organizer ID fields
        // See calendar-be serverEvents.js lines 1240-1242
        let ownerObjectId;
        try {
            ownerObjectId = new ObjectId(ownerId);
        } catch {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Invalid ownerId format' })
            };
        }

        const filter = {
            appId,
            isActive: true,
            $or: [
                { ownerOrganizerID: ownerObjectId },
                { grantedOrganizerID: ownerObjectId },
                { alternateOrganizerID: ownerObjectId }
            ]
        };

        const count = await collection.countDocuments(filter);

        context.log(`Events_Count: Found ${count} events for ownerId ${ownerId}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Events_Count', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'events/count',
    handler: standardMiddleware(eventsCountHandler)
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

        // Enrich single event with timezone display fields
        const [enriched] = enrichEventsWithTimezone([event]);

        // Return event at root level to match calendar-be response format
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(enriched)
        };
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

    // Firebase auth — matches calendar-be authenticateToken middleware
    const user = await firebaseAuth(request, context);
    if (!user) {
        return unauthorizedResponse();
    }
    context.log(`Events_Create: Authenticated user ${user.uid}`);

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

        // Convert string IDs to ObjectId (frontend sends IDs as strings in JSON)
        convertIdFields(newEvent);

        // Set authorOrganizerID to ownerOrganizerID at creation (immutable original creator)
        // This field should never change, even if ownerOrganizerID is reassigned later
        if (newEvent.ownerOrganizerID && !newEvent.authorOrganizerID) {
            newEvent.authorOrganizerID = newEvent.ownerOrganizerID;
        }

        // Populate venueTimezone from venue document (Express parity)
        const venueIdForTz = requestBody.venueID || requestBody.venueId;
        if (venueIdForTz && !newEvent.venueTimezone) {
            const venuesCollection = db.collection('venues');
            const venue = await venuesCollection.findOne({ _id: new ObjectId(venueIdForTz) });
            if (venue && venue.timezone) {
                newEvent.venueTimezone = venue.timezone;
            } else {
                context.warn(`Venue ${venueIdForTz} not found or missing timezone - venueTimezone not set`);
            }
        }

        // Insert into MongoDB
        const result = await collection.insertOne(newEvent);

        context.log(`Event created: ${result.insertedId}`);

        // CALBEAF-57: Reactivate venue if it's currently inactive
        // When an event is created with an inactive venue, set venue.isActive=true
        // Note: calendar-be uses venueID (capital ID)
        const venueId = newEvent.venueID || newEvent.venueId;
        if (venueId) {
            try {
                const venuesCollection = db.collection('venues');
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
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Events_Create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'events',
    handler: standardMiddleware(eventsCreateHandler)
});

// Legacy route alias: calendar-be used POST /api/events/post
// Multiple frontends (TangoTiempo, HarmonyJunction) call this path
app.http('Events_Create_Legacy', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'events/post',
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

    // Firebase auth — matches calendar-be authenticateToken middleware
    const user = await firebaseAuth(request, context);
    if (!user) {
        return unauthorizedResponse();
    }
    context.log(`Events_Update: Authenticated user ${user.uid}`);

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

        // Convert string IDs to ObjectId (frontend sends IDs as strings in JSON)
        convertIdFields(updateDoc.$set);

        // Remove undefined fields
        Object.keys(updateDoc.$set).forEach(key =>
            updateDoc.$set[key] === undefined && delete updateDoc.$set[key]
        );

        // Remove _id from update body (immutable in MongoDB)
        delete updateDoc.$set._id;

        // If venueID changed, look up venue timezone and include in update
        const updatedVenueId = requestBody.venueID || requestBody.venueId;
        if (updatedVenueId) {
            const venuesCollection = db.collection('venues');
            const venue = await venuesCollection.findOne({ _id: new ObjectId(updatedVenueId) });
            if (venue && venue.timezone) {
                updateDoc.$set.venueTimezone = venue.timezone;
            } else {
                context.warn(`Venue ${updatedVenueId} not found or missing timezone - venueTimezone not updated`);
            }
        }

        // Update document — MongoDB driver 6.x returns doc directly (not {value: doc})
        const updatedDoc = await collection.findOneAndUpdate(
            { _id: new ObjectId(eventId) },
            updateDoc,
            { returnDocument: 'after' }
        );

        if (!updatedDoc) {
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
                data: updatedDoc,
                timestamp: new Date().toISOString()
            })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Events_Update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
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

    // Firebase auth — matches calendar-be authenticateToken middleware
    const user = await firebaseAuth(request, context);
    if (!user) {
        return unauthorizedResponse();
    }
    context.log(`Events_Delete: Authenticated user ${user.uid}`);

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
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Events_Delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
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
        const uriParts = mongoUri.match(/mongodb\+srv:\/\/[^@]+@([^/]+)\/([^?]+)/);
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
