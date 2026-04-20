// src/functions/OrganizerShortnamesBulk.js
// CALBEAF-107 — GET /api/organizers/shortnames
// Per ORGANIZER-SHORTNAME-DESIGN.md §1.1.2
//
// Bulk read of all organizer shortNames for AIDI's generator cache-warm.
// API-key auth (service-to-service). 60-second in-memory cache. <500ms p95.

const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { apiKeyAuth, apiKeyUnauthorizedResponse } = require('../middleware/apiKeyAuth');

// 60-second in-memory cache keyed by appId.
// TODO: if appId=1 ever exceeds 10K organizers, add cursor pagination.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // appId -> { shortNames, generatedAt, expiresAt }

async function shortnamesBulkHandler(request, context) {
    if (!apiKeyAuth(request, context)) {
        return apiKeyUnauthorizedResponse();
    }

    const appId = request.query.get('appId');
    if (!appId) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ValidationError',
                code: 'VALIDATION_ERROR',
                field: 'appId',
                reason: 'required',
                message: 'appId query parameter is required',
                timestamp: new Date().toISOString()
            })
        };
    }

    const cacheKey = String(appId);
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Cache': 'hit'
            },
            body: JSON.stringify({
                appId: cacheKey,
                count: cached.shortNames.length,
                shortNames: cached.shortNames,
                generatedAt: new Date(cached.generatedAt).toISOString()
            })
        };
    }

    let mongoClient;
    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }
        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const collection = mongoClient.db().collection('organizers');

        // Match both string and numeric appId to cover legacy rows
        const docs = await collection
            .find(
                { $or: [{ appId: String(appId) }, { appId: Number(appId) }] },
                { projection: { shortName: 1, _id: 0 } }
            )
            .toArray();

        const shortNames = docs
            .map(d => d.shortName)
            .filter(s => typeof s === 'string' && s.length > 0)
            .map(s => s.toUpperCase());

        const generatedAt = Date.now();
        cache.set(cacheKey, {
            shortNames,
            generatedAt,
            expiresAt: generatedAt + CACHE_TTL_MS
        });

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Cache': 'miss'
            },
            body: JSON.stringify({
                appId: cacheKey,
                count: shortNames.length,
                shortNames,
                generatedAt: new Date(generatedAt).toISOString()
            })
        };

    } catch (err) {
        context.log(`OrganizerShortnamesBulk error: ${err.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ServerError',
                message: 'shortnames bulk read failed',
                timestamp: new Date().toISOString()
            })
        };
    } finally {
        if (mongoClient) await mongoClient.close();
    }
}

app.http('OrganizerShortnamesBulk', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'organizers/shortnames',
    handler: standardMiddleware(shortnamesBulkHandler)
});
