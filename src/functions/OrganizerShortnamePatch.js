// src/functions/OrganizerShortnamePatch.js
// CALBEAF-107 — PATCH /api/organizers/{id}/shortname
// Per ORGANIZER-SHORTNAME-DESIGN.md §1.1.5
//
// Sarah's edit-later shortName sub-resource.
// Firebase-authed; organizer or regionalAdmin only.

const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');
const { validateOrFail, duplicateShortNameResponse, backfeedAidi } = require('../lib/shortNameHelpers');

async function shortnamePatchHandler(request, context) {
    const organizerId = request.params.id;

    let mongoClient;
    try {
        // Firebase auth required (same pattern as organizer-settings endpoints)
        const user = await firebaseAuth(request, context);
        if (!user) {
            return unauthorizedResponse('Firebase authentication required');
        }

        // Validate organizerId shape
        let orgObjectId;
        try {
            orgObjectId = new ObjectId(organizerId);
        } catch (e) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    code: 'VALIDATION_ERROR',
                    field: 'id',
                    reason: 'invalid-pattern',
                    message: 'organizer id must be a valid ObjectId',
                    timestamp: new Date().toISOString()
                })
            };
        }

        const body = await request.json();
        if (!body.shortName) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    code: 'VALIDATION_ERROR',
                    field: 'shortName',
                    reason: 'required',
                    message: 'shortName is required in request body',
                    timestamp: new Date().toISOString()
                })
            };
        }

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) throw new Error('MongoDB connection string not configured');
        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const collection = mongoClient.db().collection('organizers');

        // Load existing doc — derive appId from stored doc (NOT request body)
        const existing = await collection.findOne({ _id: orgObjectId });
        if (!existing) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Organizer not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Permission check: must be the organizer's firebase user OR regionalAdmin
        const isOwner = existing.firebaseUserId && existing.firebaseUserId === user.uid;
        const isRegionalAdmin =
            user.regionalAdmin === true ||
            (Array.isArray(user.roles) && user.roles.includes('regionalAdmin'));
        if (!isOwner && !isRegionalAdmin) {
            return {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Forbidden',
                    message: 'Only the organizer or a regional admin may edit shortName',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Validate via §1.2 rules (appId guard handled inside)
        const storedAppId = existing.appId;
        const v = validateOrFail(body.shortName, storedAppId);
        if (!v.ok) return v.response;

        const normalized = v.normalized;

        // Uniqueness check scoped to {shortName, appId}, exclude this org's _id
        const duplicate = await collection.findOne({
            shortName: normalized,
            $or: [{ appId: String(storedAppId) }, { appId: Number(storedAppId) }],
            _id: { $ne: orgObjectId }
        });
        if (duplicate) {
            return duplicateShortNameResponse(normalized);
        }

        // Update
        const now = new Date();
        await collection.updateOne(
            { _id: orgObjectId },
            { $set: { shortName: normalized, updatedAt: now } }
        );

        context.log(`[ORGANIZER SHORTNAME PATCH] OrgId: ${organizerId}, NewShortName: "${normalized}"`);

        // Backfeed to AIDI (§1.1.6). Awaited — 2s cap inside helper caps delay;
        // Azure Functions kills async work after response so fire-and-forget doesn't work.
        const orgToken = existing.orgToken || null;
        await backfeedAidi({
            context,
            orgId: organizerId,
            orgToken,
            shortName: normalized,
            appId: storedAppId
        });

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                organizer: {
                    _id: organizerId,
                    shortName: normalized,
                    updatedAt: now.toISOString()
                }
            })
        };

    } catch (err) {
        context.log(`OrganizerShortnamePatch error: ${err.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ServerError',
                message: 'shortname patch failed',
                timestamp: new Date().toISOString()
            })
        };
    } finally {
        if (mongoClient) await mongoClient.close();
    }
}

app.http('OrganizerShortnamePatch', {
    methods: ['PATCH'],
    authLevel: 'anonymous',
    route: 'organizers/{id}/shortname',
    handler: standardMiddleware(shortnamePatchHandler)
});
