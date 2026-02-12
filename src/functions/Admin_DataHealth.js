// src/functions/Admin_DataHealth.js
// Domain: Admin - Data health checks for CALOPS dashboard (CALOPS-41)

const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');

// Cache for data health results (5 minute TTL)
let healthCache = null;
let healthCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/ops/data-health
 * Returns all data quality issues in one call
 *
 * Requires function key for authentication.
 * Results are cached for 5 minutes to prevent performance issues.
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - refresh: "true" to bypass cache
 * - limit: Max items per category (default: 100)
 *
 * Response: {
 *   eventsWithoutVenue: [...],
 *   venuesMissingGeocoding: [...],
 *   venuesMissingMasteredCity: [...],
 *   organizersNotLinkedToUser: [...],
 *   usersWithInvalidOrganizerId: [...],
 *   expiredRecurringEventsStillActive: [...],
 *   eventsInPastStillActive: [...],
 *   summary: { totalIssues, criticalCount, warningCount },
 *   cached: boolean,
 *   cachedAt: ISO string
 * }
 */
async function dataHealthHandler(request, context) {
    const startTime = Date.now();
    context.log('Admin_DataHealth: Request received');

    const appId = request.query.get('appId') || '1';
    const refresh = request.query.get('refresh') === 'true';
    const limit = Math.min(500, parseInt(request.query.get('limit') || '100', 10));

    // Check cache
    const now = Date.now();
    if (!refresh && healthCache && (now - healthCacheTime) < CACHE_TTL_MS) {
        context.log('Admin_DataHealth: Returning cached results');
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...healthCache,
                cached: true,
                cachedAt: new Date(healthCacheTime).toISOString()
            }, null, 2)
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

        const results = {
            eventsWithoutVenue: [],
            venuesMissingGeocoding: [],
            venuesMissingMasteredCity: [],
            organizersNotLinkedToUser: [],
            usersWithInvalidOrganizerId: [],
            expiredRecurringEventsStillActive: [],
            eventsInPastStillActive: [],
            summary: {
                totalIssues: 0,
                criticalCount: 0,
                warningCount: 0
            }
        };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 1. Events without venue
        context.log('Checking: Events without venue...');
        results.eventsWithoutVenue = await db.collection('events').find({
            appId,
            isActive: true,
            $or: [
                { venueId: null },
                { venueId: { $exists: false } }
            ]
        }).project({
            _id: 1,
            title: 1,
            ownerOrganizerID: 1,
            startDateTime: 1
        }).limit(limit).toArray();

        // 2. Venues missing geocoding
        context.log('Checking: Venues missing geocoding...');
        results.venuesMissingGeocoding = await db.collection('venues').find({
            appId,
            isActive: true,
            $or: [
                { geolocation: null },
                { geolocation: { $exists: false } },
                { 'geolocation.coordinates': { $size: 0 } },
                { 'geolocation.coordinates.0': 0, 'geolocation.coordinates.1': 0 }
            ]
        }).project({
            _id: 1,
            name: 1,
            city: 1,
            state: 1
        }).limit(limit).toArray();

        // 3. Venues missing masteredCityId
        context.log('Checking: Venues missing masteredCityId...');
        results.venuesMissingMasteredCity = await db.collection('venues').find({
            appId,
            isActive: true,
            $or: [
                { masteredCityId: null },
                { masteredCityId: { $exists: false } }
            ]
        }).project({
            _id: 1,
            name: 1,
            city: 1,
            state: 1
        }).limit(limit).toArray();

        // 4. Organizers not linked to a user
        context.log('Checking: Organizers not linked to user...');
        results.organizersNotLinkedToUser = await db.collection('organizers').find({
            appId,
            isActive: true,
            $or: [
                { firebaseUserId: null },
                { firebaseUserId: { $exists: false } },
                { firebaseUserId: '' }
            ]
        }).project({
            _id: 1,
            fullName: 1,
            contactEmail: 1
        }).limit(limit).toArray();

        // 5. Users with invalid organizerId (organizerId that doesn't exist)
        context.log('Checking: Users with invalid organizerId...');
        const usersWithOrganizerId = await db.collection('userlogins').find({
            appId,
            organizerId: { $exists: true, $nin: [null, ''] }
        }).project({
            _id: 1,
            firebaseUserId: 1,
            organizerId: 1,
            email: 1
        }).limit(limit * 2).toArray();

        for (const user of usersWithOrganizerId) {
            try {
                const orgExists = await db.collection('organizers').findOne({
                    _id: new ObjectId(user.organizerId)
                });
                if (!orgExists) {
                    results.usersWithInvalidOrganizerId.push({
                        firebaseUserId: user.firebaseUserId,
                        organizerId: user.organizerId,
                        email: user.email
                    });
                }
            } catch (e) {
                // Invalid ObjectId format
                results.usersWithInvalidOrganizerId.push({
                    firebaseUserId: user.firebaseUserId,
                    organizerId: user.organizerId,
                    email: user.email,
                    error: 'Invalid ObjectId format'
                });
            }
            if (results.usersWithInvalidOrganizerId.length >= limit) break;
        }

        // 6. Expired recurring events still active
        context.log('Checking: Expired recurring events still active...');
        results.expiredRecurringEventsStillActive = await db.collection('events').find({
            appId,
            isActive: true,
            isRecurring: true,
            rruleEndDate: { $lt: today }
        }).project({
            _id: 1,
            title: 1,
            rruleEndDate: 1,
            ownerOrganizerID: 1
        }).limit(limit).toArray();

        // 7. Past events still active (non-recurring)
        context.log('Checking: Past events still active...');
        results.eventsInPastStillActive = await db.collection('events').find({
            appId,
            isActive: true,
            isRecurring: { $ne: true },
            startDateTime: { $lt: today }
        }).project({
            _id: 1,
            title: 1,
            startDateTime: 1,
            ownerOrganizerID: 1
        }).limit(limit).toArray();

        // Calculate summary
        results.summary.totalIssues =
            results.eventsWithoutVenue.length +
            results.venuesMissingGeocoding.length +
            results.venuesMissingMasteredCity.length +
            results.organizersNotLinkedToUser.length +
            results.usersWithInvalidOrganizerId.length +
            results.expiredRecurringEventsStillActive.length +
            results.eventsInPastStillActive.length;

        // Critical: data integrity issues
        results.summary.criticalCount =
            results.usersWithInvalidOrganizerId.length +
            results.eventsWithoutVenue.length;

        // Warning: data quality issues
        results.summary.warningCount =
            results.summary.totalIssues - results.summary.criticalCount;

        // Update cache
        healthCache = results;
        healthCacheTime = now;

        const duration = Date.now() - startTime;
        context.log(`Admin_DataHealth: Completed in ${duration}ms, found ${results.summary.totalIssues} issues`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...results,
                cached: false,
                generatedAt: new Date().toISOString(),
                durationMs: duration
            }, null, 2)
        };

    } catch (error) {
        context.error(`Admin_DataHealth error: ${error.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error.message })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

// Register endpoint - anonymous for local dev, protected by Azure AD in production
app.http('Admin_DataHealth', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'ops/data-health',
    handler: dataHealthHandler
});
