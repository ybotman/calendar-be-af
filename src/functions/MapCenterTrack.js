const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');
const { standardMiddleware } = require('../middleware');

/**
 * MapCenter Reset Tracking
 *
 * @description Tracks when logged-in users reset their map center while browsing
 * Used for analytics on MapCenter usage patterns per user session
 *
 * @route POST /api/user/mapcenter-track
 * @auth Required (Firebase Bearer token)
 *
 * @returns {MapCenterTrackResponse} Success confirmation
 *
 * @example
 * POST /api/user/mapcenter-track
 * Authorization: Bearer <firebase-token>
 * Body: {
 *   "mapCenter": { "lat": 42.3601, "lng": -71.0589 },
 *   "page": "/calendar/boston"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "trackingId": "507f1f77bcf86cd799439011",
 *     "timestamp": "2025-10-19T..."
 *   }
 * }
 */

// Helper: Parse device type from User-Agent
function getDeviceType(userAgent) {
    const ua = userAgent.toLowerCase();

    if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
        return 'mobile';
    }
    if (/tablet|ipad|playbook|silk|kindle/i.test(ua)) {
        return 'tablet';
    }
    return 'desktop';
}

async function mapCenterTrackHandler(request, context) {
    context.log('MapCenterTrack: POST request received');

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
        context.log(`Tracking MapCenter reset for user: ${firebaseUid}`);

        // Parse request body
        let requestBody = {};
        try {
            const text = await request.text();
            if (text) {
                requestBody = JSON.parse(text);
            }
        } catch (parseError) {
            context.log.error('Error parsing request body:', parseError.message);
            return {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid JSON in request body',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Validate required fields
        const mapCenter = requestBody.mapCenter;
        if (!mapCenter || typeof mapCenter.lat !== 'number' || typeof mapCenter.lng !== 'number') {
            return {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'mapCenter with lat and lng is required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        const page = requestBody.page || '/calendar';

        // Extract user agent and device info
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        const deviceType = getDeviceType(userAgent);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const mapCenterHistoryCollection = db.collection('MapCenterHistory');

        // Create tracking event
        const trackingTime = new Date();
        const trackingEvent = {
            firebaseUserId: firebaseUid,
            timestamp: trackingTime,
            mapCenter: {
                latitude: mapCenter.lat,
                longitude: mapCenter.lng
            },
            page: page,
            userAgent: userAgent,
            deviceType: deviceType,
            createdAt: new Date()
        };

        const result = await mapCenterHistoryCollection.insertOne(trackingEvent);
        context.log(`MapCenter reset tracked: ${result.insertedId}`);

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
                    trackingId: result.insertedId.toString(),
                    timestamp: trackingEvent.timestamp.toISOString()
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
app.http('MapCenterTrack', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'user/mapcenter-track',
    handler: standardMiddleware(mapCenterTrackHandler)
});
