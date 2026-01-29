// src/functions/UserLogins.js
// Domain: UserLogins - CRUD endpoints for user login management
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');
const { getFirebaseAdmin } = require('../lib/firebase-admin');

/**
 * GET /api/userlogins/firebase/{firebaseId}
 * Retrieve user login by Firebase ID
 *
 * Path Parameters:
 * - firebaseId: Firebase user ID (required)
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 *
 * Response: User login object with populated roleIds
 *
 * Features:
 * - Looks up by primary firebaseUserId
 * - Falls back to alternateFirebaseUserIds if not found
 * - Auto-creates record for non-default apps from appId=1 record
 */
async function userLoginGetByFirebaseIdHandler(request, context) {
    const firebaseId = request.params.firebaseId;
    const appId = request.query.get('appId') || '1';

    context.log(`UserLogins: GET by firebaseId=${firebaseId}, appId=${appId}`);

    if (!firebaseId) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'firebaseId parameter is required',
                timestamp: new Date().toISOString()
            })
        };
    }

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
        const userLoginsCollection = db.collection('userlogins');
        const rolesCollection = db.collection('roles');

        // First try to find by primary firebaseUserId
        let userLogin = await userLoginsCollection.findOne({
            firebaseUserId: firebaseId,
            appId: appId
        });

        // If not found, try to find by alternate Firebase IDs
        if (!userLogin) {
            context.log(`Primary ID not found, checking alternate IDs for ${firebaseId}`);
            userLogin = await userLoginsCollection.findOne({
                alternateFirebaseUserIds: firebaseId,
                appId: appId
            });
        }

        // If not found and requesting non-default app, try to auto-create from default app record
        if (!userLogin && appId !== '1') {
            context.log(`User not found for appId=${appId}, checking if exists in appId=1 for auto-creation`);

            const defaultAppUser = await userLoginsCollection.findOne({
                firebaseUserId: firebaseId,
                appId: '1'
            });

            if (defaultAppUser) {
                context.log(`Found user in appId=1, auto-creating record for appId=${appId}`);

                // Find the NamedUser role for this appId
                const namedUserRole = await rolesCollection.findOne({
                    roleName: 'NamedUser',
                    appId: appId
                });

                // Create new record for this app, copying base user info
                const newUserData = {
                    appId: appId,
                    firebaseUserId: firebaseId,
                    firebaseUserInfo: defaultAppUser.firebaseUserInfo || {},
                    localUserInfo: {
                        isApproved: true,
                        isEnabled: true,
                        isActive: true,
                        loginUserName: defaultAppUser.localUserInfo?.loginUserName,
                        firstName: defaultAppUser.localUserInfo?.firstName,
                        lastName: defaultAppUser.localUserInfo?.lastName,
                        phoneNumber: defaultAppUser.localUserInfo?.phoneNumber
                    },
                    roleIds: namedUserRole ? [namedUserRole._id] : [],
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                try {
                    const insertResult = await userLoginsCollection.insertOne(newUserData);

                    // Fetch the newly created user
                    userLogin = await userLoginsCollection.findOne({
                        _id: insertResult.insertedId
                    });

                    context.log(`Auto-created userLogin for ${firebaseId} in appId=${appId}`);
                } catch (createError) {
                    // Handle race condition: another request may have created the record
                    if (createError.code === 11000) {
                        context.log(`Race condition detected for ${firebaseId} in appId=${appId}, fetching existing record`);
                        userLogin = await userLoginsCollection.findOne({
                            firebaseUserId: firebaseId,
                            appId: appId
                        });
                    } else {
                        throw createError;
                    }
                }
            }
        }

        // If still not found, return 404
        if (!userLogin) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'User login not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Populate roleIds by fetching role documents
        if (userLogin.roleIds && userLogin.roleIds.length > 0) {
            const roleObjectIds = userLogin.roleIds.map(id =>
                id instanceof ObjectId ? id : new ObjectId(id)
            );

            const roles = await rolesCollection
                .find({ _id: { $in: roleObjectIds } })
                .toArray();

            // Replace roleIds with populated role objects
            userLogin.roleIds = roles;
        }

        // Exclude auditLog for performance (can be large)
        delete userLogin.auditLog;

        context.log(`User login fetched successfully for ${firebaseId}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userLogin)
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

// Register function with standard middleware
app.http('UserLogins_GetByFirebaseId', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'userlogins/firebase/{firebaseId}',
    handler: standardMiddleware(userLoginGetByFirebaseIdHandler)
});

/**
 * GET /api/userlogins/all
 * Admin endpoint - list all users with pagination
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 100, max: 500)
 *
 * Response: { users: [...], pagination: { total, page, limit, pages } }
 */
async function userLoginsGetAllHandler(request, context) {
    context.log('UserLogins_GetAll: Request received');

    let mongoClient;

    try {
        const appId = request.query.get('appId') || '1';
        const page = Math.max(1, parseInt(request.query.get('page') || '1', 10));
        const limit = Math.min(500, Math.max(1, parseInt(request.query.get('limit') || '100', 10)));
        const skip = (page - 1) * limit;

        context.log(`UserLogins_GetAll: appId=${appId}, page=${page}, limit=${limit}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const userLoginsCollection = db.collection('userlogins');
        const rolesCollection = db.collection('roles');

        const query = { appId };

        // Get users with pagination, excluding auditLog for performance
        const users = await userLoginsCollection
            .find(query, { projection: { auditLog: 0 } })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        // Get total count for pagination
        const total = await userLoginsCollection.countDocuments(query);
        const totalPages = Math.ceil(total / limit);

        // Collect all unique roleIds across all users for a single bulk lookup
        const allRoleIds = new Set();
        for (const user of users) {
            if (user.roleIds && user.roleIds.length > 0) {
                for (const roleId of user.roleIds) {
                    allRoleIds.add(roleId.toString());
                }
            }
        }

        // Bulk fetch all roles referenced by users
        let rolesMap = {};
        if (allRoleIds.size > 0) {
            const roleObjectIds = Array.from(allRoleIds).map(id => new ObjectId(id));
            const roles = await rolesCollection
                .find({ _id: { $in: roleObjectIds } })
                .toArray();
            for (const role of roles) {
                rolesMap[role._id.toString()] = role;
            }
        }

        // Attach role names to each user
        for (const user of users) {
            if (user.roleIds && user.roleIds.length > 0) {
                user.roleIds = user.roleIds.map(roleId => {
                    const role = rolesMap[roleId.toString()];
                    return role || roleId;
                });
            }
        }

        context.log(`UserLogins_GetAll: Found ${users.length} users (page ${page}/${totalPages}, total: ${total})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                users,
                pagination: {
                    total,
                    page,
                    limit,
                    pages: totalPages
                }
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

app.http('UserLogins_GetAll', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'userlogins/all',
    handler: standardMiddleware(userLoginsGetAllHandler)
});

/**
 * POST /api/userlogins
 * Create a new user login record
 *
 * Body:
 * - firebaseUserId: Firebase user ID (required)
 * - appId: Application ID (default: "1")
 * - ...additional fields
 *
 * Response: { success: true, data: { ...newUser } }
 */
async function userLoginsCreateHandler(request, context) {
    context.log('UserLogins_Create: Request received');

    let mongoClient;

    try {
        const body = await request.json();
        const { firebaseUserId, appId = '1', ...otherFields } = body;

        // Validate required field
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
        const userLoginsCollection = db.collection('userlogins');
        const rolesCollection = db.collection('roles');

        // Check if user already exists with this firebaseUserId + appId
        const existing = await userLoginsCollection.findOne({ firebaseUserId, appId });
        if (existing) {
            return {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ConflictError',
                    message: `User with firebaseUserId '${firebaseUserId}' already exists for appId '${appId}'`,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Look up the NamedUser role to assign by default
        const namedUserRole = await rolesCollection.findOne({
            roleName: 'NamedUser',
            appId
        });

        const roleIds = namedUserRole ? [namedUserRole._id] : [];

        // Build the new user document
        const newUser = {
            firebaseUserId,
            appId,
            roleIds,
            ...otherFields,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Optionally enrich with Firebase user info
        try {
            const adminSDK = getFirebaseAdmin();
            const firebaseUser = await adminSDK.auth().getUser(firebaseUserId);
            newUser.firebaseUserInfo = {
                email: firebaseUser.email || null,
                displayName: firebaseUser.displayName || null,
                photoURL: firebaseUser.photoURL || null,
                emailVerified: firebaseUser.emailVerified || false
            };
        } catch (firebaseError) {
            context.log(`UserLogins_Create: Could not fetch Firebase user info for ${firebaseUserId}: ${firebaseError.message}`);
            // Gracefully continue without Firebase enrichment
        }

        const result = await userLoginsCollection.insertOne(newUser);
        newUser._id = result.insertedId;

        context.log(`[USERLOGIN CREATE] firebaseUserId: ${firebaseUserId}, appId: ${appId}, userId: ${newUser._id}`);

        return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: newUser
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

app.http('UserLogins_Create', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'userlogins',
    handler: standardMiddleware(userLoginsCreateHandler)
});

/**
 * PUT /api/userlogins/updateUserInfo
 * Update user info fields (localUserInfo, regionalOrganizerInfo, etc.)
 *
 * Body:
 * - firebaseUserId: Firebase user ID (required)
 * - appId: Application ID (default: "1")
 * - localUserInfo, regionalOrganizerInfo, localAdminInfo, roleIds, firebaseUserInfo (optional)
 *
 * Response: { success: true, data: { ...updatedUser } }
 */
async function userLoginsUpdateUserInfoHandler(request, context) {
    context.log('UserLogins_UpdateUserInfo: Request received');

    let mongoClient;

    try {
        const body = await request.json();
        const { firebaseUserId, appId = '1', localUserInfo, regionalOrganizerInfo, localAdminInfo, roleIds, firebaseUserInfo } = body;

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
        const userLoginsCollection = db.collection('userlogins');

        // Build $set object with only provided fields
        const updateFields = { updatedAt: new Date() };
        if (localUserInfo !== undefined) updateFields.localUserInfo = localUserInfo;
        if (regionalOrganizerInfo !== undefined) updateFields.regionalOrganizerInfo = regionalOrganizerInfo;
        if (localAdminInfo !== undefined) updateFields.localAdminInfo = localAdminInfo;
        if (firebaseUserInfo !== undefined) updateFields.firebaseUserInfo = firebaseUserInfo;

        // Convert roleIds strings to ObjectIds if provided
        if (roleIds !== undefined) {
            updateFields.roleIds = roleIds.map(id =>
                id instanceof ObjectId ? id : new ObjectId(id)
            );
        }

        const result = await userLoginsCollection.findOneAndUpdate(
            { firebaseUserId, appId },
            { $set: updateFields },
            { returnDocument: 'after' }
        );

        if (!result) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'User not found',
                    message: `No user found with firebaseUserId '${firebaseUserId}' and appId '${appId}'`,
                    timestamp: new Date().toISOString()
                })
            };
        }

        context.log(`[USERLOGIN UPDATE] firebaseUserId: ${firebaseUserId}, updatedFields: ${Object.keys(updateFields).join(', ')}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: result
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

app.http('UserLogins_UpdateUserInfo', {
    methods: ['PUT', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'userlogins/updateUserInfo',
    handler: standardMiddleware(userLoginsUpdateUserInfoHandler)
});

/**
 * PUT /api/userlogins/{firebaseUserId}/roles
 * Update user's roles by validating and setting roleIds
 *
 * Path Parameters:
 * - firebaseUserId: Firebase user ID
 *
 * Body:
 * - roleIds: Array of role ID strings (required)
 * - appId: Application ID (default: "1")
 *
 * Response: { success: true, data: { ...updatedUser } }
 */
async function userLoginsUpdateRolesHandler(request, context) {
    const firebaseUserId = request.params.firebaseUserId;
    context.log(`UserLogins_UpdateRoles: Request for firebaseUserId=${firebaseUserId}`);

    let mongoClient;

    try {
        const body = await request.json();
        const { roleIds, appId = '1' } = body;

        if (!firebaseUserId) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'firebaseUserId path parameter is required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        if (!roleIds || !Array.isArray(roleIds)) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'roleIds must be an array',
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
        const userLoginsCollection = db.collection('userlogins');
        const rolesCollection = db.collection('roles');

        // Validate each roleId exists in the roles collection
        const roleObjectIds = roleIds.map(id => new ObjectId(id));
        const validRoles = await rolesCollection
            .find({ _id: { $in: roleObjectIds } })
            .toArray();

        if (validRoles.length !== roleIds.length) {
            const validIds = new Set(validRoles.map(r => r._id.toString()));
            const invalidIds = roleIds.filter(id => !validIds.has(id));
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: `Invalid roleIds: ${invalidIds.join(', ')}`,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Update user's roleIds
        const result = await userLoginsCollection.findOneAndUpdate(
            { firebaseUserId, appId },
            {
                $set: {
                    roleIds: roleObjectIds,
                    updatedAt: new Date()
                }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'User not found',
                    message: `No user found with firebaseUserId '${firebaseUserId}' and appId '${appId}'`,
                    timestamp: new Date().toISOString()
                })
            };
        }

        context.log(`[USERLOGIN ROLES UPDATE] firebaseUserId: ${firebaseUserId}, roleIds: [${roleIds.join(', ')}]`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: result
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

app.http('UserLogins_UpdateRoles', {
    methods: ['PUT', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'userlogins/{firebaseUserId}/roles',
    handler: standardMiddleware(userLoginsUpdateRolesHandler)
});

/**
 * POST /api/userlogins/activate-organizer
 * Activate Regional Organizer status for a user (self-only, Firebase auth required)
 *
 * Body:
 * - firebaseUserId: Firebase user ID (required, must match authenticated user)
 * - appId: Application ID (default: "1")
 *
 * Response: { success: true, data: { ...updatedUser } }
 */
async function userLoginsActivateOrganizerHandler(request, context) {
    context.log('UserLogins_ActivateOrganizer: Request received');

    // Authenticate via Firebase
    const user = await firebaseAuth(request, context);
    if (!user) {
        return unauthorizedResponse();
    }

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

        // Verify the authenticated user matches the requested firebaseUserId (self-only activation)
        if (user.uid !== firebaseUserId) {
            return {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Forbidden',
                    message: 'You can only activate your own organizer status',
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
        const userLoginsCollection = db.collection('userlogins');

        // Update user's regionalOrganizerInfo to activate
        const result = await userLoginsCollection.findOneAndUpdate(
            { firebaseUserId, appId },
            {
                $set: {
                    'regionalOrganizerInfo.isActive': true,
                    'regionalOrganizerInfo.isEnabled': true,
                    'regionalOrganizerInfo.isApproved': true,
                    'regionalOrganizerInfo.ApprovalDate': new Date(),
                    updatedAt: new Date()
                }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'User not found',
                    message: `No user found with firebaseUserId '${firebaseUserId}' and appId '${appId}'`,
                    timestamp: new Date().toISOString()
                })
            };
        }

        context.log(`[USERLOGIN ACTIVATE ORGANIZER] firebaseUserId: ${firebaseUserId}, appId: ${appId}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: result
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

app.http('UserLogins_ActivateOrganizer', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'userlogins/activate-organizer',
    handler: standardMiddleware(userLoginsActivateOrganizerHandler)
});
