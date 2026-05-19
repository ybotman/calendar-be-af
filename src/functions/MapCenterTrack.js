const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');
const { standardMiddleware } = require('../middleware');

/**
 * MapCenter Reset Tracking
 *
 * @description Tracks when users (logged-in or anonymous) reset their map center while browsing
 * Used for analytics on MapCenter usage patterns per user session
 *
 * @route POST /api/user/mapcenter-track
 * @auth Optional (Firebase Bearer token for logged-in users, null for anonymous)
 *
 * @returns {MapCenterTrackResponse} Success confirmation
 *
 * @example
 * POST /api/user/mapcenter-track
 * Authorization: Bearer <firebase-token> (optional)
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

// Helper: Strip port from IP address
function stripPortFromIP(ip) {
    if (!ip || ip === 'unknown') return ip;
    return ip.split(':')[0].trim();
}

// CALBEAF-196: Round to 2dp — city-level precision only
const round2 = (n) => (n !== null && n !== undefined && Number.isFinite(n)) ? Math.round(n * 100) / 100 : null;

// CALBEAF-196: ASN datacenter detection (same set as VisitorTrack)
const DATACENTER_ASNS = new Set([16509, 15169, 8075, 14061, 24940, 16276, 63949, 20473]);
function extractAsn(orgString) {
    if (!orgString) return null;
    const match = orgString.match(/^AS(\d+)/);
    return match ? parseInt(match[1], 10) : null;
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
        // Authenticate user (optional - supports both logged-in and anonymous users)
        const user = await firebaseAuth(request, context);
        const firebaseUid = user ? user.uid : null;

        if (firebaseUid) {
            context.log(`Tracking MapCenter reset for logged-in user: ${firebaseUid}`);
        } else {
            context.log('Tracking MapCenter reset for anonymous user');
        }

        // Parse request body
        let requestBody = {};
        try {
            const text = await request.text();
            if (text) {
                requestBody = JSON.parse(text);
            }
        } catch (parseError) {
            context.error('Error parsing request body:', parseError.message);
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
        const appId = requestBody.appId || '1';
        const userTimezone = requestBody.timezone || null;
        const timezoneOffset = requestBody.timezoneOffset || null;

        // CALBEAF-196: cfLocation — physical user location (CF edge, distinct from mapCenter which is VIEWING)
        // Canonical 4-field contract: { city, country, lat, lng } (Archie, locked 2026-05-19)
        const cfLocationRaw = (requestBody.cfLocation && typeof requestBody.cfLocation === 'object')
            ? requestBody.cfLocation : null;
        const cfLat  = round2(typeof cfLocationRaw?.lat  === 'number' ? cfLocationRaw.lat  : null);
        const cfLng  = round2(typeof cfLocationRaw?.lng  === 'number' ? cfLocationRaw.lng  : null);
        const cfCity = typeof cfLocationRaw?.city === 'string' ? cfLocationRaw.city : null;
        if (cfLocationRaw && !(cfLat && cfLng && cfCity)) {
            context.log(`WARN CALBEAF-196: cfLocation shape mismatch — lat=${cfLocationRaw.lat} lng=${cfLocationRaw.lng} city=${cfLocationRaw.city}`);
        }

        // CALBEAF-188: FE-reported cascade tier (PascalCase enum, harmonized per TIEMPO-466)
        const cascadeSource = requestBody.cascadeSource || null;

        // CALBEAF-196: Browser GPS only — accept both new and old FE field names during transition
        const google_browser_lat      = requestBody.browser_gps_lat  || requestBody.google_browser_lat  || null;
        const google_browser_long     = requestBody.browser_gps_long || requestBody.google_browser_long || null;
        const google_browser_accuracy = requestBody.browser_gps_accuracy || requestBody.google_browser_accuracy || null;

        // Extract IP address from CloudFlare headers or X-Forwarded-For
        const rawIp = request.headers.get('CF-Connecting-IP')
                   || request.headers.get('X-Forwarded-For')?.split(',')[0]
                   || request.headers.get('X-Real-IP')
                   || 'unknown';

        const userIp = stripPortFromIP(rawIp);
        context.log(`MapCenterTrack: MapCenter: ${mapCenter.lat}, ${mapCenter.lng}`);

        // Extract user agent and device info
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        const deviceType = getDeviceType(userAgent);

        // 3-TIER GEOLOCATION SYSTEM
        const geoData = {};

        // Priority 1: Browser Geolocation (if provided by frontend)
        if (google_browser_lat && google_browser_long) {
            geoData.google_browser_lat = google_browser_lat;
            geoData.google_browser_long = google_browser_long;
            geoData.google_browser_accuracy = google_browser_accuracy;
            // Browser geolocation captured
        }

        // Priority 2: ipinfo.io Geolocation (fallback) — GoogleGeolocation tier retired (CALBEAF-196)
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
                    geoData.ipinfo_org = data.org || null; // CALBEAF-196: ASN for asnType derivation
                } else {
                    context.log(`ipinfo.io returned status: ${geoResponse.status}`);
                }
            } catch (geoError) {
                context.error('Error fetching ipinfo.io:', geoError.message);
                // Continue without ipinfo data
            }
        }

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const mapCenterHistoryCollection = db.collection('MapCenterHistory');

        // Create tracking event
        const trackingTime = new Date();

        // CALBEAF-196: 4-tier chain: GoogleBrowser → CloudflareEdge → IPInfoIO
        const asn = extractAsn(geoData.ipinfo_org);
        const asnType = asn !== null ? (DATACENTER_ASNS.has(asn) ? 'datacenter' : 'residential') : null;

        let geoSource = null;
        if (geoData.google_browser_lat && geoData.google_browser_long) {
            geoSource = 'GoogleBrowser';
        } else if (cfLat && cfLng && cfCity) {
            geoSource = 'CloudflareEdge';
        } else if (geoData.ipinfo_lat || geoData.ipinfo_city) {
            geoSource = 'IPInfoIO';
        }

        const trackingEvent = {
            firebaseUserId: firebaseUid,
            appId: appId,
            ip: userIp,
            timestamp: trackingTime,
            mapCenter: {
                latitude: mapCenter.lat,
                longitude: mapCenter.lng
            },
            page: page,
            timezone: userTimezone,
            timezoneOffset: timezoneOffset,
            ...geoData, // ipinfo_* + google_browser_* fields
            geoSource: geoSource,
            cascadeSource: cascadeSource, // CALBEAF-188: FE-reported cascade tier (PascalCase enum post-TIEMPO-466)
            cfLocation: cfLocationRaw,    // CALBEAF-196: physical user location (CF edge)
            schemaVersion: 1,             // CALBEAF-196
            asnType: asnType,             // CALBEAF-196: 'datacenter'|'residential'|null
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
