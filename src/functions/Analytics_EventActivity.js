// src/functions/Analytics_EventActivity.js
// Domain: Analytics - Event activity audit trail

const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { COLLECTION_NAME } = require('../utils/activityLog');

/**
 * Event Activity Analytics - Audit trail for event CRUD operations
 *
 * @route GET /api/analytics/event-activity
 * @auth function (requires function key)
 *
 * Query Parameters:
 * - appId: Filter by application ID (default: all)
 * - action: Filter by action type ("CREATE", "UPDATE", "DELETE")
 * - roleName: Filter by role (e.g., "RegionalAdmin", "RegionalOrganizer")
 * - firebaseUserId: Filter by specific user
 * - eventId: Filter by specific event
 * - range: Time range (default: "7D")
 *     Format: {number}{unit} where unit is H|D|W|M|Yr, or "All"
 * - limit: Results per page (default: 100, max: 1000)
 * - page: Page number (default: 1)
 * - sort: Sort order ("desc" or "asc", default: "desc")
 *
 * @returns {Object} Paginated activity log with summary stats
 */
async function eventActivityAnalyticsHandler(request, context) {
    context.log('Analytics_EventActivity: Request received');

    let mongoClient;

    try {
        // Parse query parameters
        const url = new URL(request.url);
        const appId = url.searchParams.get('appId');
        const action = url.searchParams.get('action')?.toUpperCase();
        const roleName = url.searchParams.get('roleName');
        const firebaseUserId = url.searchParams.get('firebaseUserId');
        const eventIdParam = url.searchParams.get('eventId');
        const rangeParam = (url.searchParams.get('range') || '7D').toUpperCase();
        const limitParam = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 1000);
        const pageParam = parseInt(url.searchParams.get('page') || '1', 10);
        const sortOrder = url.searchParams.get('sort') === 'asc' ? 1 : -1;

        // Build filter
        const filter = {};

        if (appId) filter.appId = appId;
        if (action) filter.action = action;
        if (roleName) filter.roleName = roleName;
        if (firebaseUserId) filter.firebaseUserId = firebaseUserId;
        if (eventIdParam) {
            try {
                filter.eventId = new ObjectId(eventIdParam);
            } catch {
                filter.eventId = eventIdParam;
            }
        }

        // Calculate time filter
        let cutoffDate = null;
        let timeFilterLabel = 'All Time';

        if (rangeParam !== 'ALL') {
            const match = rangeParam.match(/^(\d+)(H|D|W|M|YR)$/i);

            if (match) {
                const num = parseInt(match[1], 10);
                const unit = match[2].toUpperCase();

                switch (unit) {
                    case 'H':
                        cutoffDate = new Date(Date.now() - num * 60 * 60 * 1000);
                        timeFilterLabel = `Last ${num} Hour${num > 1 ? 's' : ''}`;
                        break;
                    case 'D':
                        cutoffDate = new Date(Date.now() - num * 24 * 60 * 60 * 1000);
                        timeFilterLabel = `Last ${num} Day${num > 1 ? 's' : ''}`;
                        break;
                    case 'W':
                        cutoffDate = new Date(Date.now() - num * 7 * 24 * 60 * 60 * 1000);
                        timeFilterLabel = `Last ${num} Week${num > 1 ? 's' : ''}`;
                        break;
                    case 'M':
                        cutoffDate = new Date();
                        cutoffDate.setMonth(cutoffDate.getMonth() - num);
                        timeFilterLabel = `Last ${num} Month${num > 1 ? 's' : ''}`;
                        break;
                    case 'YR':
                        cutoffDate = new Date();
                        cutoffDate.setFullYear(cutoffDate.getFullYear() - num);
                        timeFilterLabel = `Last ${num} Year${num > 1 ? 's' : ''}`;
                        break;
                }
            }
        }

        if (cutoffDate) {
            filter.timestamp = { $gte: cutoffDate };
        }

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection(COLLECTION_NAME);

        // Get total count
        const total = await collection.countDocuments(filter);

        // Get paginated results
        const skip = (pageParam - 1) * limitParam;
        const activities = await collection
            .find(filter)
            .sort({ timestamp: sortOrder })
            .skip(skip)
            .limit(limitParam)
            .toArray();

        // Get summary stats
        const summaryPipeline = [
            { $match: filter },
            {
                $group: {
                    _id: null,
                    totalActivities: { $sum: 1 },
                    creates: { $sum: { $cond: [{ $eq: ['$action', 'CREATE'] }, 1, 0] } },
                    updates: { $sum: { $cond: [{ $eq: ['$action', 'UPDATE'] }, 1, 0] } },
                    deletes: { $sum: { $cond: [{ $eq: ['$action', 'DELETE'] }, 1, 0] } },
                    uniqueUsers: { $addToSet: '$firebaseUserId' },
                    uniqueEvents: { $addToSet: '$eventId' }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalActivities: 1,
                    creates: 1,
                    updates: 1,
                    deletes: 1,
                    uniqueUserCount: { $size: '$uniqueUsers' },
                    uniqueEventCount: { $size: '$uniqueEvents' }
                }
            }
        ];

        const summaryResult = await collection.aggregate(summaryPipeline).toArray();
        const summary = summaryResult[0] || {
            totalActivities: 0,
            creates: 0,
            updates: 0,
            deletes: 0,
            uniqueUserCount: 0,
            uniqueEventCount: 0
        };

        // Get breakdown by role
        const roleBreakdown = await collection.aggregate([
            { $match: filter },
            { $group: { _id: '$roleName', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray();

        // Get breakdown by appId
        const appBreakdown = await collection.aggregate([
            { $match: filter },
            { $group: { _id: '$appId', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray();

        context.log(`Analytics_EventActivity: Returning ${activities.length} of ${total} activities`);

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=60'
            },
            body: JSON.stringify({
                success: true,
                data: {
                    activities: activities,
                    pagination: {
                        total: total,
                        page: pageParam,
                        limit: limitParam,
                        pages: Math.ceil(total / limitParam)
                    },
                    summary: summary,
                    breakdowns: {
                        byRole: roleBreakdown.reduce((acc, r) => {
                            acc[r._id || 'unknown'] = r.count;
                            return acc;
                        }, {}),
                        byApp: appBreakdown.reduce((acc, a) => {
                            acc[a._id || 'unknown'] = a.count;
                            return acc;
                        }, {})
                    },
                    filters: {
                        appId: appId || 'all',
                        action: action || 'all',
                        roleName: roleName || 'all',
                        firebaseUserId: firebaseUserId || 'all',
                        eventId: eventIdParam || 'all',
                        range: rangeParam,
                        timeFilter: timeFilterLabel,
                        cutoffDate: cutoffDate?.toISOString() || null
                    }
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

// Register function with function-level auth (requires key)
app.http('Analytics_EventActivity', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'analytics/event-activity',
    handler: standardMiddleware(eventActivityAnalyticsHandler)
});
