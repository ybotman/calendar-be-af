// src/functions/Outreach_Status.js
// Domain: Outreach Onboarding - Query funnel metrics from outreach_tracking
// CALBEAF-95
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { apiKeyAuth, apiKeyUnauthorizedResponse } = require('../middleware/apiKeyAuth');

/**
 * GET /api/outreach/status?campaignId=...
 * Query outreach funnel metrics. Used by AIDI/Dash for conversion reporting.
 *
 * @auth X-Service-Key header (service-to-service)
 *
 * @query {string} campaignId - Filter by campaign (optional)
 * @query {string} appId - Filter by appId (optional)
 * @query {string} dateFrom - Filter from date ISO string (optional)
 * @query {string} dateTo - Filter to date ISO string (optional)
 *
 * @returns {object} { campaignId, funnel: { links_generated, links_clicked,
 *   auth_completed, forms_opened, applications_submitted, onboarding_complete },
 *   tokens: [{ tokenId, orgName, status, events, completedAt }] }
 */
async function outreachStatusHandler(request, context) {
    context.log('Outreach_Status: GET request received');

    if (request.method === 'OPTIONS') {
        return {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, x-api-key'
            }
        };
    }

    // Require service API key
    if (!apiKeyAuth(request, context)) {
        return apiKeyUnauthorizedResponse();
    }

    let mongoClient;

    try {
        const url = new URL(request.url);
        const campaignId = url.searchParams.get('campaignId');
        const appId = url.searchParams.get('appId') ? parseInt(url.searchParams.get('appId')) : null;
        const dateFrom = url.searchParams.get('dateFrom');
        const dateTo = url.searchParams.get('dateTo');

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db();

        // Build query filters
        const trackingFilter = {};
        if (campaignId) trackingFilter.campaignId = campaignId;
        if (appId) trackingFilter.appId = appId;
        if (dateFrom || dateTo) {
            trackingFilter.timestamp = {};
            if (dateFrom) trackingFilter.timestamp.$gte = new Date(dateFrom);
            if (dateTo) trackingFilter.timestamp.$lte = new Date(dateTo);
        }

        const tokenFilter = {};
        if (campaignId) tokenFilter.campaignId = campaignId;
        if (appId) tokenFilter.appId = appId;
        if (dateFrom || dateTo) {
            tokenFilter.createdAt = {};
            if (dateFrom) tokenFilter.createdAt.$gte = new Date(dateFrom);
            if (dateTo) tokenFilter.createdAt.$lte = new Date(dateTo);
        }

        // Get funnel counts and token list in parallel
        const [linksGenerated, eventCounts, tokenDocs] = await Promise.all([
            db.collection('outreach_tokens').countDocuments(tokenFilter),

            db.collection('outreach_tracking').aggregate([
                { $match: trackingFilter },
                { $group: { _id: '$event', count: { $sum: 1 } } }
            ]).toArray(),

            // Per-token summary: join tokens with their tracking events
            db.collection('outreach_tokens').aggregate([
                { $match: tokenFilter },
                {
                    $lookup: {
                        from: 'outreach_tracking',
                        localField: '_id',
                        foreignField: 'tokenId',
                        as: 'trackingEvents'
                    }
                },
                { $sort: { createdAt: -1 } },
                { $limit: 200 }
            ]).toArray()
        ]);

        // Build funnel using canonical event names
        const eventCountMap = {};
        eventCounts.forEach(e => { eventCountMap[e._id] = e.count; });

        const funnel = {
            links_generated: linksGenerated,
            links_clicked: eventCountMap.link_clicked || 0,
            auth_completed: eventCountMap.auth_completed || 0,
            forms_opened: eventCountMap.form_opened || 0,
            applications_submitted: eventCountMap.application_submitted || 0,
            onboarding_complete: eventCountMap.onboarding_complete || 0
        };

        // Format per-token results
        const tokens = tokenDocs.map(t => {
            const events = t.trackingEvents.map(e => e.event);
            const completedEvent = t.trackingEvents.find(e => e.event === 'onboarding_complete');
            return {
                tokenId: t._id.toString(),
                orgName: t.orgName,
                status: t.status,
                events,
                completedAt: completedEvent ? completedEvent.timestamp : null
            };
        });

        context.log(`[OUTREACH STATUS] campaign="${campaignId || 'all'}" links=${linksGenerated} clicked=${funnel.links_clicked} submitted=${funnel.applications_submitted}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                campaignId: campaignId || null,
                funnel,
                tokens
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
