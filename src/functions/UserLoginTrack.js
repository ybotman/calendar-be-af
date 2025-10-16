const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');
const { standardMiddleware } = require('../middleware');

/**
 * User Login Tracking with Full Analytics
 *
 * @description Tracks user login events with IP geolocation data for analytics and heatmaps
 * Maintains two collections:
 * - UserLoginHistory: Immutable event log for audit trail
 * - UserLoginAnalytics: Aggregated stats for dashboards and heatmaps
 *
 * @route POST /api/user/login-track
 * @auth Required (Firebase Bearer token)
 *
 * @returns {LoginTrackResponse} Success confirmation
 *
 * @example
 * POST /api/user/login-track
 * Authorization: Bearer <firebase-token>
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "loginId": "507f1f77bcf86cd799439011",
 *     "timestamp": "2025-10-15T..."
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

// Helper: Get day of week name
function getDayOfWeek(date) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
}
async function loginTrackHandler(request, context) {
    context.log('UserLoginTrack: POST request received');

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
        context.log(`Tracking login for user: ${firebaseUid}`);

        // Extract IP address from CloudFlare headers or X-Forwarded-For
        const userIp = request.headers.get('CF-Connecting-IP')
                     || request.headers.get('X-Forwarded-For')?.split(',')[0]
                     || request.headers.get('X-Real-IP')
                     || 'unknown';

        context.log(`User IP: ${userIp}`);

        // Get geolocation data from ipinfo.io
        let geoData = null;
        const ipinfoToken = process.env.IPINFO_API_TOKEN;

        if (ipinfoToken && userIp !== 'unknown') {
            try {
                const ipinfoUrl = `https://ipinfo.io/${userIp}/json?token=${ipinfoToken}`;
                const geoResponse = await fetch(ipinfoUrl);

                if (geoResponse.ok) {
                    const data = await geoResponse.json();

                    // Parse location coordinates
                    let latitude = null;
                    let longitude = null;
                    if (data.loc) {
                        const [lat, lng] = data.loc.split(',');
                        latitude = parseFloat(lat);
                        longitude = parseFloat(lng);
                    }

                    geoData = {
                        city: data.city || null,
                        region: data.region || null,
                        country: data.country || null,
                        latitude: latitude,
                        longitude: longitude,
                        timezone: data.timezone || null,
                        postal: data.postal || null
                    };

                    context.log(`Geolocation: ${data.city}, ${data.region}, ${data.country}`);
                } else {
                    context.log(`ipinfo.io returned status: ${geoResponse.status}`);
                }
            } catch (geoError) {
                context.log.error('Error fetching geolocation:', geoError.message);
                // Continue without geo data rather than failing
            }
        } else {
            context.log('IPINFO_API_TOKEN not configured or IP is unknown');
        }

        // Extract user agent and device info
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        const deviceType = getDeviceType(userAgent);

        // Temporal data for analytics
        const loginTime = new Date();
        const dayOfWeek = getDayOfWeek(loginTime);
        const hourOfDay = loginTime.getHours();

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const loginHistoryCollection = db.collection('UserLoginHistory');
        const loginAnalyticsCollection = db.collection('UserLoginAnalytics');

        // 1. INSERT: Raw login event (immutable audit trail)
        const loginEvent = {
            firebaseUserId: firebaseUid,
            timestamp: loginTime,
            ip: userIp,
            userAgent: userAgent,
            deviceType: deviceType,
            dayOfWeek: dayOfWeek,
            hourOfDay: hourOfDay,
            ...geoData, // Spread geo data (city, region, country, lat, lng, etc.)
            createdAt: new Date()
        };

        const historyResult = await loginHistoryCollection.insertOne(loginEvent);
        context.log(`Login event tracked: ${historyResult.insertedId}`);

        // 2. UPSERT: Aggregated analytics for dashboards and heatmaps
        const locationKey = geoData?.city || 'Unknown';

        const analyticsUpdate = {
            $setOnInsert: {
                firebaseUserId: firebaseUid,
                createdAt: new Date()
            },
            $set: {
                // Update last known location
                lastKnownLocation: geoData ? {
                    ip: userIp,
                    city: geoData.city,
                    region: geoData.region,
                    country: geoData.country,
                    latitude: geoData.latitude,
                    longitude: geoData.longitude,
                    timezone: geoData.timezone,
                    updatedAt: loginTime
                } : null,
                lastLoginAt: loginTime,
                updatedAt: new Date()
            },
            $inc: {
                totalLogins: 1,
                [`devices.${deviceType}`]: 1,
                [`loginsByDayOfWeek.${dayOfWeek}`]: 1,
                [`loginsByHour.${hourOfDay}`]: 1
            },
            $min: {
                firstLoginAt: loginTime
            }
        };

        // Update location history (track up to 20 most frequent locations)
        if (geoData?.city && geoData?.latitude && geoData?.longitude) {
            // Check if this location already exists in history
            const existingAnalytics = await loginAnalyticsCollection.findOne(
                {
                    firebaseUserId: firebaseUid,
                    'locationHistory.city': locationKey
                },
                { projection: { 'locationHistory.$': 1 } }
            );

            if (existingAnalytics?.locationHistory?.[0]) {
                // Location exists - increment count and update lastSeenAt
                await loginAnalyticsCollection.updateOne(
                    {
                        firebaseUserId: firebaseUid,
                        'locationHistory.city': locationKey
                    },
                    {
                        $inc: { 'locationHistory.$.loginCount': 1 },
                        $set: { 'locationHistory.$.lastSeenAt': loginTime }
                    }
                );
            } else {
                // New location - add to array (limit to 20 locations)
                await loginAnalyticsCollection.updateOne(
                    { firebaseUserId: firebaseUid },
                    {
                        $push: {
                            locationHistory: {
                                $each: [{
                                    city: geoData.city,
                                    region: geoData.region,
                                    country: geoData.country,
                                    latitude: geoData.latitude,
                                    longitude: geoData.longitude,
                                    loginCount: 1,
                                    firstSeenAt: loginTime,
                                    lastSeenAt: loginTime
                                }],
                                $slice: -20, // Keep only last 20 locations
                                $sort: { loginCount: -1 } // Sort by most frequent
                            }
                        }
                    },
                    { upsert: true }
                );
            }
        }

        // Apply main analytics update
        await loginAnalyticsCollection.updateOne(
            { firebaseUserId: firebaseUid },
            analyticsUpdate,
            { upsert: true }
        );

        context.log(`Analytics updated for user: ${firebaseUid}`);

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
                    loginId: historyResult.insertedId.toString(),
                    timestamp: loginEvent.timestamp.toISOString()
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
app.http('UserLoginTrack', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'user/login-track',
    handler: standardMiddleware(loginTrackHandler)
});
