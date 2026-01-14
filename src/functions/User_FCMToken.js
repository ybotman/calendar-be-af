const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');
const { standardMiddleware } = require('../middleware');

/**
 * Firebase Cloud Messaging Token Storage
 *
 * @description Stores FCM tokens for push notifications
 * Supports multiple devices per user (tokens array)
 * Used for State 3A/4A notification features (TIEMPO-329)
 *
 * @route POST /api/user/fcm-token
 * @auth Required (Firebase Bearer token)
 *
 * @param {string} fcmToken - Firebase Cloud Messaging token
 * @param {string} deviceType - Device type (mobile, tablet, desktop)
 *
 * @returns {FCMTokenResponse} Success confirmation with token count
 *
 * @example
 * POST /api/user/fcm-token
 * Authorization: Bearer <firebase-token>
 * Body: { "fcmToken": "dGhpc...", "deviceType": "mobile" }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "message": "FCM token stored",
 *     "tokenCount": 2
 *   }
 * }
 */

async function fcmTokenHandler(request, context) {
    context.log('User_FCMToken: POST request received');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        };
    }

    let mongoClient;

    try {
        // Authenticate user
        const user = await firebaseAuth(request, context);
        if (!user) {
            return unauthorizedResponse();
        }

        const firebaseUid = user.uid;
        context.log(`Storing FCM token for user: ${firebaseUid}`);

        // Parse request body
        const requestBody = await request.json();
        const fcmToken = requestBody.fcmToken;
        const deviceType = requestBody.deviceType || 'unknown';
        const appId = requestBody.appId || '1';

        // Validate FCM token
        if (!fcmToken || typeof fcmToken !== 'string') {
            return {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'fcmToken is required and must be a string',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Basic FCM token format validation (Firebase tokens are long base64-ish strings)
        if (fcmToken.length < 100) {
            return {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'Invalid FCM token format (too short)',
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
        const usersCollection = db.collection('userlogins');

        // Find user by firebaseUid and appId
        const existingUser = await usersCollection.findOne({ firebaseUid: firebaseUid, appId });

        if (!existingUser) {
            return {
                status: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'UserNotFound',
                    message: 'User profile not found. Please complete registration.',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Check if token already exists (avoid duplicates)
        const existingTokens = existingUser.fcmTokens || [];
        const tokenExists = existingTokens.some(t => t.token === fcmToken);

        if (tokenExists) {
            // Update existing token's lastUpdated timestamp
            await usersCollection.updateOne(
                {
                    firebaseUid: firebaseUid,
                    appId,
                    'fcmTokens.token': fcmToken
                },
                {
                    $set: {
                        'fcmTokens.$.lastUpdated': new Date(),
                        'fcmTokens.$.deviceType': deviceType
                    }
                }
            );

            context.log(`FCM token updated for user: ${firebaseUid}`);

            return {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                },
                body: JSON.stringify({
                    success: true,
                    data: {
                        message: 'FCM token updated',
                        tokenCount: existingTokens.length
                    },
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Add new token to array (supports multiple devices)
        const newToken = {
            token: fcmToken,
            deviceType: deviceType,
            addedAt: new Date(),
            lastUpdated: new Date()
        };

        await usersCollection.updateOne(
            { firebaseUid: firebaseUid, appId },
            {
                $push: {
                    fcmTokens: {
                        $each: [newToken],
                        $position: 0, // Add to beginning of array
                        $slice: 5 // Keep only last 5 tokens (limit per user)
                    }
                },
                $set: {
                    updatedAt: new Date()
                }
            }
        );

        const tokenCount = Math.min(existingTokens.length + 1, 5);
        context.log(`FCM token stored for user: ${firebaseUid} (total: ${tokenCount})`);

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: JSON.stringify({
                success: true,
                data: {
                    message: 'FCM token stored',
                    tokenCount: tokenCount
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
app.http('User_FCMToken', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'user/fcm-token',
    handler: standardMiddleware(fcmTokenHandler)
});
