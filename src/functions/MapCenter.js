const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const Joi = require('joi');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');
const { standardMiddleware } = require('../middleware');

/**
 * Combined MapCenter endpoint - handles both GET and PUT
 * GET /api/mapcenter - Retrieve user's map center
 * PUT /api/mapcenter - Save user's map center
 *
 * Authentication: Required (Firebase Bearer token)
 */

// Joi validation schema for PUT requests
const mapCenterSchema = Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
    zoom: Joi.number().integer().min(1).max(20).optional(), // Map zoom level (visual)
    radiusMiles: Joi.number().min(5).max(200).optional() // Search radius in miles
});

// Handler function
async function mapCenterHandler(request, context) {
    context.log(`MapCenter: ${request.method} request received`);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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

        // Get appId from query (GET) or we'll get it from body (PUT)
        const appId = request.query.get('appId') || '1';

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const usersCollection = db.collection('userlogins');

        // Handle GET request
        if (request.method === 'GET') {
            context.log(`Fetching map center for user: ${firebaseUid}`);

            const userDoc = await usersCollection.findOne(
                { firebaseUserId: firebaseUid, appId },
                { projection: { mapCenter: 1 } }
            );

            if (!userDoc || !userDoc.mapCenter) {
                context.log('No map center found for user');
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success: true,
                        data: null,
                        timestamp: new Date().toISOString()
                    })
                };
            }

            context.log('Map center retrieved successfully');
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    data: userDoc.mapCenter,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Handle PUT request
        if (request.method === 'PUT') {
            context.log(`Saving map center for user: ${firebaseUid}`);

            // Parse and validate request body
            const requestBody = await request.json();
            const { error, value } = mapCenterSchema.validate(requestBody);

            // Get appId from body (overrides query param for PUT)
            const putAppId = requestBody.appId || appId;

            if (error) {
                context.log('Validation error:', error.details[0].message);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success: false,
                        error: error.details[0].message,
                        timestamp: new Date().toISOString()
                    })
                };
            }

            // Prepare map center data
            const mapCenterData = {
                lat: value.lat,
                lng: value.lng,
                zoom: value.zoom || 10, // Default map zoom if not provided
                radiusMiles: value.radiusMiles || 50, // Default search radius
                updatedAt: new Date()
            };

            // Update user's map center (upsert: create if doesn't exist)
            const result = await usersCollection.updateOne(
                { firebaseUserId: firebaseUid, appId: putAppId },
                {
                    $set: { mapCenter: mapCenterData },
                    $setOnInsert: {
                        firebaseUserId: firebaseUid,
                        appId: putAppId,
                        createdAt: new Date()
                    }
                },
                { upsert: true } // Create document if it doesn't exist
            );

            context.log(result.upsertedCount > 0
                ? 'User record created with map center'
                : 'Map center updated for existing user');

            context.log('Map center saved successfully');
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    data: mapCenterData,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Method not allowed
        return {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Method not allowed',
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
app.http('MapCenter', {
    methods: ['GET', 'PUT', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'mapcenter',
    handler: standardMiddleware(mapCenterHandler)
});
