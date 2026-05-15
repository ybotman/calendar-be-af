const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * Session Geo Analytics
 *
 * @description Paginated passthrough of sessiongeoanalytics records.
 * No server-side aggregation — CalOps aggregates client-side.
 * Populated by visitor/track POST after FE cascade resolves (CALBEAF-194).
 *
 * @route GET /api/analytics/session-geo
 * @auth function
 *
 * Query Parameters:
 * - appId: Filter by application (1=TangoTiempo, 2=HarmonyJunction) — required
 * - from: ISO date string, inclusive lower bound on sessionDate (e.g. "2026-05-01")
 * - to: ISO date string, inclusive upper bound on sessionDate (e.g. "2026-05-31")
 * - page: Page number (default: 0)
 * - limit: Items per page (default: 100, max: 500)
 *
 * @returns Paginated sessiongeoanalytics records
 */

async function sessionGeoHandler(request, context) {
    context.log('Analytics_SessionGeo: GET request received');

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
        const url = new URL(request.url);
        const appId = url.searchParams.get('appId');
        const from  = url.searchParams.get('from') || null;
        const to    = url.searchParams.get('to')   || null;
        const page  = Math.max(0, parseInt(url.searchParams.get('page')  || '0',   10));
        const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));

        if (!appId) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ success: false, error: 'appId is required' })
            };
        }

        const query = { appId: { $in: [String(appId), Number(appId)] } };

        // sessionDate is "YYYY-MM-DD" string — lexicographic comparison is correct for ISO dates
        if (from || to) {
            query.sessionDate = {};
            if (from) query.sessionDate.$gte = from;
            if (to)   query.sessionDate.$lte = to;
        }

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) throw new Error('MongoDB connection string not configured');

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const collection = mongoClient.db().collection('sessiongeoanalytics');

        const total = await collection.countDocuments(query);
        const records = await collection
            .find(query)
            .sort({ resolvedAt: -1 })
            .skip(page * limit)
            .limit(limit)
            .toArray();

        const data = records.map(r => ({
            id:            r._id,
            visitorId:     r.visitorId,
            userId:        r.userId    || null,
            appId:         r.appId,
            sessionDate:   r.sessionDate,
            city:          r.city      || null,
            country:       r.country   || null,
            lat:           r.lat       ?? null,
            lng:           r.lng       ?? null,
            geoSource:     r.geoSource,
            confidence:    r.confidence ?? null,
            cascadeLevel:  r.cascadeLevel ?? null,
            isPrivateRelay: r.isPrivateRelay ?? false,
            resolvedAt:    r.resolvedAt,
            createdAt:     r.createdAt
        }));

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                success: true,
                data,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) },
                filters: { appId: String(appId), from, to },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        context.error('Analytics_SessionGeo error:', error);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ success: false, error: 'Internal server error', message: error.message })
        };
    } finally {
        if (mongoClient) await mongoClient.close();
    }
}

app.http('Analytics_SessionGeo', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'function',
    route: 'analytics/session-geo',
    handler: standardMiddleware(sessionGeoHandler)
});
