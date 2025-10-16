const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * Anonymous Visitor Tracking for /calendar Routes
 *
 * @description Tracks anonymous visitors on calendar pages with IP geolocation
 * Captures once per day per IP to avoid noise
 * Maintains two collections:
 * - VisitorTrackingHistory: Immutable event log for audit trail
 * - VisitorTrackingAnalytics: Aggregated stats per IP for heatmaps
 *
 * @route POST /api/visitor/track
 * @auth None (anonymous)
 *
 * @returns {VisitorTrackResponse} Success confirmation
 *
 * @example
 * POST /api/visitor/track
 * Body: { "page": "/calendar/boston" }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "tracked": true,
 *     "message": "Visitor tracked"
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

async function visitorTrackHandler(request, context) {
    context.log('VisitorTrack: POST request received');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        };
    }

    let mongoClient;

    try {
        // Parse request body
        const requestBody = await request.json();
        const page = requestBody.page || '/calendar';

        // Extract IP address from CloudFlare headers or X-Forwarded-For
        const userIp = request.headers.get('CF-Connecting-IP')
                     || request.headers.get('X-Forwarded-For')?.split(',')[0]
                     || request.headers.get('X-Real-IP')
                     || 'unknown';

        if (userIp === 'unknown') {
            context.log('Unable to determine visitor IP');
            return {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'Unable to determine IP address',
                    timestamp: new Date().toISOString()
                })
            };
        }

        context.log(`Visitor IP: ${userIp}, Page: ${page}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const historyCollection = db.collection('VisitorTrackingHistory');
        const analyticsCollection = db.collection('VisitorTrackingAnalytics');

        // Check if this IP was already tracked today (deduplication)
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of day (midnight)

        const existingToday = await historyCollection.findOne({
            ip: userIp,
            timestamp: { $gte: today }
        });

        if (existingToday) {
            context.log(`IP ${userIp} already tracked today - skipping`);
            return {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                },
                body: JSON.stringify({
                    success: true,
                    data: {
                        tracked: false,
                        message: 'Already tracked today'
                    },
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Get geolocation data from ipinfo.io
        let geoData = null;
        const ipinfoToken = process.env.IPINFO_API_TOKEN;

        if (ipinfoToken) {
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
            context.log('IPINFO_API_TOKEN not configured');
        }

        // Extract user agent and device info
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        const deviceType = getDeviceType(userAgent);

        // Temporal data for analytics
        const visitTime = new Date();
        const dayOfWeek = getDayOfWeek(visitTime);
        const hourOfDay = visitTime.getHours();

        // 1. INSERT: Raw visit event (immutable audit trail)
        const visitEvent = {
            ip: userIp,
            timestamp: visitTime,
            page: page,
            userAgent: userAgent,
            deviceType: deviceType,
            dayOfWeek: dayOfWeek,
            hourOfDay: hourOfDay,
            ...geoData, // Spread geo data (city, region, country, lat, lng, etc.)
            createdAt: new Date()
        };

        const historyResult = await historyCollection.insertOne(visitEvent);
        context.log(`Visit event tracked: ${historyResult.insertedId}`);

        // 2. UPSERT: Aggregated analytics for dashboards and heatmaps
        const analyticsUpdate = {
            $setOnInsert: {
                ip: userIp,
                createdAt: new Date()
            },
            $set: {
                // Update last known location
                lastKnownLocation: geoData ? {
                    city: geoData.city,
                    region: geoData.region,
                    country: geoData.country,
                    latitude: geoData.latitude,
                    longitude: geoData.longitude,
                    timezone: geoData.timezone,
                    updatedAt: visitTime
                } : null,
                lastVisitAt: visitTime,
                updatedAt: new Date()
            },
            $inc: {
                totalVisits: 1,
                [`pagesVisited.${page}`]: 1,
                [`devices.${deviceType}`]: 1,
                [`visitsByDayOfWeek.${dayOfWeek}`]: 1,
                [`visitsByHour.${hourOfDay}`]: 1
            },
            $min: {
                firstVisitAt: visitTime
            }
        };

        // Apply analytics update
        await analyticsCollection.updateOne(
            { ip: userIp },
            analyticsUpdate,
            { upsert: true }
        );

        context.log(`Analytics updated for IP: ${userIp}`);

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({
                success: true,
                data: {
                    tracked: true,
                    message: 'Visitor tracked successfully',
                    visitId: historyResult.insertedId.toString()
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
app.http('VisitorTrack', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'visitor/track',
    handler: standardMiddleware(visitorTrackHandler)
});
