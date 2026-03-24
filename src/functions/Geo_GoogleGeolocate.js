// src/functions/Geo_GoogleGeolocate.js
// Domain: Geo - Google Geolocation API (WiFi/Cell Tower Positioning)
const { app } = require('@azure/functions');
const { standardMiddleware } = require('../middleware');

// ============================================================================
// IP-Based Caching & Rate Limiting
// - Cache TTL: 5 minutes (users don't move that fast)
// - Rate limit: 10 requests per minute per IP
// - Prevents 429 errors from Google API
// ============================================================================
const CACHE_TTL_MS = 5 * 60 * 1000;        // 5 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 1000;    // 1 minute
const RATE_LIMIT_MAX = 10;                  // max requests per window
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // cleanup every 10 minutes

// In-memory cache: IP -> { location, accuracy, timestamp }
const geoCache = new Map();

// Rate limit tracking: IP -> { count, windowStart }
const rateLimitMap = new Map();

// Cache stats for monitoring
let cacheStats = { hits: 0, misses: 0, rateLimited: 0 };

// Cleanup old entries periodically to prevent memory leak
let lastCleanup = Date.now();
function cleanupCache() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

    lastCleanup = now;
    let cleaned = 0;

    for (const [ip, entry] of geoCache) {
        if (now - entry.timestamp > CACHE_TTL_MS) {
            geoCache.delete(ip);
            cleaned++;
        }
    }

    for (const [ip, entry] of rateLimitMap) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
            rateLimitMap.delete(ip);
        }
    }

    if (cleaned > 0) {
        console.log(`Geo_GoogleGeolocate: Cleaned ${cleaned} expired cache entries`);
    }
}

// Get client IP from request headers
function getClientIP(request) {
    // Azure Functions / proxies set x-forwarded-for
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
        // Take first IP if multiple (client, proxy1, proxy2...)
        return forwarded.split(',')[0].trim().split(':')[0];
    }
    // Fallback to x-real-ip or unknown
    return request.headers.get('x-real-ip') || 'unknown';
}

// Check and update rate limit for IP
function checkRateLimit(ip) {
    const now = Date.now();
    let entry = rateLimitMap.get(ip);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        // New window
        entry = { count: 1, windowStart: now };
        rateLimitMap.set(ip, entry);
        return true; // allowed
    }

    if (entry.count >= RATE_LIMIT_MAX) {
        return false; // rate limited
    }

    entry.count++;
    return true; // allowed
}

/**
 * Google Geolocation API - WiFi/Cell Tower Based Location
 *
 * @description Proxy to Google Geolocation API that uses WiFi access points and cell towers
 * to determine device location. More accurate than IP-based geolocation.
 *
 * This is DIFFERENT from Geocoding API:
 * - Geocoding: Address ↔ Coordinates (text to location)
 * - Geolocation: WiFi/Cell towers → Location (signal positioning)
 *
 * Use Cases:
 * - Get user's location when GPS is unavailable or denied
 * - Indoor positioning where GPS signal is weak
 * - Fallback positioning method in 3-tier geolocation strategy
 * - More accurate than IP-based geolocation
 *
 * Caching & Rate Limiting (added 2026-03-24):
 * - Results cached by client IP for 5 minutes
 * - Max 10 requests per minute per IP
 * - Reduces Google API costs and prevents 429 errors
 *
 * Body Parameters:
 * - considerIp: boolean - Whether to use IP address as fallback (default: true)
 * - wifiAccessPoints: array - WiFi networks visible to device (optional)
 * - cellTowers: array - Cell tower information (optional)
 *
 * Returns:
 * - location: Object with lat/lng coordinates
 * - accuracy: Number in meters (radius of confidence)
 * - cached: Boolean indicating if result was from cache
 *
 * @example
 * POST /api/geo/google-geolocate
 * Body: { "considerIp": true }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "location": {
 *       "lat": 37.4224764,
 *       "lng": -122.0842499
 *     },
 *     "accuracy": 20.0,
 *     "cached": false
 *   }
 * }
 *
 * @example Advanced with WiFi
 * POST /api/geo/google-geolocate
 * Body: {
 *   "considerIp": true,
 *   "wifiAccessPoints": [
 *     {
 *       "macAddress": "01:23:45:67:89:AB",
 *       "signalStrength": -65,
 *       "channel": 11
 *     }
 *   ]
 * }
 */
async function geoGoogleGeolocateHandler(request, context) {
    const clientIP = getClientIP(request);
    context.log('Geo_GoogleGeolocate: Request received', { clientIP });

    // Run periodic cleanup
    cleanupCache();

    try {
        // Parse request body
        let requestBody;
        try {
            requestBody = await request.json();
        } catch (error) {
            context.log('Error parsing request body:', error.message);
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid JSON in request body',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // ================================================================
        // CHECK CACHE FIRST
        // ================================================================
        const now = Date.now();
        const cached = geoCache.get(clientIP);

        if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
            // Cache hit - return cached result
            cacheStats.hits++;
            const cacheAgeSeconds = Math.round((now - cached.timestamp) / 1000);
            context.log('Geo_GoogleGeolocate: CACHE HIT', {
                clientIP,
                cacheAgeSeconds,
                totalHits: cacheStats.hits,
                totalMisses: cacheStats.misses
            });

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    data: {
                        location: cached.location,
                        accuracy: cached.accuracy,
                        cached: true,
                        cacheAgeSeconds
                    },
                    timestamp: new Date().toISOString()
                })
            };
        }

        // ================================================================
        // CHECK RATE LIMIT
        // ================================================================
        if (!checkRateLimit(clientIP)) {
            cacheStats.rateLimited++;
            context.log('Geo_GoogleGeolocate: RATE LIMITED', {
                clientIP,
                totalRateLimited: cacheStats.rateLimited
            });

            // If we have stale cache, return it instead of error
            if (cached) {
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success: true,
                        data: {
                            location: cached.location,
                            accuracy: cached.accuracy,
                            cached: true,
                            stale: true,
                            rateLimited: true
                        },
                        timestamp: new Date().toISOString()
                    })
                };
            }

            // No cache available, return 429
            return {
                status: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': '60'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'Rate limit exceeded. Max 10 requests per minute.',
                    retryAfter: 60,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Cache miss - will call Google API
        cacheStats.misses++;

        // Get Google API key from environment
        const googleApiKey = process.env.GOOGLE_API_KEY;
        if (!googleApiKey) {
            context.log('ERROR: GOOGLE_API_KEY not configured');
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Google API key not configured',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Build request body for Google Geolocation API
        // Default to considerIp: true if not specified
        const geolocateBody = {
            considerIp: requestBody.considerIp !== undefined ? requestBody.considerIp : true,
            ...(requestBody.wifiAccessPoints && { wifiAccessPoints: requestBody.wifiAccessPoints }),
            ...(requestBody.cellTowers && { cellTowers: requestBody.cellTowers })
        };

        context.log('Geo_GoogleGeolocate: Calling Google Geolocation API', {
            considerIp: geolocateBody.considerIp,
            hasWifi: !!requestBody.wifiAccessPoints,
            hasCellTowers: !!requestBody.cellTowers
        });

        // Call Google Geolocation API
        const url = `https://www.googleapis.com/geolocation/v1/geolocate?key=${googleApiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(geolocateBody),
            signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        // Check response status
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            context.log('Google Geolocation API error:', {
                status: response.status,
                error: errorData
            });

            return {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: errorData.error?.message || 'Google Geolocation API error',
                    details: errorData.error || null,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Parse successful response
        const data = await response.json();

        context.log('Geo_GoogleGeolocate: Location retrieved', {
            clientIP,
            lat: data.location?.lat,
            lng: data.location?.lng,
            accuracy: data.accuracy,
            cacheStats: { hits: cacheStats.hits, misses: cacheStats.misses }
        });

        // ================================================================
        // CACHE THE RESULT
        // ================================================================
        geoCache.set(clientIP, {
            location: data.location,
            accuracy: data.accuracy,
            timestamp: Date.now()
        });

        // Return success response
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: {
                    location: data.location,
                    accuracy: data.accuracy,
                    cached: false
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        context.log('ERROR in Geo_GoogleGeolocate:', error.message);
        context.error(error);

        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            })
        };
    }
}

// Register function with standard middleware
app.http('Geo_GoogleGeolocate', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'geo/google-geolocate',
    handler: standardMiddleware(geoGoogleGeolocateHandler)
});

module.exports = { geoGoogleGeolocateHandler };
