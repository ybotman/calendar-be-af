const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');

/**
 * GET /api/mapcenter
 * Retrieve user's saved map center (lat, lng, zoom) from MongoDB
 *
 * Authentication: Required (Firebase Bearer token)
 * Response: { lat: Number, lng: Number, zoom: Number } or null
 */
app.http('MapCenter_Get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'mapcenter',
    handler: async (request, context) => {
        context.log('MapCenter_Get: Request received');

        let mongoClient;

        try {
            // Authenticate user
            const user = await firebaseAuth(request, context);
            if (!user) {
                return unauthorizedResponse();
            }

            const firebaseUid = user.uid;
            context.log(`Fetching map center for user: ${firebaseUid}`);

            // Connect to MongoDB
            const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
            if (!mongoUri) {
                throw new Error('MongoDB connection string not configured');
            }

            mongoClient = new MongoClient(mongoUri);
            await mongoClient.connect();

            const db = mongoClient.db();
            const usersCollection = db.collection('Users');

            // Find user by firebaseUid
            const userDoc = await usersCollection.findOne(
                { firebaseUserId: firebaseUid },
                { projection: { mapCenter: 1 } }
            );

            if (!userDoc || !userDoc.mapCenter) {
                context.log('No map center found for user');
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: {
                        success: true,
                        data: null,
                        timestamp: new Date().toISOString()
                    }
                };
            }

            context.log('Map center retrieved successfully');
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: {
                    success: true,
                    data: userDoc.mapCenter,
                    timestamp: new Date().toISOString()
                }
            };

        } catch (error) {
            context.log.error('Error retrieving map center:', error);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: {
                    success: false,
                    error: 'Failed to retrieve map center',
                    timestamp: new Date().toISOString()
                }
            };
        } finally {
            if (mongoClient) {
                await mongoClient.close();
            }
        }
    }
});
