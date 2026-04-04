// src/functions/Outreach_GenerateLink.js
// Domain: Outreach Onboarding - Generate opaque token link for organizer applications
// CALBEAF-95
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const { standardMiddleware } = require('../middleware');
const { apiKeyAuth, apiKeyUnauthorizedResponse } = require('../middleware/apiKeyAuth');

/**
 * POST /api/outreach/generate-link
 * Generate an opaque token for organizer outreach onboarding.
 * Called by AIDI with org metadata; returns a full URL with token.
 *
 * @auth x-api-key (service-to-service)
 *
 * @body {string} orgName - Organization name (required)
 * @body {string} appId - Application ID (default: "1")
 * @body {string} contactEmail - Contact email for pre-fill
 * @body {string} contactName - Contact name for pre-fill
 * @body {string} campaignId - Campaign identifier for tracking
 * @body {string} source - Source identifier (e.g. "email_outreach")
 * @body {string} regionId - Mastered region ID for pre-fill
 * @body {string} divisionId - Mastered division ID for pre-fill
 * @body {string} cityId - Mastered city ID for pre-fill
 * @body {object} prefillData - Additional pre-fill fields
 * @body {number} expiryDays - Token expiry in days (default: 30, max: 90)
 *
 * @returns {object} { success, token, url, expiresAt }
 */
async function outreachGenerateLinkHandler(request, context) {
    context.log('Outreach_GenerateLink: POST request received');

    if (request.method === 'OPTIONS') {
        return {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, x-api-key'
            }
        };
    }

    // Validate API key
    if (!apiKeyAuth(request, context)) {
        return apiKeyUnauthorizedResponse();
    }

    let mongoClient;

    try {
        const body = await request.json();

        // Validate required fields
        if (!body.orgName) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'orgName is required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        const appId = body.appId || '1';
        const expiryDays = Math.min(90, Math.max(1, parseInt(body.expiryDays) || 30));

        // Generate opaque token
        const token = crypto.randomBytes(32).toString('hex');
        const now = new Date();
        const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db();

        // Store token with metadata
        const tokenDoc = {
            token,
            orgName: body.orgName,
            contactEmail: body.contactEmail || null,
            contactName: body.contactName || null,
            appId,
            campaignId: body.campaignId || null,
            source: body.source || 'unknown',
            regionId: body.regionId || null,
            divisionId: body.divisionId || null,
            cityId: body.cityId || null,
            prefillData: body.prefillData || {},
            status: 'active',
            createdAt: now,
            expiresAt,
            usedAt: null,
            usedByFirebaseUid: null
        };

        await db.collection('outreach_tokens').insertOne(tokenDoc);

        // Ensure indexes exist (idempotent)
        await db.collection('outreach_tokens').createIndex({ token: 1 }, { unique: true });
        await db.collection('outreach_tokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

        // Build the full URL
        const baseUrl = appId === '2'
            ? 'https://harmonyjunction.org'
            : 'https://tangotiempo.com';
        const url = `${baseUrl}/organizers/apply?ref=outreach&orgToken=${token}`;

        context.log(`[OUTREACH TOKEN GENERATED] org="${body.orgName}" campaign="${body.campaignId}" expires=${expiresAt.toISOString()}`);

        return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                token,
                url,
                expiresAt: expiresAt.toISOString()
            })
        };

    } catch (error) {
        context.log(`Outreach_GenerateLink error: ${error.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ServerError',
                message: 'Failed to generate outreach link',
                timestamp: new Date().toISOString()
            })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Outreach_GenerateLink', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'outreach/generate-link',
    handler: standardMiddleware(outreachGenerateLinkHandler)
});
