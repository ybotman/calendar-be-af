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

        // Parse request body for timezone data (optional)
        let requestBody = {};
        try {
            const text = await request.text();
            if (text) {
                requestBody = JSON.parse(text);
            }
        } catch (parseError) {
            // Body is optional, continue without it
            context.log('No request body or invalid JSON');
        }

        const userTimezone = requestBody.timezone || null; // e.g., "America/New_York"
        const timezoneOffset = requestBody.timezoneOffset || null; // e.g., -240 (minutes from UTC)
        const appId = requestBody.appId || '1'; // Application ID (1=TangoTiempo, 2=HarmonyJunction)

        // CALBEAF-191: physical user location from CF edge headers forwarded by FE.
        // Stored on both UserLoginHistory (event log) and userlogins profile (lastKnownLocation).
        const userLocation = (requestBody.userLocation && typeof requestBody.userLocation === 'object')
            ? requestBody.userLocation
            : null;

        // Extract 3-tier geolocation data from frontend
        const google_browser_lat = requestBody.google_browser_lat || null;
        const google_browser_long = requestBody.google_browser_long || null;
        const google_browser_accuracy = requestBody.google_browser_accuracy || null;
        const google_api_lat = requestBody.google_api_lat || null;
        const google_api_long = requestBody.google_api_long || null;

        // Extract IP address from CloudFlare headers or X-Forwarded-For
        const rawIp = request.headers.get('CF-Connecting-IP')
                   || request.headers.get('X-Forwarded-For')?.split(',')[0]
                   || request.headers.get('X-Real-IP')
                   || 'unknown';

        // Strip port number if present (Azure sometimes includes port)
        const userIp = stripPortFromIP(rawIp);

        // IP stored in DB but not logged (PII)

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
                context.error('Error fetching ipinfo.io:', geoError.message);
                // Continue without ipinfo data
            }
        } else {
            context.log('IPINFO_API_TOKEN not configured or IP is unknown');
        }

        // Extract user agent and device info
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        const deviceType = getDeviceType(userAgent);

        // Temporal data for analytics (UTC/Zulu time)
        const loginTime = new Date();
        const dayOfWeekZulu = getDayOfWeek(loginTime);
        const hourOfDayZulu = loginTime.getHours();

        // Calculate local time if timezone provided
        const localTime = getLocalTime(loginTime, timezoneOffset);
        const dayOfWeekLocal = localTime?.dayOfWeek || null;
        const hourOfDayLocal = localTime?.hourOfDay || null;

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const loginHistoryCollection = db.collection('UserLoginHistory');
        const loginAnalyticsCollection = db.collection('UserLoginAnalytics');
        const usersCollection = db.collection('userlogins');

        // TIEMPO-329: Detect first-time login for entry state detection
        const priorLoginCount = await loginHistoryCollection.countDocuments({ firebaseUserId: firebaseUid, appId });
        const isFirstLogin = priorLoginCount === 0;

        if (isFirstLogin) {
            context.log(`First-time login for user: ${firebaseUid}`);
        } else {
            context.log(`Returning user login: ${firebaseUid} (${priorLoginCount} prior logins)`);
        }

        // TIEMPO-329: Get user role for personalized entry flow
        let userRole = 'Milonguero'; // Default role (80% of users)
        const userProfile = await usersCollection.findOne(
            { firebaseUid: firebaseUid, appId },
            { projection: { roles: 1, backendInfo: 1 } }
        );

        if (userProfile) {
            // Check if user is an Event Organizer
            const isOrganizer = userProfile.roles?.includes('RegionalOrganizer') &&
                                userProfile.backendInfo?.regionalOrganizerInfo?.isEnabled === true;

            if (isOrganizer) {
                userRole = 'EventOrganizer';
                context.log(`User role: EventOrganizer (${userProfile.backendInfo.regionalOrganizerInfo.organizerId})`);
            } else {
                context.log(`User role: Milonguero (event consumer)`);
            }
        }

        // 1. INSERT: Raw login event (immutable audit trail)
        // Determine geoSource for history record
        let historyGeoSource = null;
        if (geoData.google_browser_lat && geoData.google_browser_long) {
            historyGeoSource = 'GoogleBrowser';
        } else if (geoData.google_api_lat && geoData.google_api_long) {
            historyGeoSource = 'GoogleGeolocation';
        } else if (geoData.ipinfo_lat || geoData.ipinfo_city) {
            historyGeoSource = 'IPInfoIO';
        }

        const loginEvent = {
            firebaseUserId: firebaseUid,
            appId: appId,
            timestamp: loginTime,
            ip: userIp,
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
            userLocation: userLocation, // CALBEAF-191: physical CF edge location forwarded by FE
            createdAt: new Date()
        };

        const historyResult = await loginHistoryCollection.insertOne(loginEvent);
        context.log(`Login event tracked: ${historyResult.insertedId}`);

        // 2. UPSERT: Aggregated analytics for dashboards and heatmaps
        // Determine best available location (Priority: Browser > Google API > CloudflareEdge > IPInfoIO)
        // CALBEAF-193: CloudflareEdge added between GoogleGeolocation and IPInfoIO.
        // CF geo arrives via FE POST body (userLocation) — Azure BE is not behind CF so headers
        // cannot be read server-side.
        //
        // Typed contract for userLocation (must match FE JSDoc @typedef in layout.js):
        //   Current (v1.28.3): { lat: number, lng: number, city: string, country: string }
        //   TIEMPO-462 extends: + source, confidence, cascadeLevel, region
        const cfLat        = typeof userLocation?.lat        === 'number' ? userLocation.lat        : null;
        const cfLng        = typeof userLocation?.lng        === 'number' ? userLocation.lng        : null;
        const cfCity       = typeof userLocation?.city       === 'string' ? userLocation.city       : null;
        const cfRegion     = typeof userLocation?.region     === 'string' ? userLocation.region     : null;
        const cfCountry    = typeof userLocation?.country    === 'string' ? userLocation.country    : null;
        const cfConfidence = typeof userLocation?.confidence === 'number' ? userLocation.confidence : null;

        // Loud warning: userLocation present but required fields missing — indicates FE contract drift
        if (userLocation && !(cfLat && cfLng && cfCity)) {
            context.log(`WARN CALBEAF-193: userLocation shape mismatch — lat=${userLocation.lat} lng=${userLocation.lng} city=${userLocation.city}; falling through to IPInfoIO`);
        }

        let bestLat, bestLong, bestCity, bestRegion, bestCountry, geoSource, bestConfidence;
        if (geoData.google_browser_lat && geoData.google_browser_long) {
            bestLat = geoData.google_browser_lat;
            bestLong = geoData.google_browser_long;
            bestCity = geoData.ipinfo_city;
            bestRegion = geoData.ipinfo_region;
            bestCountry = geoData.ipinfo_country;
            bestConfidence = null;
            geoSource = 'GoogleBrowser';
        } else if (geoData.google_api_lat && geoData.google_api_long) {
            bestLat = geoData.google_api_lat;
            bestLong = geoData.google_api_long;
            bestCity = geoData.ipinfo_city;
            bestRegion = geoData.ipinfo_region;
            bestCountry = geoData.ipinfo_country;
            bestConfidence = null;
            geoSource = 'GoogleGeolocation';
        } else if (cfLat && cfLng && cfCity) {
            bestLat = cfLat;
            bestLong = cfLng;
            bestCity = cfCity;
            bestRegion = cfRegion;
            bestCountry = cfCountry;
            bestConfidence = cfConfidence;
            geoSource = 'CloudflareEdge';
        } else {
            bestLat = geoData.ipinfo_lat;
            bestLong = geoData.ipinfo_long;
            bestCity = geoData.ipinfo_city;
            bestRegion = geoData.ipinfo_region;
            bestCountry = geoData.ipinfo_country;
            bestConfidence = null;
            geoSource = 'IPInfoIO';
        }

        const locationKey = bestCity || 'Unknown';

        const analyticsUpdate = {
            $setOnInsert: {
                firebaseUserId: firebaseUid,
                appId: appId,
                createdAt: new Date()
            },
            $set: {
                // Update current IP (can change with each login)
                ip: userIp,

                // Update last known location (best available source)
                lastKnownLocation: (bestLat && bestLong) ? {
                    latitude: bestLat,
                    longitude: bestLong,
                    city: bestCity,
                    region: bestRegion,
                    country: bestCountry,
                    source: geoSource,
                    confidence: bestConfidence,
                    updatedAt: loginTime
                } : null,
                // Store all geolocation sources
                ...geoData,
                geoSource: geoSource, // Track which geolocation API was used
                lastLoginAt: loginTime,
                updatedAt: new Date()
            },
            $inc: {
                totalLogins: 1,
                [`devices.${deviceType}`]: 1,

                // UTC/Zulu analytics
                [`loginsByDayOfWeekZulu.${dayOfWeekZulu}`]: 1,
                [`loginsByHourZulu.${hourOfDayZulu}`]: 1,

                // Local time analytics (if provided)
                ...(dayOfWeekLocal && { [`loginsByDayOfWeekLocal.${dayOfWeekLocal}`]: 1 }),
                ...(hourOfDayLocal !== null && { [`loginsByHourLocal.${hourOfDayLocal}`]: 1 })
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
                    appId,
                    'locationHistory.city': locationKey
                },
                { projection: { 'locationHistory.$': 1 } }
            );

            if (existingAnalytics?.locationHistory?.[0]) {
                // Location exists - increment count and update lastSeenAt
                await loginAnalyticsCollection.updateOne(
                    {
                        firebaseUserId: firebaseUid,
                        appId,
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
                    { firebaseUserId: firebaseUid, appId },
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
            { firebaseUserId: firebaseUid, appId },
            analyticsUpdate,
            { upsert: true }
        );

        // CALBEAF-191: Persist lastKnownLocation on user profile (userlogins doc).
        // Only writes when userLocation present in POST body — never clears an existing value.
        if (userLocation) {
            await usersCollection.updateOne(
                { firebaseUserId: firebaseUid, appId },
                {
                    $set: {
                        lastKnownLocation: {
                            city: userLocation.city || null,
                            lat: userLocation.lat || null,
                            lng: userLocation.lng || null,
                            country: userLocation.country || null,
                            region: userLocation.region || null,
                            source: userLocation.source || null,
                            confidence: userLocation.confidence ?? null,
                            updatedAt: loginTime
                        },
                        updatedAt: new Date()
                    }
                }
            );
            context.log(`lastKnownLocation updated for user: ${firebaseUid} → ${userLocation.city}, ${userLocation.country}`);
        }

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
                    isFirstLogin: isFirstLogin,     // TIEMPO-329: For State 4A/4B detection
                    userRole: userRole,             // TIEMPO-329: Milonguero or EventOrganizer
                    timestamp: loginEvent.timestamp.toISOString()
                },
                timestamp: new Date().toISOString()
            })
        };

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
