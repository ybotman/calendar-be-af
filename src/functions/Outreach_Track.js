// src/functions/Outreach_Track.js
// Domain: Outreach Onboarding - Log funnel events to outreach_tracking collection
// CALBEAF-95
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { apiKeyAuth, apiKeyUnauthorizedResponse } = require('../middleware/apiKeyAuth');
const { firebaseAuth } = require('../middleware/firebaseAuth');

const VALID_EVENTS = [
    'link_click',
    'signup_started',
    'form_submitted',
    'approved',
    'rejected'
];

/**
 * POST /api/outreach/track
 * Log a funnel event to the outreach_tracking collection.
 * Called by frontend (Firebase auth) or services (API key).
 *
 * @auth x-api-key OR Firebase Bearer token
 *
 * @body {string} token - The outreach token (required)
 * @body {string} event - Event type (required, one of VALID_EVENTS)
 * @body {object} metadata - Additional event metadata (optional)
 */
async function outreachTrackHandler(request, context) {
    context.log('Outreach_Track: POST request received');

    if (request.method === 'OPTIONS') {
        return {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key'
            }
        };
    }

    // Auth: accept either API key OR Firebase token
    const hasApiKey = apiKeyAuth(request, context);
    let firebaseUid = null;

    if (!hasApiKey) {
        const user = await firebaseAuth(request, context);
        if (!user) {
            return apiKeyUnauthorizedResponse();
        }
        firebaseUid = user.uid;
    }

    let mongoClient;

    try {
        const body = await request.json();

        // Validate required fields
        if (!body.token) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'token is required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        if (!body.event || !VALID_EVENTS.includes(body.event)) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: `event must be one of: ${VALID_EVENTS.join(', ')}`,
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

        // Look up token for campaign context
        const tokenDoc = await db.collection('outreach_tokens').findOne({ token: body.token });

        // Insert tracking event
        const trackingEvent = {
            token: body.token,
            campaignId: tokenDoc ? tokenDoc.campaignId : null,
            orgName: tokenDoc ? tokenDoc.orgName : null,
            appId: tokenDoc ? tokenDoc.appId : null,
            event: body.event,
            timestamp: new Date(),
            metadata: {
                ...(body.metadata || {}),
                firebaseUid,
                userAgent: request.headers.get('user-agent') || null
            }
        };

        await db.collection('outreach_tracking').insertOne(trackingEvent);

        // If form_submitted, mark the token as used and update organizer
        if (body.event === 'form_submitted' && tokenDoc && tokenDoc.status === 'active') {
            await db.collection('outreach_tokens').updateOne(
                { token: body.token },
                {
                    $set: {
                        status: 'used',
                        usedAt: new Date(),
                        usedByFirebaseUid: firebaseUid
                    }
                }
            );

            // Update organizer onboardingStatus if we can find one linked to this token
            if (firebaseUid) {
                await db.collection('organizers').updateOne(
                    { firebaseUserId: firebaseUid, appId: tokenDoc.appId },
                    {
                        $set: {
                            onboardingStatus: 'submitted',
                            onboardingToken: body.token,
                            onboardingCompletedAt: new Date(),
                            outreachCampaignId: tokenDoc.campaignId
                        }
                    }
                );
            }
        }

        // If approved/rejected, update organizer onboardingStatus
        if ((body.event === 'approved' || body.event === 'rejected') && tokenDoc) {
            await db.collection('organizers').updateOne(
                { onboardingToken: body.token, appId: tokenDoc.appId },
                {
                    $set: {
                        onboardingStatus: body.event,
                        updatedAt: new Date()
                    }
                }
            );
        }

        context.log(`[OUTREACH TRACK] event="${body.event}" token="${body.token.substring(0, 8)}..."`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true })
        };

    } catch (error) {
        context.log(`Outreach_Track error: ${error.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ServerError',
                message: 'Failed to track outreach event',
                timestamp: new Date().toISOString()
            })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Outreach_Track', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'outreach/track',
    handler: standardMiddleware(outreachTrackHandler)
});
