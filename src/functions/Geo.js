// src/functions/Geo.js
// Domain: Geo - Google Geocoding and Timezone API endpoints
const { app } = require('@azure/functions');
const { standardMiddleware } = require('../middleware');

// ============================================
// FUNCTION 1: GET /api/geo/reverse
// ============================================

/**
 * Reverse Geocoding - Convert Coordinates to Address + Timezone
 *
 * @description Takes lat/lng from browser geolocation and returns full address details + timezone
 * Used when: User visits site and we capture their location
 *
 * Query Parameters:
 * - lat: Latitude (required)
 * - lng: Longitude (required)
 *
 * Returns:
 * - address: Full formatted address
 * - city: City name
 * - state: State/Province
 * - country: Country name
 * - countryCode: Country code (US, CA, etc)
 * - postalCode: ZIP/Postal code
 * - timezone: Timezone ID (America/New_York)
 * - timezoneOffset: UTC offset in seconds
 *
 * @example
 * GET /api/geo/reverse?lat=42.3584&lng=-71.0598
 *
 * Response:
 * {
 *   "address": "Boston, MA 02108, USA",
 *   "city": "Boston",
 *   "state": "Massachusetts",
 *   "country": "United States",
 *   "countryCode": "US",
 *   "postalCode": "02108",
 *   "timezone": "America/New_York",
 *   "timezoneOffset": -18000,
 *   "lat": 42.3584,
 *   "lng": -71.0598
 * }
 */
async function geoReverseHandler(request, context) {
    const lat = request.query.get('lat');
    const lng = request.query.get('lng');

    context.log('Geo_Reverse: Request received', { lat, lng });

    // Validate required parameters
    if (!lat || !lng) {
        context.log('Missing lat or lng in reverse geocoding request');
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'lat and lng parameters are required',
                timestamp: new Date().toISOString()
            })
        };
    }

    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey) {
        throw new Error('GOOGLE_API_KEY not configured');
    }

    // Call Google Geocoding API (reverse)
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleApiKey}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK' || !geocodeData.results || geocodeData.results.length === 0) {
        context.log('Geocoding API error:', geocodeData.status);
        return {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Address not found for coordinates',
                timestamp: new Date().toISOString()
            })
        };
    }

    // Parse address components
    const result = geocodeData.results[0];
    const addressComponents = result.address_components;

    const address = {
        formatted: result.formatted_address,
        street: null,
        city: null,
        state: null,
        stateCode: null,
        country: null,
        countryCode: null,
        postalCode: null
    };

    // Extract components
    addressComponents.forEach(component => {
        const types = component.types;
        if (types.includes('street_number')) {
            address.street = component.long_name;
        }
        if (types.includes('route')) {
            address.street = address.street
                ? `${address.street} ${component.long_name}`
                : component.long_name;
        }
        if (types.includes('locality')) {
            address.city = component.long_name;
        }
        if (types.includes('administrative_area_level_1')) {
            address.state = component.long_name;
            address.stateCode = component.short_name;
        }
        if (types.includes('country')) {
            address.country = component.long_name;
            address.countryCode = component.short_name;
        }
        if (types.includes('postal_code')) {
            address.postalCode = component.long_name;
        }
    });

    // Call Google Timezone API
    const timestamp = Math.floor(Date.now() / 1000);
    const timezoneUrl = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${googleApiKey}`;
    const timezoneResponse = await fetch(timezoneUrl);
    const timezoneData = await timezoneResponse.json();

    let timezone = null;
    if (timezoneData.status === 'OK') {
        timezone = {
            id: timezoneData.timeZoneId,
            name: timezoneData.timeZoneName,
            offset: timezoneData.rawOffset + timezoneData.dstOffset
        };
    }

    context.log('Reverse geocoding successful:', address.city, address.state);

    return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: true,
            data: {
                address: address.formatted,
                street: address.street,
                city: address.city,
                state: address.state,
                stateCode: address.stateCode,
                country: address.country,
                countryCode: address.countryCode,
                postalCode: address.postalCode,
                timezone: timezone?.id || null,
                timezoneName: timezone?.name || null,
                timezoneOffset: timezone?.offset || null,
                lat: parseFloat(lat),
                lng: parseFloat(lng)
            },
            timestamp: new Date().toISOString()
        })
    };
}

// Register function with standard middleware
app.http('Geo_Reverse', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'geo/reverse',
    handler: standardMiddleware(geoReverseHandler)
});

// ============================================
// FUNCTION 2: GET /api/geo/geocode
// ============================================

/**
 * Forward Geocoding - Convert Address to Coordinates
 *
 * @description Takes address string and returns lat/lng coordinates
 * Used when: Adding/editing venues in the FE
 *
 * Query Parameters:
 * - address: Address string (required)
 *
 * Returns:
 * - lat: Latitude
 * - lng: Longitude
 * - formatted_address: Cleaned up address
 *
 * @example
 * GET /api/geo/geocode?address=123+Main+St+Boston+MA
 *
 * Response:
 * {
 *   "lat": 42.3584,
 *   "lng": -71.0598,
 *   "address": "123 Main St, Boston, MA 02108, USA"
 * }
 */
async function geoGeocodeHandler(request, context) {
    const address = request.query.get('address');

    context.log('Geo_Geocode: Request received', { address });

    // Validate required parameters
    if (!address) {
        context.log('Missing address in geocoding request');
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'address parameter is required',
                timestamp: new Date().toISOString()
            })
        };
    }

    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey) {
        throw new Error('GOOGLE_API_KEY not configured');
    }

    // Call Google Geocoding API (forward)
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleApiKey}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK' || !geocodeData.results || geocodeData.results.length === 0) {
        context.log('Geocoding API error:', geocodeData.status);
        return {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Address not found',
                timestamp: new Date().toISOString()
            })
        };
    }

    const result = geocodeData.results[0];
    const location = result.geometry.location;

    context.log('Geocoding successful:', location);

    return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: true,
            data: {
                lat: location.lat,
                lng: location.lng,
                address: result.formatted_address
            },
            timestamp: new Date().toISOString()
        })
    };
}

// Register function with standard middleware
app.http('Geo_Geocode', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'geo/geocode',
    handler: standardMiddleware(geoGeocodeHandler)
});

// ============================================
// FUNCTION 3: GET /api/geo/timezone
// ============================================

/**
 * Timezone Lookup - Get timezone from coordinates
 *
 * @description Takes lat/lng and returns timezone information
 * Used when: Need timezone info without full address lookup
 *
 * Query Parameters:
 * - lat: Latitude (required)
 * - lng: Longitude (required)
 *
 * Returns:
 * - timezone: Timezone ID (America/New_York)
 * - timezoneName: Human-readable name
 * - offset: UTC offset in seconds
 *
 * @example
 * GET /api/geo/timezone?lat=42.3584&lng=-71.0598
 *
 * Response:
 * {
 *   "timezone": "America/New_York",
 *   "timezoneName": "Eastern Daylight Time",
 *   "offset": -14400
 * }
 */
async function geoTimezoneHandler(request, context) {
    const lat = request.query.get('lat');
    const lng = request.query.get('lng');

    context.log('Geo_Timezone: Request received', { lat, lng });

    // Validate required parameters
    if (!lat || !lng) {
        context.log('Missing lat or lng in timezone request');
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'lat and lng parameters are required',
                timestamp: new Date().toISOString()
            })
        };
    }

    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey) {
        throw new Error('GOOGLE_API_KEY not configured');
    }

    // Call Google Timezone API
    const timestamp = Math.floor(Date.now() / 1000);
    const timezoneUrl = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${googleApiKey}`;
    const timezoneResponse = await fetch(timezoneUrl);
    const timezoneData = await timezoneResponse.json();

    if (timezoneData.status !== 'OK') {
        context.log('Timezone API error:', timezoneData.status);
        return {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Timezone not found for coordinates',
                timestamp: new Date().toISOString()
            })
        };
    }

    const timezone = {
        id: timezoneData.timeZoneId,
        name: timezoneData.timeZoneName,
        offset: timezoneData.rawOffset + timezoneData.dstOffset
    };

    context.log('Timezone lookup successful:', timezone.id);

    return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: true,
            data: {
                timezone: timezone.id,
                timezoneName: timezone.name,
                offset: timezone.offset,
                lat: parseFloat(lat),
                lng: parseFloat(lng)
            },
            timestamp: new Date().toISOString()
        })
    };
}

// Register function with standard middleware
app.http('Geo_Timezone', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'geo/timezone',
    handler: standardMiddleware(geoTimezoneHandler)
});

// ============================================
// FUNCTION 4: GET /api/geo/ipapico/ip
// ============================================

/**
 * IP Geolocation - ipapi.co API
 *
 * @description Get geolocation data from visitor's IP using ipapi.co API
 * NOTE: This service is hitting rate limits - consider using BigDataCloud or Abstract API instead
 * Drop-in replacement for Express backend /api/firebase/geo/ip endpoint
 * (Note: "firebase" in old name was a misnomer - nothing to do with Firebase)
 *
 * Use Cases:
 * - Get visitor's location automatically from their IP
 * - Center map on user's location
 * - Show local events based on IP location
 *
 * Returns:
 * - ip: IP address
 * - city: City name
 * - region: State/Province
 * - country: Country code (US, CA, etc)
 * - country_name: Full country name
 * - latitude: Latitude coordinate
 * - longitude: Longitude coordinate
 * - timezone: Timezone ID
 *
 * Rate Limit Fallback:
 * - Returns US center coordinates (39.8283, -98.5795) on 429 error
 *
 * @example
 * GET /api/geo/ipapico/ip
 *
 * Response:
 * {
 *   "ip": "71.232.30.16",
 *   "city": "Boston",
 *   "region": "Massachusetts",
 *   "country": "US",
 *   "country_name": "United States",
 *   "latitude": 42.3584,
 *   "longitude": -71.0598,
 *   "timezone": "America/New_York"
 * }
 */
async function geoIpapiCoHandler(request, context) {
    context.log('Geo_IpapiCo_Get: Request received');

    try {
        // Call ipapi.co to get geolocation from IP
        const ipApiUrl = 'https://ipapi.co/json/';
        const ipApiResponse = await fetch(ipApiUrl, {
            headers: {
                'User-Agent': 'TangoTiempo/1.0'
            },
            signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        if (!ipApiResponse.ok) {
            // Handle rate limiting specifically
            if (ipApiResponse.status === 429) {
                context.log('ipapi.co rate limit exceeded');
                return {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=60' // Cache fallback for 1 minute
                    },
                    body: JSON.stringify({
                        error: 'Rate limit exceeded for location service. Please try again later.',
                        fallback: {
                            latitude: 39.8283, // US center
                            longitude: -98.5795
                        }
                    })
                };
            }

            throw new Error(`ipapi.co returned status ${ipApiResponse.status}`);
        }

        const ipApiData = await ipApiResponse.json();

        context.log('IP geolocation retrieved:', {
            ip: ipApiData.ip,
            city: ipApiData.city,
            country: ipApiData.country
        });

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
            },
            body: JSON.stringify(ipApiData)
        };

    } catch (error) {
        // Return fallback on error
        return {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=60' // Cache fallback for 1 minute
            },
            body: JSON.stringify({
                error: 'Failed to fetch geolocation data',
                message: error.message,
                fallback: {
                    latitude: 39.8283, // US center
                    longitude: -98.5795
                }
            })
        };
    }
}

// Register function with standard middleware
app.http('Geo_IpapiCo_Get', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'geo/ipapico/ip',
    handler: standardMiddleware(geoIpapiCoHandler)
});

// ============================================
// FUNCTION 5: GET /api/geo/bigdatacloud/ip
// ============================================

/**
 * IP Geolocation - BigDataCloud API
 *
 * @description Get geolocation data from visitor's IP using BigDataCloud API
 * Alternative to ipapi.co to avoid rate limiting
 *
 * Use Cases:
 * - Get visitor's location automatically from their IP
 * - Center map on user's location
 * - Show local events based on IP location
 *
 * Returns:
 * - source: 'BigDataCloud'
 * - ip: IP address
 * - latitude: Latitude coordinate
 * - longitude: Longitude coordinate
 * - city: City name
 * - region: State/Province
 * - region_code: State/Province code
 * - country: Country code (US, CA, etc)
 * - country_name: Full country name
 * - postal: ZIP/Postal code
 * - timezone: Timezone ID
 * - raw: Full API response for debugging
 *
 * @example
 * GET /api/geo/bigdatacloud/ip
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "source": "BigDataCloud",
 *     "ip": "71.232.30.16",
 *     "latitude": 42.3584,
 *     "longitude": -71.0598,
 *     "city": "Boston",
 *     "region": "Massachusetts",
 *     "region_code": "MA",
 *     "country": "US",
 *     "country_name": "United States",
 *     "postal": "02108",
 *     "timezone": "America/New_York",
 *     "raw": {...}
 *   },
 *   "timestamp": "2025-10-18T12:34:56.789Z"
 * }
 */
async function geoBigDataCloudHandler(request, context) {
    context.log('Geo_BigDataCloud_Get: Request received');

    const apiKey = process.env.BIGDATACLOUD_API_KEY;
    if (!apiKey) {
        throw new Error('BIGDATACLOUD_API_KEY not configured');
    }

    // Get IP from Cloudflare headers or fallback to request IP
    const rawIp = request.headers.get('cf-connecting-ip') ||
                  request.headers.get('x-forwarded-for')?.split(',')[0] ||
                  'unknown';

    // Strip port number (e.g., "71.232.30.16:52525" → "71.232.30.16")
    const ip = rawIp.split(':')[0].trim();

    context.log('Geo_BigDataCloud_Get: Detected IP', { ip });

    // Call BigDataCloud API
    const url = `https://api.bigdatacloud.net/data/ip-geolocation?key=${apiKey}&ip=${ip}`;
    const response = await fetch(url, {
        headers: { 'User-Agent': 'TangoTiempo/1.0' },
        signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    if (!response.ok) {
        throw new Error(`BigDataCloud API returned status ${response.status}`);
    }

    const data = await response.json();

    context.log('Geo_BigDataCloud_Get: Geolocation retrieved', {
        ip: data.ip,
        city: data.location?.city,
        country: data.country?.isoAlpha2
    });

    return {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
        },
        body: JSON.stringify({
            success: true,
            data: {
                source: 'BigDataCloud',
                ip: data.ip || ip,
                latitude: data.location?.latitude || null,
                longitude: data.location?.longitude || null,
                city: data.location?.city || null,
                region: data.location?.principalSubdivision || null,
                region_code: data.location?.principalSubdivisionCode || null,
                country: data.country?.isoAlpha2 || null,
                country_name: data.country?.name || null,
                postal: data.location?.postcode || null,
                timezone: data.location?.timeZone?.ianaTimeId || null,
                raw: data
            },
            timestamp: new Date().toISOString()
        })
    };
}

// Register function with standard middleware
app.http('Geo_BigDataCloud_Get', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'geo/bigdatacloud/ip',
    handler: standardMiddleware(geoBigDataCloudHandler)
});

// ============================================
// FUNCTION 6: GET /api/geo/abstract/ip
// ============================================

/**
 * IP Geolocation - Abstract API
 *
 * @description Get geolocation data from visitor's IP using Abstract API
 * Alternative to ipapi.co to avoid rate limiting
 *
 * Use Cases:
 * - Get visitor's location automatically from their IP
 * - Center map on user's location
 * - Show local events based on IP location
 *
 * Returns:
 * - source: 'AbstractAPI'
 * - ip: IP address
 * - latitude: Latitude coordinate
 * - longitude: Longitude coordinate
 * - city: City name
 * - region: State/Province
 * - region_code: State/Province code
 * - country: Country code (US, CA, etc)
 * - country_name: Full country name
 * - postal: ZIP/Postal code
 * - timezone: Timezone ID
 * - raw: Full API response for debugging
 *
 * @example
 * GET /api/geo/abstract/ip
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "source": "AbstractAPI",
 *     "ip": "71.232.30.16",
 *     "latitude": 42.3584,
 *     "longitude": -71.0598,
 *     "city": "Boston",
 *     "region": "Massachusetts",
 *     "region_code": "MA",
 *     "country": "US",
 *     "country_name": "United States",
 *     "postal": "02108",
 *     "timezone": "America/New_York",
 *     "raw": {...}
 *   },
 *   "timestamp": "2025-10-18T12:34:56.789Z"
 * }
 */
async function geoAbstractHandler(request, context) {
    context.log('Geo_Abstract_Get: Request received');

    const apiKey = process.env.ABSTRACT_API_KEY;
    if (!apiKey) {
        throw new Error('ABSTRACT_API_KEY not configured');
    }

    // Get IP from Cloudflare headers or fallback to request IP
    const rawIp = request.headers.get('cf-connecting-ip') ||
                  request.headers.get('x-forwarded-for')?.split(',')[0] ||
                  'unknown';

    // Strip port number (e.g., "71.232.30.16:52525" → "71.232.30.16")
    const ip = rawIp.split(':')[0].trim();

    context.log('Geo_Abstract_Get: Detected IP', { ip });

    // Call Abstract API
    const url = `https://ipgeolocation.abstractapi.com/v1/?api_key=${apiKey}&ip_address=${ip}`;
    const response = await fetch(url, {
        headers: { 'User-Agent': 'TangoTiempo/1.0' },
        signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    if (!response.ok) {
        throw new Error(`Abstract API returned status ${response.status}`);
    }

    const data = await response.json();

    context.log('Geo_Abstract_Get: Geolocation retrieved', {
        ip: data.ip_address,
        city: data.city,
        country: data.country_code
    });

    return {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
        },
        body: JSON.stringify({
            success: true,
            data: {
                source: 'AbstractAPI',
                ip: data.ip_address || ip,
                latitude: data.latitude || null,
                longitude: data.longitude || null,
                city: data.city || null,
                region: data.region || null,
                region_code: data.region_iso_code || null,
                country: data.country_code || null,
                country_name: data.country || null,
                postal: data.postal_code || null,
                timezone: data.timezone?.name || null,
                raw: data
            },
            timestamp: new Date().toISOString()
        })
    };
}

// Register function with standard middleware
app.http('Geo_Abstract_Get', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'geo/abstract/ip',
    handler: standardMiddleware(geoAbstractHandler)
});

// ============================================
// FUNCTION 7: POST /api/geo/mapbox/reverse
// ============================================

/**
 * Reverse Geocoding - Mapbox API
 *
 * @description Convert lat/long coordinates to full address using Mapbox Geocoding API
 * Used after getting coordinates from Google Geolocation API
 *
 * Use Cases:
 * - Convert browser geolocation coordinates to readable address
 * - Get detailed address components from lat/lng
 * - Validate and format addresses
 *
 * Request Body:
 * - latitude: Latitude coordinate (required)
 * - longitude: Longitude coordinate (required)
 *
 * Returns:
 * - source: 'Mapbox'
 * - latitude: Input latitude
 * - longitude: Input longitude
 * - formatted_address: Full formatted address
 * - street_address: Street number and name
 * - city: City name
 * - region: State/Province
 * - postal_code: ZIP/Postal code
 * - country: Country name
 * - country_code: Country code
 * - accuracy: Geocoding accuracy
 * - place_type: Array of place types
 * - raw: Full API response for debugging
 *
 * @example
 * POST /api/geo/mapbox/reverse
 * Body: { "latitude": 42.3601, "longitude": -71.0589 }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "source": "Mapbox",
 *     "latitude": 42.3601,
 *     "longitude": -71.0589,
 *     "formatted_address": "Boston, Massachusetts 02101, United States",
 *     "street_address": "123 Main St",
 *     "city": "Boston",
 *     "region": "Massachusetts",
 *     "postal_code": "02101",
 *     "country": "United States",
 *     "country_code": "us",
 *     "accuracy": "rooftop",
 *     "place_type": ["address"],
 *     "raw": {...}
 *   },
 *   "timestamp": "2025-10-18T12:34:56.789Z"
 * }
 */
async function geoMapboxReverseHandler(request, context) {
    context.log('Geo_Mapbox_Reverse: Request received');

    const accessToken = process.env.MAPBOX_ACCESS_TOKEN;
    if (!accessToken) {
        throw new Error('MAPBOX_ACCESS_TOKEN not configured');
    }

    // Parse request body
    let body;
    try {
        body = await request.json();
    } catch (error) {
        context.log('Geo_Mapbox_Reverse: Invalid JSON in request body');
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

    const { latitude, longitude } = body || {};

    // Validate required parameters
    if (!latitude || !longitude) {
        context.log('Geo_Mapbox_Reverse: Missing latitude or longitude');
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Missing latitude or longitude in request body',
                timestamp: new Date().toISOString()
            })
        };
    }

    context.log('Geo_Mapbox_Reverse: Coordinates', { latitude, longitude });

    // Call Mapbox Reverse Geocoding API
    // Note: Mapbox format is {longitude},{latitude}.json (reversed!)
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${accessToken}`;
    const response = await fetch(url, {
        headers: { 'User-Agent': 'TangoTiempo/1.0' },
        signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    if (!response.ok) {
        throw new Error(`Mapbox API returned status ${response.status}`);
    }

    const data = await response.json();

    // Extract most relevant address from features
    const feature = data.features?.[0];

    if (!feature) {
        context.log('Geo_Mapbox_Reverse: No address found for coordinates');
        return {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'No address found for coordinates',
                timestamp: new Date().toISOString()
            })
        };
    }

    // Helper to extract context items by type
    const getContext = (type) => {
        const item = feature.context?.find(c => c.id.startsWith(type));
        return item ? item.text : null;
    };

    context.log('Geo_Mapbox_Reverse: Address found', {
        formatted_address: feature.place_name,
        city: getContext('place')
    });

    return {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
        },
        body: JSON.stringify({
            success: true,
            data: {
                source: 'Mapbox',
                latitude: latitude,
                longitude: longitude,
                formatted_address: feature.place_name || null,
                street_address: feature.address
                    ? `${feature.address} ${feature.text}`
                    : feature.text,
                city: getContext('place'),
                region: getContext('region'),
                postal_code: getContext('postcode'),
                country: getContext('country'),
                country_code: feature.properties?.short_code || null,
                accuracy: feature.properties?.accuracy || null,
                place_type: feature.place_type || [],
                raw: data
            },
            timestamp: new Date().toISOString()
        })
    };
}

// Register function with standard middleware
app.http('Geo_Mapbox_Reverse', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'geo/mapbox/reverse',
    handler: standardMiddleware(geoMapboxReverseHandler)
});
