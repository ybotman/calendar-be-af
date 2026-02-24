const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * Map Center History Analytics
 *
 * @description Returns paginated list of map center reset events from MapCenterHistory
 * Tracks when users SET/RESET their map center location
 *
 * @route GET /api/analytics/map-center-history
 * @auth anonymous
 *
 * Query Parameters:
 * - page: Page number (default: 0)
 * - limit: Items per page (default: 50, max: 200)
 * - range: Time range - {number}{unit} where unit is H|D|W|M|Yr, or "All" (default: "7D")
 * - appId: Filter by application (1=TangoTiempo, 2=HarmonyJunction)
 * - deviceType: Filter by device (mobile, tablet, desktop)
 *
 * @returns {MapCenterHistoryResponse} Paginated map center history
 *
 * @example
 * GET /api/analytics/map-center-history?range=7D&page=0&limit=50
 * GET /api/analytics/map-center-history?range=1M&appId=1
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

async function mapCenterHistoryHandler(request, context) {
    context.log('Analytics_MapCenterHistory: GET request received');

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

        // New filters
        const geoSource = url.searchParams.get('geoSource');
        const city = url.searchParams.get('city');
        const region = url.searchParams.get('region');
        const country = url.searchParams.get('country');
        const ip = url.searchParams.get('ip');
        const firebaseUserId = url.searchParams.get('firebaseUserId');
        const startDateParam = url.searchParams.get('startDate');
        const endDateParam = url.searchParams.get('endDate');

        // Build query
        const query = {};

        // Date range filter (explicit dates take precedence over range shorthand)
        if (startDateParam || endDateParam) {
            query.timestamp = {};
            if (startDateParam) query.timestamp.$gte = new Date(startDateParam);
            if (endDateParam) query.timestamp.$lte = new Date(endDateParam);
        } else {
            const startDate = parseRange(range);
            if (startDate) {
                query.timestamp = { $gte: startDate };
            }
        }

        // appId filter
        if (appId) {
            query.appId = parseInt(appId, 10);
        }

        // deviceType filter
        if (deviceType) {
            query.deviceType = deviceType;
        }

        // Geo filters
        if (geoSource) {
            query.geoSource = geoSource;
        }
        if (city) {
            query.ipinfo_city = { $regex: city, $options: 'i' };
        }
        if (region) {
            query.ipinfo_region = { $regex: region, $options: 'i' };
        }
        if (country) {
            query.ipinfo_country = country.toUpperCase();
        }

        // Identity filters
        if (ip) {
            query.ip = ip;
        }
        if (firebaseUserId) {
            query.firebaseUserId = firebaseUserId;
        }

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('MapCenterHistory');

        // Get total count for pagination
        const total = await collection.countDocuments(query);

        // Fetch paginated results
        const mapCenters = await collection
            .find(query)
            .sort({ timestamp: -1 })
            .skip(page * limit)
            .limit(limit)
            .toArray();

        // Format response
        const formattedMapCenters = mapCenters.map(mc => ({
            id: mc._id,
            firebaseUserId: mc.firebaseUserId,
            appId: mc.appId,
            timestamp: mc.timestamp,
            ip: mc.ip,
            page: mc.page,
            mapCenter: mc.mapCenter, // { latitude, longitude }
            deviceType: mc.deviceType,
            userAgent: mc.userAgent,
            timezone: mc.timezone,
            userLocation: {
                // Best available (priority: browser > api > ipinfo)
                latitude: mc.google_browser_lat || mc.google_api_lat || mc.ipinfo_lat || null,
                longitude: mc.google_browser_long || mc.google_api_long || mc.ipinfo_long || null,
                source: mc.geoSource,
                // Raw sources
                browserGps: mc.google_browser_lat ? {
                    lat: mc.google_browser_lat,
                    long: mc.google_browser_long,
                    accuracy: mc.google_browser_accuracy || null
                } : null,
                googleApi: mc.google_api_lat ? {
                    lat: mc.google_api_lat,
                    long: mc.google_api_long
                } : null,
                ipLookup: {
                    lat: mc.ipinfo_lat || null,
                    long: mc.ipinfo_long || null,
                    city: mc.ipinfo_city || null,
                    region: mc.ipinfo_region || null,
                    country: mc.ipinfo_country || null,
                    timezone: mc.ipinfo_timezone || null,
                    postal: mc.ipinfo_postal || null
                }
            }
        }));

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                data: formattedMapCenters,
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
        context.error('Analytics_MapCenterHistory error:', error);
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

app.http('Analytics_MapCenterHistory', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'analytics/map-center-history',
    handler: standardMiddleware(mapCenterHistoryHandler)
});
