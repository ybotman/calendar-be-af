// src/functions/Events_Spotlights.js
// Domain: Events - Spotlight management for any approved organizer
// Allows adding/removing spotlights (DJ, Instructor, Performer) on ANY event
// Security: Any approved organizer can modify spotlights, not just event owner
//
// NOTE: Handles legacy `features` field → renamed to `spotlights`
// - Reads from BOTH fields (features + spotlights) for legacy compatibility
// - Always WRITES to `spotlights` (canonical name going forward)

const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');

// ============================================
// HELPER: Get spotlights from event (handles features → spotlights rename)
// Reads from both fields, deduplicates by type+name
// ============================================
function getSpotlightsFromEvent(event) {
    const spotlights = event.spotlights || [];
    const features = event.features || [];

    // Merge both arrays, deduplicate by type+name
    const combined = [...spotlights];
    for (const f of features) {
        const exists = combined.some(s =>
            s.type?.toLowerCase() === f.type?.toLowerCase() && s.name === f.name
        );
        if (!exists) {
            combined.push(f);
        }
    }
    return combined;
}

// ============================================
// HELPER: Check if user has Spotlighter role AND it's enabled
// Two-layer check:
// 1. roleIds contains Spotlighter
// 2. spotlighterInfo.isEnabled = true (can be turned off by admin)
// ============================================
async function hasSpotlighterRole(db, firebaseUID, appId) {
    // CALBEAF-149: actual userlogin field is firebaseUserId, not firebaseUID.
    const userLogin = await db.collection('userlogins').findOne({
        firebaseUserId: firebaseUID,
        appId: appId
    });

    if (!userLogin) {
        return { hasRole: false, reason: 'User not found' };
    }

    // CALBEAF-152: roleIds in DB are ObjectIds, not populated docs.
    // Look up Spotlighter role _id and compare ObjectId membership.
    const spotlighterRole = await db.collection('roles').findOne({ roleName: 'Spotlighter', appId });
    if (!spotlighterRole) {
        return { hasRole: false, reason: 'Spotlighter role not configured for this appId' };
    }

    const hasRoleInArray = (userLogin.roleIds || []).some(
        id => id.toString() === spotlighterRole._id.toString()
    );

    if (!hasRoleInArray) {
        return { hasRole: false, reason: 'User does not have Spotlighter role' };
    }

    // Check 2: Is spotlighterInfo enabled? (allows admin to disable)
    // If spotlighterInfo doesn't exist, default to enabled (role alone is enough)
    // If spotlighterInfo exists, check isEnabled flag
    const spotlighterInfo = userLogin.spotlighterInfo;
    if (spotlighterInfo && spotlighterInfo.isEnabled === false) {
        return { hasRole: false, reason: 'Spotlighter role is disabled for this user' };
    }

    return {
        hasRole: true,
        userLogin: userLogin,
        spotlighterInfo: spotlighterInfo
    };
}

// ============================================
// HELPER: Check if user is an approved organizer
// ============================================
async function isApprovedOrganizer(db, firebaseUID, appId) {
    // CALBEAF-149: actual userlogin fields are firebaseUserId (not firebaseUID)
    // and regionalOrganizerInfo.organizerId (not activeOrganizerId — dead field,
    // 0 of 52 TEST userlogins had it).
    const userLogin = await db.collection('userlogins').findOne({
        firebaseUserId: firebaseUID,
        appId: appId
    });

    if (!userLogin) {
        return { approved: false, reason: 'User not found in userlogins' };
    }

    const organizerId = userLogin.regionalOrganizerInfo?.organizerId;
    if (!organizerId) {
        return { approved: false, reason: 'User has no associated organizer' };
    }

    // CALBEAF-152: approval flags live on userLogin.regionalOrganizerInfo, not on the
    // organizer doc itself. Earlier code queried organizers for a non-existent
    // regionalOrganizerInfo.isApproved field — always false.
    const userOrgInfo = userLogin.regionalOrganizerInfo;
    if (!userOrgInfo.isApproved || !userOrgInfo.isEnabled || !userOrgInfo.isActive) {
        return { approved: false, reason: 'User organizer association is not approved/enabled/active' };
    }

    const organizer = await db.collection('organizers').findOne({ _id: organizerId });
    if (!organizer) {
        return { approved: false, reason: 'Organizer record not found' };
    }

    return {
        approved: true,
        organizer: organizer,
        userLogin: userLogin
    };
}

// ============================================
// HELPER: Send Firestore notification to event owner
// ============================================
async function sendSpotlightNotification(db, event, action, spotlight, modifiedBy, context) {
    // TODO: Implement Firestore messaging
    // For now, log the notification that would be sent
    context.log(`[SPOTLIGHT NOTIFICATION] Would send to event owner:`, {
        eventId: event._id,
        eventTitle: event.title,
        ownerOrganizerID: event.ownerOrganizerID,
        action: action,
        spotlight: spotlight,
        modifiedBy: modifiedBy
    });

    // Future: Use Firebase Admin SDK to write to Firestore
    // const firestore = admin.firestore();
    // await firestore.collection('users').doc(ownerFirebaseUID).collection('inbox').add({...});
}

// ============================================
// FUNCTION: PATCH /api/events/:eventId/spotlights
// Add or remove spotlights - any approved organizer can do this
// ============================================
/**
 * PATCH /api/events/{eventId}/spotlights
 * Add or remove spotlights on any event (for approved organizers)
 *
 * Request Body:
 * {
 *   "action": "add" | "remove",
 *   "spotlight": {
 *     "type": "dj" | "instructor" | "performer" | "band",
 *     "name": "DJ Carlos",
 *     "organizerId": "optional ObjectId if they're a registered organizer"
 *   },
 *   "instanceKey": "2026-03-25T00:00:00.000Z"  // optional - for single occurrence of recurring event
 * }
 *
 * Behavior:
 * - Non-recurring event: Updates spotlights array on event
 * - Recurring event WITHOUT instanceKey: Updates spotlights on base event (all occurrences)
 * - Recurring event WITH instanceKey: Updates via instanceOverrides (single occurrence)
 *
 * Security:
 * - Firebase auth required
 * - User must be an approved organizer (any organizer, not just event owner)
 * - Can ONLY modify spotlights - no other event fields
 *
 * Audit:
 * - Logs change in spotlightLog array on event
 * - Sends notification to event owner
 */
async function spotlightsHandler(request, context) {
    const eventId = request.params.eventId;
    context.log(`Events_Spotlights: Request for event ${eventId}`);

    // Firebase auth required
    const user = await firebaseAuth(request, context);
    if (!user) {
        return unauthorizedResponse();
    }
    context.log(`Events_Spotlights: Authenticated user ${user.uid}`);

    let mongoClient;

    try {
        const requestBody = await request.json();
        const { action, spotlight, instanceKey } = requestBody;

        // Validate action
        if (!action || !['add', 'remove'].includes(action)) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'action must be "add" or "remove"',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Validate spotlight object
        if (!spotlight || !spotlight.type || !spotlight.name) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'spotlight must have type and name',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // CALBEAF-148: validTypes aligned with FE renderer + TIEMPO-388 schema
        // ('band' dropped — orphan, not in FE renderer, 0 events used it).
        // 'canceled' stays out — that's event.isCanceled (organizer flow), not a spotlight entry.
        const validTypes = ['dj', 'instructor', 'performer', 'orchestra', 'note'];
        if (!validTypes.includes(spotlight.type.toLowerCase())) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: `spotlight.type must be one of: ${validTypes.join(', ')}`,
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
        const eventsCollection = db.collection('events');

        // Fetch the event
        const event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });

        if (!event) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Event not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Check if user can manage spotlights (approved organizer OR Spotlighter role)
        const orgCheck = await isApprovedOrganizer(db, user.uid, event.appId);
        const spotlighterCheck = await hasSpotlighterRole(db, user.uid, event.appId);

        if (!orgCheck.approved && !spotlighterCheck.hasRole) {
            context.log(`Events_Spotlights: User ${user.uid} not authorized - org: ${orgCheck.reason}, spotlighter: ${spotlighterCheck.reason}`);
            return {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Must be an approved organizer or have Spotlighter role to modify spotlights',
                    reason: orgCheck.reason,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Log who is making the change
        if (orgCheck.approved) {
            context.log(`Events_Spotlights: Approved organizer ${(orgCheck.organizer.fullName || orgCheck.organizer.shortName)} (${orgCheck.organizer._id})`);
        } else {
            context.log(`Events_Spotlights: Spotlighter role user ${user.uid}`);
        }

        // Build spotlight entry with metadata
        const spotlightEntry = {
            type: spotlight.type.toLowerCase(),
            name: spotlight.name,
            organizerId: spotlight.organizerId ? new ObjectId(spotlight.organizerId) : null,
            addedBy: {
                firebaseUID: user.uid,
                organizerId: orgCheck.approved ? orgCheck.organizer._id : null,
                organizerName: orgCheck.approved
                    ? (orgCheck.organizer.fullName || orgCheck.organizer.shortName)
                    : 'Spotlighter',
                email: (orgCheck.approved ? orgCheck.userLogin?.email : spotlighterCheck.userLogin?.email) || user.email,
                role: orgCheck.approved ? 'organizer' : 'spotlighter'
            },
            addedAt: new Date()
        };

        // Build log entry
        const logEntry = {
            action: action,
            spotlight: { type: spotlight.type.toLowerCase(), name: spotlight.name },
            by: {
                firebaseUID: user.uid,
                organizerId: orgCheck.approved ? orgCheck.organizer._id : null,
                organizerName: orgCheck.approved
                    ? (orgCheck.organizer.fullName || orgCheck.organizer.shortName)
                    : 'Spotlighter',
                email: (orgCheck.approved ? orgCheck.userLogin?.email : spotlighterCheck.userLogin?.email) || user.email,
                role: orgCheck.approved ? 'organizer' : 'spotlighter'
            },
            at: new Date()
        };

        // Determine if this is for a single occurrence of a recurring event
        const isRecurring = !!event.recurrenceRule;
        const isSingleOccurrence = isRecurring && instanceKey;

        let updateResult;

        if (isSingleOccurrence) {
            // ============================================
            // CASE: Single occurrence of recurring event
            // Use instanceOverrides mechanism
            // ============================================
            const instanceKeyDate = new Date(instanceKey);
            if (isNaN(instanceKeyDate.getTime())) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success: false,
                        error: 'Invalid instanceKey date format',
                        timestamp: new Date().toISOString()
                    })
                };
            }

            // Find existing override for this instance
            const existingOverrideIndex = (event.instanceOverrides || []).findIndex(
                o => new Date(o.instanceKey).getTime() === instanceKeyDate.getTime()
            );

            if (existingOverrideIndex >= 0) {
                // Update existing override's spotlights
                const existingOverride = event.instanceOverrides[existingOverrideIndex];
                // Handle features → spotlights rename: read from patch.spotlights, patch.features, or base event
                const currentSpotlights = existingOverride.patch?.spotlights
                    || existingOverride.patch?.features
                    || getSpotlightsFromEvent(event);

                let newSpotlights;
                if (action === 'add') {
                    // Add spotlight (avoid duplicates by type+name)
                    const isDuplicate = currentSpotlights.some(
                        s => s.type === spotlightEntry.type && s.name === spotlightEntry.name
                    );
                    if (isDuplicate) {
                        return {
                            status: 409,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                success: false,
                                error: 'Spotlight already exists on this occurrence',
                                timestamp: new Date().toISOString()
                            })
                        };
                    }
                    newSpotlights = [...currentSpotlights, spotlightEntry];
                } else {
                    // Remove spotlight by type+name match
                    newSpotlights = currentSpotlights.filter(
                        s => !(s.type === spotlight.type.toLowerCase() && s.name === spotlight.name)
                    );
                }

                updateResult = await eventsCollection.updateOne(
                    { _id: new ObjectId(eventId) },
                    {
                        $set: {
                            [`instanceOverrides.${existingOverrideIndex}.patch.spotlights`]: newSpotlights,
                            [`instanceOverrides.${existingOverrideIndex}.modifiedAt`]: new Date(),
                            updatedAt: new Date()
                        },
                        $push: { spotlightLog: logEntry }
                    }
                );
            } else {
                // Create new override with just spotlights
                // Handle features → spotlights rename
                const baseSpotlights = getSpotlightsFromEvent(event);
                let newSpotlights;

                if (action === 'add') {
                    newSpotlights = [...baseSpotlights, spotlightEntry];
                } else {
                    newSpotlights = baseSpotlights.filter(
                        s => !(s.type === spotlight.type.toLowerCase() && s.name === spotlight.name)
                    );
                }

                const newOverride = {
                    instanceKey: instanceKeyDate,
                    overrideType: 'modify',
                    patch: { spotlights: newSpotlights },
                    modifiedByFirebaseUid: user.uid,
                    modifiedAt: new Date()
                };

                updateResult = await eventsCollection.updateOne(
                    { _id: new ObjectId(eventId) },
                    {
                        $push: {
                            instanceOverrides: newOverride,
                            spotlightLog: logEntry
                        },
                        $set: { updatedAt: new Date() }
                    }
                );
            }

            context.log(`Events_Spotlights: Updated single occurrence ${instanceKey}`);

        } else {
            // ============================================
            // CASE: Non-recurring event OR all occurrences
            // Update spotlights directly on event document
            // Handle features → spotlights rename
            // ============================================
            const currentSpotlights = getSpotlightsFromEvent(event);

            if (action === 'add') {
                // Check for duplicate
                const isDuplicate = currentSpotlights.some(
                    s => s.type === spotlightEntry.type && s.name === spotlightEntry.name
                );
                if (isDuplicate) {
                    return {
                        status: 409,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            success: false,
                            error: 'Spotlight already exists on this event',
                            timestamp: new Date().toISOString()
                        })
                    };
                }

                updateResult = await eventsCollection.updateOne(
                    { _id: new ObjectId(eventId) },
                    {
                        $push: {
                            spotlights: spotlightEntry,
                            spotlightLog: logEntry
                        },
                        $set: { updatedAt: new Date() }
                    }
                );
            } else {
                // Remove by type+name match
                updateResult = await eventsCollection.updateOne(
                    { _id: new ObjectId(eventId) },
                    {
                        $pull: {
                            spotlights: {
                                type: spotlight.type.toLowerCase(),
                                name: spotlight.name
                            }
                        },
                        $push: { spotlightLog: logEntry },
                        $set: { updatedAt: new Date() }
                    }
                );
            }

            context.log(`Events_Spotlights: Updated ${isRecurring ? 'all occurrences' : 'single event'}`);
        }

        if (updateResult.modifiedCount === 0) {
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Failed to update event',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Send notification to event owner
        await sendSpotlightNotification(db, event, action, spotlight, {
            firebaseUID: user.uid,
            organizerName: orgCheck.approved
                ? (orgCheck.organizer.fullName || orgCheck.organizer.shortName)
                : 'Spotlighter',
            email: (orgCheck.approved ? orgCheck.userLogin?.email : spotlighterCheck.userLogin?.email) || user.email,
            role: orgCheck.approved ? 'organizer' : 'spotlighter'
        }, context);

        // Fetch updated event
        const updatedEvent = await eventsCollection.findOne({ _id: new ObjectId(eventId) });

        context.log(`Events_Spotlights: ${action} spotlight "${spotlight.name}" (${spotlight.type}) on event ${eventId}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                action: action,
                spotlight: spotlight,
                instanceKey: instanceKey || null,
                affectedScope: isSingleOccurrence ? 'single_occurrence' : (isRecurring ? 'all_occurrences' : 'single_event'),
                modifiedBy: {
                    organizerName: orgCheck.approved
                        ? (orgCheck.organizer.fullName || orgCheck.organizer.shortName)
                        : 'Spotlighter',
                    organizerId: orgCheck.approved ? orgCheck.organizer._id : null,
                    role: orgCheck.approved ? 'organizer' : 'spotlighter'
                },
                event: {
                    _id: updatedEvent._id,
                    title: updatedEvent.title,
                    spotlights: updatedEvent.spotlights,
                    spotlightLog: updatedEvent.spotlightLog
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (err) {
        context.error(`Events_Spotlights: Error - ${err.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Internal server error',
                message: err.message,
                timestamp: new Date().toISOString()
            })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Events_Spotlights', {
    methods: ['PATCH'],
    authLevel: 'anonymous',
    route: 'events/{eventId}/spotlights',
    handler: standardMiddleware(spotlightsHandler)
});

// ============================================
// FUNCTION: GET /api/events/:eventId/spotlights
// Get spotlight history for an event
// ============================================
async function getSpotlightsHandler(request, context) {
    const eventId = request.params.eventId;
    context.log(`Events_Spotlights_Get: Request for event ${eventId}`);

    let mongoClient;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        // Include both spotlights AND features for legacy compatibility
        const event = await db.collection('events').findOne(
            { _id: new ObjectId(eventId) },
            { projection: { spotlights: 1, features: 1, spotlightLog: 1, title: 1, recurrenceRule: 1, instanceOverrides: 1 } }
        );

        if (!event) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Event not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Extract instance-specific spotlights from overrides (check both spotlights and features)
        const instanceSpotlights = (event.instanceOverrides || [])
            .filter(o => o.patch?.spotlights || o.patch?.features)
            .map(o => ({
                instanceKey: o.instanceKey,
                spotlights: o.patch.spotlights || o.patch.features || []
            }));

        // Merge spotlights + features (legacy field)
        const mergedSpotlights = getSpotlightsFromEvent(event);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventId: event._id,
                title: event.title,
                isRecurring: !!event.recurrenceRule,
                spotlights: mergedSpotlights,
                spotlightLog: event.spotlightLog || [],
                instanceSpotlights: instanceSpotlights,
                // Legacy indicator - true if event has data in old `features` field
                hasLegacyFeatures: (event.features || []).length > 0,
                timestamp: new Date().toISOString()
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Events_Spotlights_Get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'events/{eventId}/spotlights',
    handler: standardMiddleware(getSpotlightsHandler)
});
