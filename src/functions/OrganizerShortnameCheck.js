// src/functions/OrganizerShortnameCheck.js
// CALBEAF-107 — GET /api/organizers/shortname-check
// Per ORGANIZER-SHORTNAME-DESIGN.md §1.1.1
//
// Live dedup/collision probe for Sarah's apply modal.
// Anonymous auth, read-only, single-candidate. <100ms p95 target.

const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { validateShortName } = require('../lib/organizerShortNameRules');
const { validationErrorResponse } = require('../lib/shortNameHelpers');

async function shortnameCheckHandler(request, context) {
    const appId = request.query.get('appId');
    const candidate = request.query.get('candidate');
    const excludeIdParam = request.query.get('excludeId');

    if (!appId) {
        return validationErrorResponse({
            code: 'VALIDATION_ERROR',
            field: 'appId',
            reason: 'required',
            message: 'appId query parameter is required'
        });
    }
    if (!candidate) {
        return validationErrorResponse({
            code: 'VALIDATION_ERROR',
            field: 'candidate',
            reason: 'required',
            message: 'candidate query parameter is required'
        });
    }

    // Validate excludeId shape (if provided)
    let excludeObjectId = null;
    if (excludeIdParam) {
        try {
            excludeObjectId = new ObjectId(excludeIdParam);
        } catch (e) {
            return validationErrorResponse({
                code: 'VALIDATION_ERROR',
                field: 'excludeId',
                reason: 'invalid-pattern',
                message: 'excludeId must be a valid ObjectId'
            });
        }
    }

    const normalizedShortName = String(candidate).toUpperCase();

    // Run §1.2 validator. For appId=1: length/pattern/reserved checks.
    // For any other appId: validateShortName returns { valid: true } (hard pass-through).
    const ruleResult = validateShortName(candidate, appId);
    if (!ruleResult.valid) {
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                available: false,
                normalizedShortName,
                reason: ruleResult.reason
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

        const query = {
            shortName: normalizedShortName,
            appId: String(appId)
        };
        if (excludeObjectId) {
            query._id = { $ne: excludeObjectId };
        }

        // Also try numeric appId since legacy rows may store as number
        const existing = await collection.findOne({
            shortName: normalizedShortName,
            $or: [
                { appId: String(appId) },
                { appId: Number(appId) }
            ],
            ...(excludeObjectId ? { _id: { $ne: excludeObjectId } } : {})
        });

        if (existing) {
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    available: false,
                    normalizedShortName,
                    reason: 'taken'
                })
            };
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                available: true,
                normalizedShortName,
                reason: null
            })
        };

    } catch (err) {
        context.log(`OrganizerShortnameCheck error: ${err.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ServerError',
                message: 'shortname-check failed',
                timestamp: new Date().toISOString()
            })
        };
    } finally {
        if (mongoClient) await mongoClient.close();
    }
}

app.http('OrganizerShortnameCheck', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'organizers/shortname-check',
    handler: standardMiddleware(shortnameCheckHandler)
});
