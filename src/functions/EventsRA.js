// src/functions/EventsRA.js
// Domain: Events - Regional Admin CRUD operations with permission checking
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { requireRegionalAdmin, checkRAPermission, forbiddenResponse } = require('../middleware/requireRegionalAdmin');
const { unauthorizedResponse } = require('../middleware/firebaseAuth');

// ============================================
// FUNCTION 1: POST /api/events/ra/create
// ============================================

/**
 * POST /api/events/ra/create
 * Create event as RegionalAdmin
 *
 * Required fields: title, startDate, ownerOrganizerID, venueID
 * Validates venue permissions before creation
 * Sets RA audit trail (createdByRA)
 */
async function eventsRACreateHandler(request, context) {
    context.log('EventsRA_Create: Request received');

    // Step 1: Authenticate and authorize RA
    const raUser = await requireRegionalAdmin(request, context);
    if (!raUser) {
        return unauthorizedResponse('RegionalAdmin authentication required');
    }

    let mongoClient;

    try {
        const requestBody = await request.json();
        const {
            title,
            startDate,
            endDate,
            ownerOrganizerID,
            venueID,
            description,
            cost,
            appId = '1'
        } = requestBody;

        // Step 2: Validate required fields
        if (!title || !startDate || !ownerOrganizerID || !venueID) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    message: 'Missing required fields: title, startDate, ownerOrganizerID, venueID',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Step 3: Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const eventsCollection = db.collection('events');
        const venuesCollection = db.collection('Venues');
        const organizersCollection = db.collection('organizers');

        // Step 4: Validate venue exists and check permissions
        const venue = await venuesCollection.findOne({ _id: new ObjectId(venueID) });
        if (!venue) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    message: 'Venue not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Check RA venue permission
        if (!checkRAPermission(raUser, venue)) {
            return forbiddenResponse(
                "You don't have permission to create events at this venue",
                'VENUE_PERMISSION_DENIED'
            );
        }

        // Step 5: Validate organizer exists
        const organizer = await organizersCollection.findOne({ _id: new ObjectId(ownerOrganizerID) });
        if (!organizer) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    message: 'Organizer not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Step 6: Build event document with RA audit trail
        const eventData = {
            appId,
            title,
            startDate: new Date(startDate),
            endDate: endDate ? new Date(endDate) : undefined,
            description: description || '',
            cost: cost || '',
            // Organizer info (OLD structure for compatibility)
            ownerOrganizerID: new ObjectId(ownerOrganizerID),
            ownerOrganizerName: organizer.fullName || organizer.name || 'Event Organizer',
            ownerOrganizerShortName: organizer.shortName || 'ORG',
            // Venue info
            venueID: new ObjectId(venueID),
            locationName: venue.name,
            // Location data from venue
            masteredRegionId: venue.masteredRegionId,
            masteredDivisionId: venue.masteredDivisionId,
            masteredCityId: venue.masteredCityId,
            venueGeolocation: venue.geolocation,
            // RA audit trail
            createdByRA: {
                userId: raUser.userRecord._id,
                firebaseUserId: raUser.firebaseUserId,
                timestamp: new Date()
            },
            // Default values
            isActive: true,
            isDiscovered: false,
            isOwnerManaged: true,
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Remove undefined fields
        Object.keys(eventData).forEach(key =>
            eventData[key] === undefined && delete eventData[key]
        );

        // Step 7: Insert event
        const result = await eventsCollection.insertOne(eventData);

        context.log(`RA ${raUser.firebaseUserId} created event ${result.insertedId} for organizer ${ownerOrganizerID}`);

        return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'Event created successfully',
                event: {
                    _id: result.insertedId,
                    ...eventData
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        context.log(`EventsRA_Create Error: ${error.message}`);
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('EventsRA_Create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'events/ra/create',
    handler: standardMiddleware(eventsRACreateHandler)
});

// ============================================
// FUNCTION 2: PUT /api/events/ra/{eventId}
// ============================================

/**
 * PUT /api/events/ra/{eventId}
 * Update event as RegionalAdmin
 *
 * Validates event permissions before update
 * If venue changes, validates new venue permissions
 * Sets RA audit trail (lastModifiedByRA)
 */
async function eventsRAUpdateHandler(request, context) {
    const eventId = request.params.eventId;
    context.log(`EventsRA_Update: Request for event ${eventId}`);

    // Step 1: Authenticate and authorize RA
    const raUser = await requireRegionalAdmin(request, context);
    if (!raUser) {
        return unauthorizedResponse('RegionalAdmin authentication required');
    }

    let mongoClient;

    try {
        const requestBody = await request.json();
        const updateData = { ...requestBody };

        // Remove fields that RAs cannot update
        delete updateData.ownerOrganizerID;
        delete updateData.appId;
        delete updateData.createdByRA;
        delete updateData._id;

        // Step 2: Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const eventsCollection = db.collection('events');
        const venuesCollection = db.collection('Venues');

        // Step 3: Find event and check permissions
        const event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });
        if (!event) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    message: 'Event not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Check RA event permission
        if (!checkRAPermission(raUser, event)) {
            return forbiddenResponse(
                "You don't have permission to update this event",
                'EVENT_PERMISSION_DENIED'
            );
        }

        // Step 4: If venue is being updated, validate new venue permissions
        if (updateData.venueID && updateData.venueID !== event.venueID?.toString()) {
            const newVenue = await venuesCollection.findOne({ _id: new ObjectId(updateData.venueID) });
            if (!newVenue) {
                return {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success: false,
                        message: 'New venue not found',
                        timestamp: new Date().toISOString()
                    })
                };
            }

            if (!checkRAPermission(raUser, newVenue)) {
                return forbiddenResponse(
                    "You don't have permission to move event to this venue",
                    'VENUE_PERMISSION_DENIED'
                );
            }

            // Update location data from new venue
            updateData.venueID = new ObjectId(updateData.venueID);
            updateData.locationName = newVenue.name;
            updateData.masteredRegionId = newVenue.masteredRegionId;
            updateData.masteredDivisionId = newVenue.masteredDivisionId;
            updateData.masteredCityId = newVenue.masteredCityId;
            updateData.venueGeolocation = newVenue.geolocation;
        }

        // Step 5: Add RA audit trail
        updateData.lastModifiedByRA = {
            userId: raUser.userRecord._id,
            firebaseUserId: raUser.firebaseUserId,
            timestamp: new Date()
        };
        updateData.updatedAt = new Date();

        // Convert date strings to Date objects
        if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
        if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);

        // Step 6: Update event
        const result = await eventsCollection.findOneAndUpdate(
            { _id: new ObjectId(eventId) },
            { $set: updateData },
            { returnDocument: 'after' }
        );

        context.log(`RA ${raUser.firebaseUserId} updated event ${eventId}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'Event updated successfully',
                event: result,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        context.log(`EventsRA_Update Error: ${error.message}`);
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('EventsRA_Update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'events/ra/{eventId}',
    handler: standardMiddleware(eventsRAUpdateHandler)
});

// ============================================
// FUNCTION 3: DELETE /api/events/ra/{eventId}
// ============================================

/**
 * DELETE /api/events/ra/{eventId}
 * Delete event as RegionalAdmin
 *
 * Query params:
 * - reason: Reason for deletion (optional)
 * - soft: If 'true', marks as inactive instead of hard delete (default: true)
 *
 * Sets RA audit trail (deletedByRA)
 */
async function eventsRADeleteHandler(request, context) {
    const eventId = request.params.eventId;
    const reason = request.query.get('reason') || 'Deleted by Regional Admin';
    const soft = request.query.get('soft') !== 'false'; // Default to soft delete

    context.log(`EventsRA_Delete: Request for event ${eventId}, soft=${soft}`);

    // Step 1: Authenticate and authorize RA
    const raUser = await requireRegionalAdmin(request, context);
    if (!raUser) {
        return unauthorizedResponse('RegionalAdmin authentication required');
    }

    let mongoClient;

    try {
        // Step 2: Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const eventsCollection = db.collection('events');

        // Step 3: Find event and check permissions
        const event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });
        if (!event) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    message: 'Event not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Check RA event permission
        if (!checkRAPermission(raUser, event)) {
            return forbiddenResponse(
                "You don't have permission to delete this event",
                'EVENT_PERMISSION_DENIED'
            );
        }

        // Step 4: Build deletion audit trail
        const deletionAudit = {
            userId: raUser.userRecord._id,
            firebaseUserId: raUser.firebaseUserId,
            timestamp: new Date(),
            reason: reason
        };

        // Step 5: Perform soft or hard delete
        if (soft) {
            // Soft delete - mark as inactive
            await eventsCollection.updateOne(
                { _id: new ObjectId(eventId) },
                {
                    $set: {
                        isActive: false,
                        deletedByRA: deletionAudit,
                        updatedAt: new Date()
                    }
                }
            );

            context.log(`RA ${raUser.firebaseUserId} soft deleted event ${eventId}`);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    message: 'Event marked as inactive (soft delete)',
                    deletionType: 'soft',
                    eventId: eventId,
                    timestamp: new Date().toISOString()
                })
            };
        } else {
            // Hard delete - add audit trail then remove
            await eventsCollection.updateOne(
                { _id: new ObjectId(eventId) },
                { $set: { deletedByRA: deletionAudit } }
            );

            await eventsCollection.deleteOne({ _id: new ObjectId(eventId) });

            context.log(`RA ${raUser.firebaseUserId} hard deleted event ${eventId}`);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    message: 'Event permanently deleted',
                    deletionType: 'hard',
                    eventId: eventId,
                    timestamp: new Date().toISOString()
                })
            };
        }

    } catch (error) {
        context.log(`EventsRA_Delete Error: ${error.message}`);
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('EventsRA_Delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'events/ra/{eventId}',
    handler: standardMiddleware(eventsRADeleteHandler)
});
