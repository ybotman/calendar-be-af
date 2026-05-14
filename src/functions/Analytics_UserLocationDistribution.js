const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * User Location Distribution Analytics
 *
 * @description Aggregates lastKnownLocation across user profiles to show where
 * users are physically located (CF edge data). Used by Dash for geographic
 * audience insights. Distinct from MapCenterHistory which tracks what users VIEW.
 *
 * @route GET /api/analytics/user-location-distribution
 * @auth anonymous
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - from: ISO date string — filter by lastKnownLocation.updatedAt >= from
 * - to:   ISO date string — filter by lastKnownLocation.updatedAt <= to
 *
 * @returns {Array<{city, country, count}>} sorted descending by count
 *
 * @example
 * GET /api/analytics/user-location-distribution?appId=1
 * GET /api/analytics/user-location-distribution?appId=1&from=2026-01-01&to=2026-12-31
 */
async function userLocationDistributionHandler(request, context) {
    context.log('Analytics_UserLocationDistribution: GET request received');

    if (request.method === 'OPTIONS') {
        return {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        };
    }

    const appId = request.query.get('appId') || '1';
    const fromParam = request.query.get('from');
    const toParam = request.query.get('to');

    const matchStage = { appId, 'lastKnownLocation': { $exists: true, $ne: null } };

    if (fromParam || toParam) {
        matchStage['lastKnownLocation.updatedAt'] = {};
        if (fromParam) {
            const from = new Date(fromParam);
            if (!isNaN(from)) matchStage['lastKnownLocation.updatedAt'].$gte = from;
        }
        if (toParam) {
            const to = new Date(toParam);
            if (!isNaN(to)) matchStage['lastKnownLocation.updatedAt'].$lte = to;
        }
        if (!Object.keys(matchStage['lastKnownLocation.updatedAt']).length) {
            delete matchStage['lastKnownLocation.updatedAt'];
        }
    }

    let mongoClient;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) throw new Error('MongoDB connection string not configured');

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const userLoginsCollection = db.collection('userlogins');

        const distribution = await userLoginsCollection.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: {
                        city: '$lastKnownLocation.city',
                        country: '$lastKnownLocation.country'
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    city: '$_id.city',
                    country: '$_id.country',
                    count: 1
                }
            },
            { $sort: { count: -1 } }
        ]).toArray();

        context.log(`UserLocationDistribution: ${distribution.length} city/country buckets for appId=${appId}`);

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                data: distribution,
                meta: { appId, from: fromParam || null, to: toParam || null, count: distribution.length },
                timestamp: new Date().toISOString()
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Analytics_UserLocationDistribution', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'analytics/user-location-distribution',
    handler: standardMiddleware(userLocationDistributionHandler)
});
