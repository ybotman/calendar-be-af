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

// Helper: Strip port from IP address
function stripPortFromIP(ip) {
    if (!ip || ip === 'unknown') return ip;
    // Remove port if present (e.g., "71.232.30.16:52525" → "71.232.30.16")
    return ip.split(':')[0].trim();
}

// Helper: Calculate local time from UTC and timezone offset
function getLocalTime(utcDate, timezoneOffsetMinutes) {
    if (timezoneOffsetMinutes === null) return null;

    // timezoneOffset is minutes from UTC (e.g., -240 for EDT = UTC-4)
    // To convert UTC to local time, ADD the offset (negative value subtracts)
    const localTime = new Date(utcDate.getTime() + (timezoneOffsetMinutes * 60000));
    return {
        dayOfWeek: getDayOfWeek(localTime),
        hourOfDay: localTime.getHours()
    };
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
        const userTimezone = requestBody.timezone || null; // e.g., "America/New_York"
        const timezoneOffset = requestBody.timezoneOffset || null; // e.g., -240 (minutes from UTC)

        // TIEMPO-329: Accept visitor_id UUID from frontend cookie
        const visitor_id = requestBody.visitor_id || null;

        // Extract 3-tier geolocation data from frontend
        const google_browser_lat = requestBody.google_browser_lat || null;
        const google_browser_long = requestBody.google_browser_long || null;
        const google_browser_accuracy = requestBody.google_browser_accuracy || null;
        const google_api_lat = requestBody.google_api_lat || null;
        const google_api_long = requestBody.google_api_long || null

        // Extract IP address from CloudFlare headers or X-Forwarded-For
        const rawIp = request.headers.get('CF-Connecting-IP')
                   || request.headers.get('X-Forwarded-For')?.split(',')[0]
                   || request.headers.get('X-Real-IP')
                   || 'unknown';

        // Strip port number if present (Azure sometimes includes port)
        let userIp = stripPortFromIP(rawIp);

        // LOCALHOST FALLBACK: Use 127.0.0.1 for local development testing
        if (userIp === 'unknown') {
            userIp = '127.0.0.1';
            context.log('Using localhost IP fallback for development: 127.0.0.1');
        }

        context.log(`VisitorTrack: Page: ${page}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const historyCollection = db.collection('VisitorTrackingHistory');
        const analyticsCollection = db.collection('VisitorTrackingAnalytics');

        // TIEMPO-329: Check if visitor has visited before (for entry state detection)
        let is_first_time = true;
        let is_returning = false;

        if (visitor_id) {
            // Check if this visitor_id exists in history
            const existingVisitor = await historyCollection.findOne({ visitor_id: visitor_id });

            if (existingVisitor) {
                is_first_time = false;
                is_returning = true;
                context.log(`Returning visitor: ${visitor_id}`);
            } else {
                context.log(`First-time visitor: ${visitor_id}`);
            }
        }

        // Check if this visitor was already tracked today (deduplication)
        // Priority: visitor_id > IP address
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of day (midnight)

        const deduplicationQuery = visitor_id
            ? { visitor_id: visitor_id, timestamp: { $gte: today } }
            : { ip: userIp, timestamp: { $gte: today } };

        const existingToday = await historyCollection.findOne(deduplicationQuery);

        if (existingToday) {
            const identifier = visitor_id || userIp;
            context.log(`Visitor ${identifier} already tracked today - skipping`);
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
                        is_first_time: is_first_time,
                        is_returning: is_returning,
                        visitor_id: visitor_id,
                        message: 'Already tracked today'
                    },
                    timestamp: new Date().toISOString()
                })
            };
        }

        // 3-TIER GEOLOCATION SYSTEM
        const geoData = {};

        // Priority 1: Browser Geolocation (if provided by frontend)
        if (google_browser_lat && google_browser_long) {
            geoData.google_browser_lat = google_browser_lat;
            geoData.google_browser_long = google_browser_long;
            geoData.google_browser_accuracy = google_browser_accuracy;
            // Browser geolocation captured
        }

        // Priority 2: Google API Geolocation (if provided by frontend)
        if (google_api_lat && google_api_long) {
            geoData.google_api_lat = google_api_lat;
            geoData.google_api_long = google_api_long;
            // Google API geolocation captured
        }

        // Priority 3: ipinfo.io Geolocation (fallback)
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

                    geoData.ipinfo_lat = latitude;
                    geoData.ipinfo_long = longitude;
                    geoData.ipinfo_city = data.city || null;
                    geoData.ipinfo_region = data.region || null;
                    geoData.ipinfo_country = data.country || null;
                    geoData.ipinfo_timezone = data.timezone || null;
                    geoData.ipinfo_postal = data.postal || null;

                    // ipinfo.io geolocation captured
                } else {
                    context.log(`ipinfo.io returned status: ${geoResponse.status}`);
                }
            } catch (geoError) {
                context.log.error('Error fetching ipinfo.io:', geoError.message);
                // Continue without ipinfo data
            }
        } else {
            context.log('IPINFO_API_TOKEN not configured');
        }

        // Extract user agent and device info
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        const deviceType = getDeviceType(userAgent);

        // Temporal data for analytics (UTC/Zulu time)
        const visitTime = new Date();
        const dayOfWeekZulu = getDayOfWeek(visitTime);
        const hourOfDayZulu = visitTime.getHours();

        // Calculate local time if timezone provided
        const localTime = getLocalTime(visitTime, timezoneOffset);
        const dayOfWeekLocal = localTime?.dayOfWeek || null;
        const hourOfDayLocal = localTime?.hourOfDay || null;

        // 1. INSERT: Raw visit event (immutable audit trail)
        // Determine geoSource for history record
        let historyGeoSource = null;
        if (geoData.google_browser_lat && geoData.google_browser_long) {
            historyGeoSource = 'GoogleBrowser';
        } else if (geoData.google_api_lat && geoData.google_api_long) {
            historyGeoSource = 'GoogleGeolocation';
        } else if (geoData.ipinfo_lat || geoData.ipinfo_city) {
            historyGeoSource = 'IPInfoIO';
        }

        const visitEvent = {
            visitor_id: visitor_id, // TIEMPO-329: Store visitor UUID from cookie
            ip: userIp,
            timestamp: visitTime,
            page: page,
            userAgent: userAgent,
            deviceType: deviceType,

            // UTC/Zulu time
            dayOfWeekZulu: dayOfWeekZulu,
            hourOfDayZulu: hourOfDayZulu,

            // Local browser time (if provided)
            dayOfWeekLocal: dayOfWeekLocal,
            hourOfDayLocal: hourOfDayLocal,
            timezone: userTimezone,
            timezoneOffset: timezoneOffset,

            ...geoData, // Spread geo data (city, region, country, lat, lng, timezone from ipinfo)
            geoSource: historyGeoSource, // Track which geolocation source was used
            createdAt: new Date()
        };

        const historyResult = await historyCollection.insertOne(visitEvent);
        context.log(`Visit event tracked: ${historyResult.insertedId}`);

        // 2. UPSERT: Aggregated analytics for dashboards and heatmaps
        // Determine best available location (Priority: Browser > Google API > ipinfo)
        let bestLat, bestLong, bestCity, bestRegion, bestCountry, geoSource;
        if (geoData.google_browser_lat && geoData.google_browser_long) {
            bestLat = geoData.google_browser_lat;
            bestLong = geoData.google_browser_long;
            bestCity = geoData.ipinfo_city; // Use ipinfo for city/region
            bestRegion = geoData.ipinfo_region;
            bestCountry = geoData.ipinfo_country;
            geoSource = 'GoogleBrowser';
        } else if (geoData.google_api_lat && geoData.google_api_long) {
            bestLat = geoData.google_api_lat;
            bestLong = geoData.google_api_long;
            bestCity = geoData.ipinfo_city;
            bestRegion = geoData.ipinfo_region;
            bestCountry = geoData.ipinfo_country;
            geoSource = 'GoogleGeolocation';
        } else {
            bestLat = geoData.ipinfo_lat;
            bestLong = geoData.ipinfo_long;
            bestCity = geoData.ipinfo_city;
            bestRegion = geoData.ipinfo_region;
            bestCountry = geoData.ipinfo_country;
            geoSource = 'IPInfoIO';
        }

        const analyticsUpdate = {
            $setOnInsert: {
                ip: userIp,
                visitor_id: visitor_id, // TIEMPO-329: Store visitor UUID
                createdAt: new Date()
            },
            $set: {
                // Update last known location (best available source)
                lastKnownLocation: (bestLat && bestLong) ? {
                    latitude: bestLat,
                    longitude: bestLong,
                    city: bestCity,
                    region: bestRegion,
                    country: bestCountry,
                    source: geoSource,
                    updatedAt: visitTime
                } : null,
                // Store all geolocation sources
                ...geoData,
                geoSource: geoSource, // Track which geolocation API was used
                lastVisitAt: visitTime,
                updatedAt: new Date()
            },
            $inc: {
                totalVisits: 1,
                [`pagesVisited.${page}`]: 1,
                [`devices.${deviceType}`]: 1,

                // UTC/Zulu analytics
                [`visitsByDayOfWeekZulu.${dayOfWeekZulu}`]: 1,
                [`visitsByHourZulu.${hourOfDayZulu}`]: 1,

                // Local time analytics (if provided)
                ...(dayOfWeekLocal && { [`visitsByDayOfWeekLocal.${dayOfWeekLocal}`]: 1 }),
                ...(hourOfDayLocal !== null && { [`visitsByHourLocal.${hourOfDayLocal}`]: 1 })
            },
            $min: {
                firstVisitAt: visitTime
            }
        };

        // Apply analytics update (query by visitor_id if available, else IP)
        const analyticsQuery = visitor_id ? { visitor_id: visitor_id } : { ip: userIp };
        await analyticsCollection.updateOne(
            analyticsQuery,
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
                    is_first_time: is_first_time, // TIEMPO-329: For State 1 detection
                    is_returning: is_returning,   // TIEMPO-329: For State 2 detection
                    visitor_id: visitor_id,
                    message: is_first_time ? 'First-time visitor tracked' : 'Returning visitor tracked',
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
