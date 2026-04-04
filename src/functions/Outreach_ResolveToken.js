// src/functions/Outreach_ResolveToken.js
// Domain: Outreach Onboarding - Resolve token and return pre-fill data
// CALBEAF-95
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * GET /api/outreach/resolve/{token}
 * Validate an outreach token and return pre-fill data for the application form.
 * Called by Sarah's frontend when organizer lands on the apply page with a token.
 *
 * @auth None (token IS the auth)
 *
 * @param {string} token - URL param, the opaque outreach token
 *
 * @returns {object} Pre-fill data or error (TOKEN_EXPIRED, TOKEN_USED, TOKEN_INVALID)
 */
async function outreachResolveTokenHandler(request, context) {
    context.log('Outreach_ResolveToken: GET request received');

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

    let mongoClient;

    try {
        const token = request.params.token;

        if (!token) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'Token parameter is required',
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

        // Look up token
        const tokenDoc = await db.collection('outreach_tokens').findOne({ token });

        if (!tokenDoc) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'TOKEN_INVALID',
                    message: 'This link is not valid.',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Check if expired
        if (tokenDoc.expiresAt && new Date() > new Date(tokenDoc.expiresAt)) {
            return {
                status: 410,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'TOKEN_EXPIRED',
                    message: 'This link has expired. Please contact the organizer for a new link.',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Check if already used for submission
        if (tokenDoc.status === 'used') {
            return {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'TOKEN_USED',
                    message: 'This application has already been submitted.',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Log the click event to outreach_tracking
        await db.collection('outreach_tracking').insertOne({
            token,
            campaignId: tokenDoc.campaignId,
            orgName: tokenDoc.orgName,
            appId: tokenDoc.appId,
            event: 'link_click',
            timestamp: new Date(),
            metadata: {
                userAgent: request.headers.get('user-agent') || null
            }
        });

        context.log(`[OUTREACH TOKEN RESOLVED] org="${tokenDoc.orgName}" campaign="${tokenDoc.campaignId}"`);

        // Return pre-fill data
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: {
                    orgName: tokenDoc.orgName,
                    contactEmail: tokenDoc.contactEmail,
                    contactName: tokenDoc.contactName,
                    appId: tokenDoc.appId,
                    campaignId: tokenDoc.campaignId,
                    regionId: tokenDoc.regionId,
                    divisionId: tokenDoc.divisionId,
                    cityId: tokenDoc.cityId,
                    prefillData: tokenDoc.prefillData,
                    tokenStatus: 'active'
                }
            })
        };

    } catch (error) {
        context.log(`Outreach_ResolveToken error: ${error.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ServerError',
                message: 'Failed to resolve outreach token',
                timestamp: new Date().toISOString()
            })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Outreach_ResolveToken', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'outreach/resolve/{token}',
    handler: standardMiddleware(outreachResolveTokenHandler)
});
