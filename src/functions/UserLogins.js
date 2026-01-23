// src/functions/UserLogins.js
// Domain: UserLogins - GET endpoint for retrieving user login by Firebase ID
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

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
