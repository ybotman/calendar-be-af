// src/functions/Outreach_ResolveToken.js
// Domain: Outreach Onboarding - Resolve token and return pre-fill data
// CALBEAF-95
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { getFirestore } = require('../lib/firebase-admin');

/**
 * GET /api/outreach/resolve-token?token=abc123
 * Validate an outreach token and return pre-fill data for the application form.
 * Called by Sarah's frontend when organizer lands on the apply page with a token.
 *
 * @auth None (token IS the auth)
 *
 * @param {string} token - Query param, the opaque outreach token
 *
 * @returns {object} Pre-fill data or error with { valid: false, reason }
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
        const url = new URL(request.url);
        const token = url.searchParams.get('token');

        if (!token) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    valid: false,
                    reason: 'token_required'
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
                    valid: false,
                    reason: 'token_not_found'
                })
            };
        }

        // Check if expired
        if (tokenDoc.expiresAt && new Date() > new Date(tokenDoc.expiresAt)) {
            return {
                status: 410,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    valid: false,
                    reason: 'token_expired',
                    expiredAt: tokenDoc.expiresAt
                })
            };
        }

        // Check if already used for submission
        if (tokenDoc.status === 'used') {
            return {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    valid: false,
                    reason: 'token_already_used',
                    usedAt: tokenDoc.usedAt
                })
            };
        }

        // Log the resolve event to outreach_tracking
        await db.collection('outreach_tracking').insertOne({
            token,
            tokenId: tokenDoc._id,
            campaignId: tokenDoc.campaignId,
            appId: tokenDoc.appId,
            event: 'link_clicked',
            timestamp: new Date(),
            metadata: {
                userAgent: request.headers.get('user-agent') || null
            }
        });

        context.log(`[OUTREACH TOKEN RESOLVED] org="${tokenDoc.orgName}" campaign="${tokenDoc.campaignId}"`);

        // Enrich prefill from Firestore discoveredOrganizers (campaign workspace)
        // Token data takes priority; Firestore fills gaps
        let firestoreData = {};
        const discoveredOrgId = tokenDoc.discoveredOrganizerId;
        if (discoveredOrgId) {
            try {
                const firestore = getFirestore();
                const orgDoc = await firestore
                    .collection('discoveredOrganizers')
                    .doc(discoveredOrgId)
                    .get();
                if (orgDoc.exists) {
                    firestoreData = orgDoc.data();
                    context.log(`[OUTREACH] Enriched from Firestore discoveredOrganizer: ${discoveredOrgId}`);
                }
            } catch (fsErr) {
                // Firestore enrichment is best-effort; don't fail the resolve
                context.log(`[OUTREACH] Firestore lookup failed (non-blocking): ${fsErr.message}`);
            }
        }

        // Merge: token fields > tokenDoc.prefillData > firestoreData
        const prefillData = tokenDoc.prefillData || {};
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                valid: true,
                used: false,
                expiresAt: tokenDoc.expiresAt,
                prefill: {
                    orgName: tokenDoc.orgName || prefillData.orgName || firestoreData.name || null,
                    shortName: tokenDoc.shortName || prefillData.shortName || firestoreData.shortName || null,
                    contactName: tokenDoc.contactName || prefillData.contactName || null,
                    contactEmail: tokenDoc.contactEmail || prefillData.contactEmail || firestoreData.email || null,
                    organizerType: tokenDoc.organizerType || prefillData.organizerType || firestoreData.hostType || null,
                    region: tokenDoc.region || prefillData.region || firestoreData.state || null,
                    regionId: tokenDoc.regionId || prefillData.regionId || null,
                    city: tokenDoc.city || prefillData.city || firestoreData.city || null,
                    website: tokenDoc.website || prefillData.website || firestoreData.website || null,
                    facebookUrl: tokenDoc.facebookUrl || prefillData.facebookUrl || firestoreData.fbProfileUrl || null,
                    sampleEventTitles: tokenDoc.sampleEventTitles || prefillData.sampleEventTitles || firestoreData.sampleEventTitles || null
                },
                metadata: {
                    campaignId: tokenDoc.campaignId || null,
                    source: tokenDoc.source || null,
                    sourceDetail: tokenDoc.sourceDetail || prefillData.sourceDetail || null,
                    discoveredOrganizerId: discoveredOrgId || null
                }
            })
        };

    } catch (error) {
        context.log(`Outreach_ResolveToken error: ${error.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                valid: false,
                reason: 'server_error'
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
    route: 'outreach/resolve-token',
    handler: standardMiddleware(outreachResolveTokenHandler)
});
