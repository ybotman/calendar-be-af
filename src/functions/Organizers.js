// src/functions/Organizers.js
// Domain: Organizers - GET endpoint for retrieving organizers with filtering and pagination
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * GET /api/organizers
 * Retrieve organizers with filtering and pagination from MongoDB
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - limit: Results per page (default: 100, max: 500)
 * - page: Page number (default: 1)
 * - isActive: Filter by active status (optional)
 * - isEnabled: Filter by enabled status (optional)
 * - wantRender: Filter by render status (optional)
 * - includeHidden: Include hidden organizers (isVisible=false) (optional)
 * - masteredRegionId: Filter by mastered region ID (optional)
 * - masteredDivisionId: Filter by mastered division ID (optional)
 * - masteredCityId: Filter by mastered city ID (optional)
 * - select: Comma-separated fields to return (optional)
 *
 * Response: { organizers: [...], pagination: { total, page, limit, pages } }
 */
async function organizersGetHandler(request, context) {
    context.log('Organizers_Get: Request received');

    let mongoClient;

    try {
        // Parse query parameters
        const appId = request.query.get('appId') || '1';
        const limit = Math.min(500, Math.max(1, parseInt(request.query.get('limit') || '100', 10)));
        const page = Math.max(1, parseInt(request.query.get('page') || '1', 10));
        const isActiveParam = request.query.get('isActive');
        const isEnabledParam = request.query.get('isEnabled');
        const wantRenderParam = request.query.get('wantRender');
        const includeHidden = request.query.get('includeHidden') === 'true';
        const masteredRegionId = request.query.get('masteredRegionId') || request.query.get('organizerRegion');
        const masteredDivisionId = request.query.get('masteredDivisionId') || request.query.get('organizerDivision');
        const masteredCityId = request.query.get('masteredCityId') || request.query.get('organizerCity');
        const select = request.query.get('select');

        context.log(`Fetching organizers: appId=${appId}, page=${page}, limit=${limit}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const organizersCollection = db.collection('organizers');

        // Build query filter
        const query = { appId };

        // Filter by isVisible unless includeHidden is true
        if (!includeHidden) {
            query.isVisible = { $ne: false };
        }

        // Filter by isActive if provided
        if (isActiveParam !== null && isActiveParam !== undefined) {
            query.isActive = isActiveParam === 'true';
        }

        // Filter by isEnabled if provided
        if (isEnabledParam !== null && isEnabledParam !== undefined) {
            query.isEnabled = isEnabledParam === 'true';
        }

        // Filter by wantRender if provided
        if (wantRenderParam !== null && wantRenderParam !== undefined) {
            query.wantRender = wantRenderParam === 'true';
        }

        // Filter by location IDs if provided
        if (masteredRegionId) {
            query.masteredRegionId = masteredRegionId;
        }
        if (masteredDivisionId) {
            query.masteredDivisionId = masteredDivisionId;
        }
        if (masteredCityId) {
            query.masteredCityId = masteredCityId;
        }

        // Calculate pagination
        const skip = (page - 1) * limit;

        // Build projection if select is provided
        const projection = {};
        if (select) {
            select.split(',').forEach(field => {
                projection[field.trim()] = 1;
            });
        } else {
            // Default fields for better performance
            projection._id = 1;
            projection.fullName = 1;
            projection.shortName = 1;
            projection.isActive = 1;
            projection.isEnabled = 1;
            projection.wantRender = 1;
            projection.isVisible = 1;
            projection.firebaseUserId = 1;
            projection.organizerRegion = 1;
            projection.masteredRegionId = 1;
            projection.masteredDivisionId = 1;
            projection.masteredCityId = 1;
        }

        // Execute query with pagination
        const organizersQuery = organizersCollection
            .find(query, { projection: Object.keys(projection).length > 0 ? projection : undefined })
            .sort({ fullName: 1 })
            .skip(skip)
            .limit(limit);

        const organizers = await organizersQuery.toArray();

        // Get total count for pagination info
        const total = await organizersCollection.countDocuments(query);
        const totalPages = Math.ceil(total / limit);

        context.log(`Found ${organizers.length} organizers (page ${page}/${totalPages}, total: ${total})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                organizers,
                pagination: {
                    total,
                    page,
                    limit,
                    pages: totalPages
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        // Let errorHandler middleware handle the error
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

// Register function with standard middleware
app.http('Organizers_Get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'organizers',
    handler: standardMiddleware(organizersGetHandler)
});

/**
 * GET /api/organizers/{id}
 * Get single organizer by ID
 *
 * @param {string} id - Organizer ID (MongoDB ObjectId)
 */
async function organizersGetByIdHandler(request, context) {
    const organizerId = request.params.id;
    const appId = request.query.get('appId') || '1';

    context.log(`Organizers_GetById: Request for organizer ${organizerId}`);

    let mongoClient;

    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('organizers');

        // Find organizer by ID and appId
        const organizer = await collection.findOne({
            _id: new ObjectId(organizerId),
            appId
        });

        if (!organizer) {
            context.log(`Organizer not found: ${organizerId}`);
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

        context.log(`Organizer found: ${organizerId}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(organizer)
        };
    } catch (error) {
        // Let errorHandler middleware handle the error
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Organizers_GetById', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'organizers/{id}',
    handler: standardMiddleware(organizersGetByIdHandler)
});

/**
 * POST /api/organizers
 * Create a new organizer
 */
async function organizersCreateHandler(request, context) {
    context.log('Organizers_Create: Request received');

    let mongoClient;

    try {
        const body = await request.json();
        const appId = body.appId || '1';

        // Validate required fields
        if (!body.fullName) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'fullName is required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        if (!body.shortName) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'shortName is required',
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
        const collection = db.collection('organizers');

        // Normalize shortName to uppercase
        const normalizedShortName = body.shortName.toUpperCase();

        // Check for duplicate shortName
        const existing = await collection.findOne({
            shortName: normalizedShortName,
            appId
        });

        if (existing) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'DuplicateError',
                    message: `shortName '${normalizedShortName}' already exists`,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Create organizer document
        const newOrganizer = {
            appId,
            fullName: body.fullName,
            shortName: normalizedShortName,
            description: body.description || '',
            publicContactInfo: body.publicContactInfo || {},
            organizerRegion: body.organizerRegion || null,
            organizerDivision: body.organizerDivision || null,
            organizerCity: body.organizerCity || null,
            masteredRegionId: body.masteredRegionId || null,
            masteredDivisionId: body.masteredDivisionId || null,
            masteredCityId: body.masteredCityId || null,
            wantRender: body.wantRender || false,
            isActive: body.isActive !== undefined ? body.isActive : false,
            isEnabled: body.isEnabled !== undefined ? body.isEnabled : false,
            isVisible: body.isVisible !== undefined ? body.isVisible : true,
            organizerTypes: body.organizerTypes || {
                isEventOrganizer: true,
                isVenue: false,
                isTeacher: false,
                isMaestro: false,
                isDJ: false,
                isOrchestra: false
            },
            firebaseUserId: body.firebaseUserId || null,
            linkedUserLogin: body.linkedUserLogin || null,
            images: body.images || [],
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await collection.insertOne(newOrganizer);
        newOrganizer._id = result.insertedId;

        context.log(`[ORGANIZER CREATE] Name: "${newOrganizer.fullName}", ShortName: "${newOrganizer.shortName}", OrganizerId: ${newOrganizer._id}`);

        return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newOrganizer)
        };

    } catch (error) {
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Organizers_Create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'organizers',
    handler: standardMiddleware(organizersCreateHandler)
});

/**
 * PUT /api/organizers/{id}
 * Update an organizer
 */
async function organizersUpdateHandler(request, context) {
    const organizerId = request.params.id;
    context.log(`Organizers_Update: Request for organizer ${organizerId}`);

    let mongoClient;

    try {
        const body = await request.json();
        const appId = body.appId || request.query.get('appId') || '1';

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('organizers');

        // Check if organizer exists
        const existing = await collection.findOne({
            _id: new ObjectId(organizerId),
            appId
        });

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

        // If updating shortName, validate it
        if (body.shortName) {
            const normalizedShortName = body.shortName.toUpperCase();

            if (normalizedShortName === 'CHANGE') {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success: false,
                        error: 'ValidationError',
                        message: "shortName cannot be 'CHANGE'",
                        timestamp: new Date().toISOString()
                    })
                };
            }

            // Check for duplicate
            const duplicate = await collection.findOne({
                shortName: normalizedShortName,
                appId,
                _id: { $ne: new ObjectId(organizerId) }
            });

            if (duplicate) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success: false,
                        error: 'DuplicateError',
                        message: `shortName '${normalizedShortName}' is already taken`,
                        timestamp: new Date().toISOString()
                    })
                };
            }

            body.shortName = normalizedShortName;
        }

        // Build update object
        const updateData = { ...body };
        delete updateData.appId; // Don't update appId
        delete updateData._id;   // Don't update _id
        updateData.updatedAt = new Date();

        const result = await collection.findOneAndUpdate(
            { _id: new ObjectId(organizerId), appId },
            { $set: updateData },
            { returnDocument: 'after' }
        );

        context.log(`[ORGANIZER UPDATE] OrganizerId: ${organizerId}, UpdatedFields: ${Object.keys(updateData).join(', ')}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result)
        };

    } catch (error) {
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Organizers_Update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'organizers/{id}',
    handler: standardMiddleware(organizersUpdateHandler)
});

/**
 * DELETE /api/organizers/{id}
 * Delete an organizer
 */
async function organizersDeleteHandler(request, context) {
    const organizerId = request.params.id;
    const appId = request.query.get('appId') || '1';

    context.log(`Organizers_Delete: Request for organizer ${organizerId}`);

    let mongoClient;

    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('organizers');

        // Find organizer first for logging
        const organizer = await collection.findOne({
            _id: new ObjectId(organizerId),
            appId
        });

        if (!organizer) {
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

        // Delete the organizer
        await collection.deleteOne({
            _id: new ObjectId(organizerId),
            appId
        });

        context.log(`[ORGANIZER DELETE] OrganizerId: ${organizerId}, Name: "${organizer.fullName}"`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'Organizer deleted',
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Organizers_Delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'organizers/{id}',
    handler: standardMiddleware(organizersDeleteHandler)
});

/**
 * PATCH /api/organizers/{id}/connect-user
 * Connect a Firebase user to an organizer
 */
async function organizersConnectUserHandler(request, context) {
    const organizerId = request.params.id;
    context.log(`Organizers_ConnectUser: Request for organizer ${organizerId}`);

    let mongoClient;

    try {
        const body = await request.json();
        const { firebaseUserId, appId = '1' } = body;

        if (!firebaseUserId) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'firebaseUserId is required',
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
        const organizersCollection = db.collection('organizers');
        const userLoginsCollection = db.collection('userlogins');
        const rolesCollection = db.collection('roles');

        // Find the organizer
        const organizer = await organizersCollection.findOne({
            _id: new ObjectId(organizerId),
            appId
        });

        if (!organizer) {
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

        // Find the user
        const user = await userLoginsCollection.findOne({ firebaseUserId, appId });

        if (!user) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'User not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Check if Firebase ID is already used by another organizer
        const existingOrganizer = await organizersCollection.findOne({
            firebaseUserId,
            appId,
            _id: { $ne: new ObjectId(organizerId) }
        });

        if (existingOrganizer) {
            return {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ConflictError',
                    message: 'This Firebase user is already linked to another organizer',
                    existingOrganizerId: existingOrganizer._id,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Update the organizer
        await organizersCollection.updateOne(
            { _id: new ObjectId(organizerId) },
            {
                $set: {
                    firebaseUserId,
                    linkedUserLogin: user._id,
                    updatedAt: new Date()
                }
            }
        );

        // Get the RegionalOrganizer role
        const organizerRole = await rolesCollection.findOne({ roleName: 'RegionalOrganizer', appId });

        // Update the user's regionalOrganizerInfo and add role
        const userUpdate = {
            $set: {
                'regionalOrganizerInfo.organizerId': new ObjectId(organizerId),
                'regionalOrganizerInfo.isApproved': true,
                'regionalOrganizerInfo.isEnabled': true,
                'regionalOrganizerInfo.isActive': true,
                'regionalOrganizerInfo.ApprovalDate': new Date(),
                updatedAt: new Date()
            }
        };

        // Add role if it exists and user doesn't have it
        if (organizerRole) {
            userUpdate.$addToSet = { roleIds: organizerRole._id };
        }

        await userLoginsCollection.updateOne(
            { _id: user._id },
            userUpdate
        );

        context.log(`[ORGANIZER CONNECT] OrganizerId: ${organizerId} connected to User: ${user._id}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'User connected to organizer successfully',
                organizer: {
                    _id: organizerId,
                    firebaseUserId,
                    linkedUserLogin: user._id
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Organizers_ConnectUser', {
    methods: ['PATCH'],
    authLevel: 'anonymous',
    route: 'organizers/{id}/connect-user',
    handler: standardMiddleware(organizersConnectUserHandler)
});

/**
 * PATCH /api/organizers/{id}/disconnect-user
 * Disconnect a Firebase user from an organizer
 */
async function organizersDisconnectUserHandler(request, context) {
    const organizerId = request.params.id;
    context.log(`Organizers_DisconnectUser: Request for organizer ${organizerId}`);

    let mongoClient;

    try {
        const body = await request.json().catch(() => ({}));
        const appId = body.appId || request.query.get('appId') || '1';

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const organizersCollection = db.collection('organizers');
        const userLoginsCollection = db.collection('userlogins');

        // Find the organizer
        const organizer = await organizersCollection.findOne({
            _id: new ObjectId(organizerId),
            appId
        });

        if (!organizer) {
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

        // Check if organizer has a linked user
        if (!organizer.firebaseUserId || !organizer.linkedUserLogin) {
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    message: 'Organizer does not have a linked user',
                    timestamp: new Date().toISOString()
                })
            };
        }

        const firebaseUserId = organizer.firebaseUserId;
        const linkedUserLoginId = organizer.linkedUserLogin;

        // Update the organizer - remove user connection
        await organizersCollection.updateOne(
            { _id: new ObjectId(organizerId) },
            {
                $set: {
                    firebaseUserId: null,
                    linkedUserLogin: null,
                    updatedAt: new Date()
                }
            }
        );

        // Update the user's regionalOrganizerInfo
        await userLoginsCollection.updateOne(
            { firebaseUserId, appId },
            {
                $set: {
                    'regionalOrganizerInfo.organizerId': null,
                    'regionalOrganizerInfo.isApproved': false,
                    'regionalOrganizerInfo.isEnabled': false,
                    'regionalOrganizerInfo.isActive': false,
                    'regionalOrganizerInfo.ApprovalDate': null,
                    updatedAt: new Date()
                }
            }
        );

        context.log(`[ORGANIZER DISCONNECT] OrganizerId: ${organizerId} disconnected from User`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'User disconnected from organizer successfully',
                organizer: {
                    _id: organizerId,
                    name: organizer.fullName || organizer.shortName
                },
                previousFirebaseUserId: firebaseUserId,
                previousUserLoginId: linkedUserLoginId,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Organizers_DisconnectUser', {
    methods: ['PATCH'],
    authLevel: 'anonymous',
    route: 'organizers/{id}/disconnect-user',
    handler: standardMiddleware(organizersDisconnectUserHandler)
});
