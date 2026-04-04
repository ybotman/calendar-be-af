// src/functions/Outreach_Track.js
// Domain: Outreach Onboarding - Log funnel events to outreach_tracking collection
// CALBEAF-95
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

const VALID_EVENTS = [
    'link_clicked',
    'auth_completed',
    'form_opened',
    'application_submitted',
    'onboarding_complete'
];

/**
 * POST /api/outreach/track
 * Log a funnel event to the outreach_tracking collection.
 * Called by frontend (no auth required; token provides context).
 *
 * @auth None
 *
 * @body {string} token - The outreach token (required)
 * @body {string} event - Event type (required, one of VALID_EVENTS)
 * @body {string} firebaseUserId - Firebase UID (optional, available after auth step)
 * @body {string} timestamp - ISO timestamp (optional, defaults to now)
 */
async function outreachTrackHandler(request, context) {
    context.log('Outreach_Track: POST request received');

    if (request.method === 'OPTIONS') {
        return {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        };
    }

    let mongoClient;

    try {
        const body = await request.json();

        if (!body.token) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tracked: false, reason: 'token_required' })
            };
        }

        if (!body.event || !VALID_EVENTS.includes(body.event)) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tracked: false,
                    reason: 'invalid_event',
                    validEvents: VALID_EVENTS
                })
            };
        }

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db();

        // Look up token for campaign context
        const tokenDoc = await db.collection('outreach_tokens').findOne({ token: body.token });

        const firebaseUserId = body.firebaseUserId || null;
        const eventTimestamp = body.timestamp ? new Date(body.timestamp) : new Date();

        // Insert tracking event
        await db.collection('outreach_tracking').insertOne({
            token: body.token,
            tokenId: tokenDoc ? tokenDoc._id : null,
            campaignId: tokenDoc ? tokenDoc.campaignId : null,
            appId: tokenDoc ? tokenDoc.appId : null,
            event: body.event,
            firebaseUserId,
            organizerId: null,
            timestamp: eventTimestamp,
            metadata: {
                userAgent: request.headers.get('user-agent') || null
            }
        });

        // Mark token used on application_submitted
        if (body.event === 'application_submitted' && tokenDoc && tokenDoc.status === 'active') {
            await db.collection('outreach_tokens').updateOne(
                { token: body.token },
                {
                    $set: {
                        status: 'used',
                        usedAt: new Date(),
                        usedByFirebaseUserId: firebaseUserId
                    }
                }
            );

            // Update organizer onboardingStatus if Firebase UID available
            if (firebaseUserId) {
                await db.collection('organizers').updateOne(
                    { firebaseUserId, appId: tokenDoc.appId },
                    {
                        $set: {
                            onboardingStatus: 'applied',
                            onboardingSource: 'outreach',
                            outreachTokenId: tokenDoc._id
                        }
                    }
                );
            }
        }

        // Update organizer to active on onboarding_complete
        if (body.event === 'onboarding_complete' && tokenDoc && firebaseUserId) {
            await db.collection('organizers').updateOne(
                { firebaseUserId, appId: tokenDoc.appId },
                { $set: { onboardingStatus: 'active' } }
            );
        }

        context.log(`[OUTREACH TRACK] event="${body.event}" token="${body.token.substring(0, 8)}..."`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracked: true })
        };

    } catch (error) {
        context.log(`Outreach_Track error: ${error.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracked: false, reason: 'server_error' })
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
