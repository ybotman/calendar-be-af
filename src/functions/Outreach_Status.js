// src/functions/Outreach_Status.js
// Domain: Outreach Onboarding - Query funnel metrics from outreach_tracking
// CALBEAF-95
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');

/**
 * GET /api/outreach/status
 * Query outreach funnel metrics. Used by AIDI/Dash for conversion reporting.
 *
 * @auth Firebase Bearer token (admin-level)
 *
 * @query {string} campaignId - Filter by campaign (optional)
 * @query {string} appId - Filter by appId (optional, default: all)
 * @query {string} dateFrom - Filter from date ISO string (optional)
 * @query {string} dateTo - Filter to date ISO string (optional)
 *
 * @returns {object} { funnel: { links_generated, clicks, signups_started, submitted, approved, rejected }, byOrg: [...] }
 */
async function outreachStatusHandler(request, context) {
    context.log('Outreach_Status: GET request received');

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

    // Require Firebase auth
    const user = await firebaseAuth(request, context);
    if (!user) {
        return unauthorizedResponse();
    }

    let mongoClient;

    try {
        const campaignId = request.query.get('campaignId');
        const appId = request.query.get('appId');
        const dateFrom = request.query.get('dateFrom');
        const dateTo = request.query.get('dateTo');

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db();

        // Build query filter for tracking events
        const trackingFilter = {};
        if (campaignId) trackingFilter.campaignId = campaignId;
        if (appId) trackingFilter.appId = appId;
        if (dateFrom || dateTo) {
            trackingFilter.timestamp = {};
            if (dateFrom) trackingFilter.timestamp.$gte = new Date(dateFrom);
            if (dateTo) trackingFilter.timestamp.$lte = new Date(dateTo);
        }

        // Build query filter for tokens (links_generated count)
        const tokenFilter = {};
        if (campaignId) tokenFilter.campaignId = campaignId;
        if (appId) tokenFilter.appId = appId;
        if (dateFrom || dateTo) {
            tokenFilter.createdAt = {};
            if (dateFrom) tokenFilter.createdAt.$gte = new Date(dateFrom);
            if (dateTo) tokenFilter.createdAt.$lte = new Date(dateTo);
        }

        // Get funnel counts in parallel
        const [linksGenerated, eventCounts, byOrg] = await Promise.all([
            // Count tokens generated
            db.collection('outreach_tokens').countDocuments(tokenFilter),

            // Aggregate event counts by type
            db.collection('outreach_tracking').aggregate([
                { $match: trackingFilter },
                { $group: { _id: '$event', count: { $sum: 1 } } }
            ]).toArray(),

            // Aggregate by org
            db.collection('outreach_tracking').aggregate([
                { $match: trackingFilter },
                {
                    $group: {
                        _id: { orgName: '$orgName', token: '$token' },
                        events: { $push: '$event' },
                        lastEvent: { $max: '$timestamp' },
                        campaignId: { $first: '$campaignId' }
                    }
                },
                { $sort: { lastEvent: -1 } },
                { $limit: 100 }
            ]).toArray()
        ]);

        // Build funnel object from event counts
        const eventCountMap = {};
        eventCounts.forEach(e => { eventCountMap[e._id] = e.count; });

        const funnel = {
            links_generated: linksGenerated,
            clicks: eventCountMap.link_click || 0,
            signups_started: eventCountMap.signup_started || 0,
            submitted: eventCountMap.form_submitted || 0,
            approved: eventCountMap.approved || 0,
            rejected: eventCountMap.rejected || 0
        };

        // Format byOrg results
        const byOrgFormatted = byOrg.map(item => ({
            orgName: item._id.orgName,
            token: item._id.token,
            campaignId: item.campaignId,
            events: item.events,
            lastEvent: item.lastEvent
        }));

        context.log(`[OUTREACH STATUS] campaign="${campaignId || 'all'}" links=${funnel.links_generated} clicks=${funnel.clicks} submitted=${funnel.submitted}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                funnel,
                byOrg: byOrgFormatted
            })
        };

    } catch (error) {
        context.log(`Outreach_Status error: ${error.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ServerError',
                message: 'Failed to retrieve outreach status',
                timestamp: new Date().toISOString()
            })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Outreach_Status', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'outreach/status',
    handler: standardMiddleware(outreachStatusHandler)
});
