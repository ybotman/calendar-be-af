// src/functions/Geo_GoogleGeolocate.js
// Domain: Geo - Google Geolocation API (WiFi/Cell Tower Positioning)
const { app } = require('@azure/functions');
const { standardMiddleware } = require('../middleware');

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
 * Body Parameters:
 * - considerIp: boolean - Whether to use IP address as fallback (default: true)
 * - wifiAccessPoints: array - WiFi networks visible to device (optional)
 * - cellTowers: array - Cell tower information (optional)
 *
 * Returns:
 * - location: Object with lat/lng coordinates
 * - accuracy: Number in meters (radius of confidence)
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
 *     "accuracy": 20.0
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
    context.log('Geo_GoogleGeolocate: Request received');

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
            lat: data.location?.lat,
            lng: data.location?.lng,
            accuracy: data.accuracy
        });

        // Return success response
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: {
                    location: data.location,
                    accuracy: data.accuracy
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
