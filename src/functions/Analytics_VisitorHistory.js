const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * Visitor History Analytics
 *
 * @description Returns paginated list of anonymous visitor events from VisitorTrackingHistory
 * Supports filtering by date range and appId
 *
 * @route GET /api/analytics/visitor-history
 * @auth anonymous
 *
 * Query Parameters:
 * - page: Page number (default: 0)
 * - limit: Items per page (default: 50, max: 200)
 * - range: Time range - {number}{unit} where unit is H|D|W|M|Yr, or "All" (default: "7D")
 * - appId: Filter by application (1=TangoTiempo, 2=HarmonyJunction, null for old records)
 * - deviceType: Filter by device (mobile, tablet, desktop)
 *
 * @returns {VisitorHistoryResponse} Paginated visitor history
 *
 * @example
 * GET /api/analytics/visitor-history?range=7D&page=0&limit=50
 * GET /api/analytics/visitor-history?range=1M&appId=1
 * GET /api/analytics/visitor-history?range=All&deviceType=mobile
 */

// Helper: Parse range string to date
function parseRange(range) {
    if (!range || range === 'All') return null;

    const match = range.match(/^(\d+)(H|D|W|M|Yr)$/i);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2].toUpperCase();

    const now = new Date();
    switch (unit) {
        case 'H':
            return new Date(now.getTime() - value * 60 * 60 * 1000);
        case 'D':
            return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
        case 'W':
            return new Date(now.getTime() - value * 7 * 24 * 60 * 60 * 1000);
        case 'M':
            return new Date(now.setMonth(now.getMonth() - value));
        case 'YR':
            return new Date(now.setFullYear(now.getFullYear() - value));
        default:
            return null;
    }
}

async function visitorHistoryHandler(request, context) {
    context.log('Analytics_VisitorHistory: GET request received');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        };
    }

    let mongoClient;

    try {
        // Parse query parameters
        const url = new URL(request.url);
        const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10));
        const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
        const range = url.searchParams.get('range') || '7D';
        const appId = url.searchParams.get('appId');
        const deviceType = url.searchParams.get('deviceType');

        // Build query
        const query = {};

        // Date range filter
        const startDate = parseRange(range);
        if (startDate) {
            query.timestamp = { $gte: startDate };
        }

        // appId filter (note: old records may have null)
        if (appId) {
            query.appId = parseInt(appId, 10);
        }

        // deviceType filter
        if (deviceType) {
            query.deviceType = deviceType;
        }

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('VisitorTrackingHistory');

        // Get total count for pagination
        const total = await collection.countDocuments(query);

        // Fetch paginated results
        const visitors = await collection
            .find(query)
            .sort({ timestamp: -1 })
            .skip(page * limit)
            .limit(limit)
            .toArray();

        // Format response
        const formattedVisitors = visitors.map(visitor => ({
            id: visitor._id,
            visitorId: visitor.visitor_id,
            appId: visitor.appId, // null for old records
            timestamp: visitor.timestamp,
            ip: visitor.ip,
            page: visitor.page,
            deviceType: visitor.deviceType,
            userAgent: visitor.userAgent,
            timezone: visitor.timezone,
            location: {
                city: visitor.ipinfo_city || null,
                region: visitor.ipinfo_region || null,
                country: visitor.ipinfo_country || null,
                latitude: visitor.google_browser_lat || visitor.google_api_lat || visitor.ipinfo_lat || null,
                longitude: visitor.google_browser_long || visitor.google_api_long || visitor.ipinfo_long || null,
                source: visitor.geoSource
            },
            dayOfWeek: visitor.dayOfWeekLocal || visitor.dayOfWeekZulu,
            hourOfDay: visitor.hourOfDayLocal ?? visitor.hourOfDayZulu
        }));

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                data: formattedVisitors,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                },
                filters: {
                    range,
                    appId: appId ? parseInt(appId, 10) : null,
                    deviceType: deviceType || null
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        context.error('Analytics_VisitorHistory error:', error);
        return {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Analytics_VisitorHistory', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'analytics/visitor-history',
    handler: standardMiddleware(visitorHistoryHandler)
});
