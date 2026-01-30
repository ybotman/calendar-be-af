// src/functions/VenuesGeocode.js
// Domain: Venues - Geocoding and proximity endpoints
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * GET /api/venues/geocode
 * Geocode an address using Nominatim (OpenStreetMap) and resolve the nearest mastered city
 * with deep population of division, region, and country.
 *
 * Query Parameters:
 * - address: (required) The address string to geocode
 * - appId: Application ID (default: "1")
 *
 * Response: {
 *   latitude, longitude, formattedAddress,
 *   masteredCityId, masteredCityName,
 *   masteredDivisionId, masteredDivisionName,
 *   masteredRegionId, masteredRegionName,
 *   masteredCountryId, masteredCountryName
 * }
 */
async function venuesGeocodeHandler(request, context) {
    context.log('Venues_Geocode: Request received');

    const address = request.query.get('address');
    const appId = request.query.get('appId') || '1';

    if (!address) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ValidationError',
                message: 'address query parameter is required',
                timestamp: new Date().toISOString()
            })
        };
    }

    let mongoClient;

    try {
        // Step 1: Call Nominatim geocoding API
        const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
        context.log(`Venues_Geocode: Calling Nominatim for address: "${address}"`);

        const response = await fetch(nominatimUrl, {
            headers: {
                'User-Agent': 'calendar-be-af/1.0'
            }
        });

        if (!response.ok) {
            context.log(`Venues_Geocode: Nominatim returned status ${response.status}`);
            return {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'GeocodingError',
                    message: 'Geocoding service returned an error',
                    timestamp: new Date().toISOString()
                })
            };
        }

        const results = await response.json();

        if (!results || results.length === 0) {
            context.log(`Venues_Geocode: No results found for address: "${address}"`);
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'NotFound',
                    message: 'No geocoding results found for the provided address',
                    timestamp: new Date().toISOString()
                })
            };
        }

        const geocodeResult = results[0];
        const latitude = parseFloat(geocodeResult.lat);
        const longitude = parseFloat(geocodeResult.lon);
        const formattedAddress = geocodeResult.display_name;

        context.log(`Venues_Geocode: Geocoded to lat=${latitude}, lng=${longitude}`);

        // Step 2: Connect to MongoDB and find nearest mastered city
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const citiesCollection = db.collection('masteredcities');

        // Find nearest city using $near on the location field (2dsphere index)
        const nearestCity = await citiesCollection.findOne({
            location: {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [longitude, latitude]
                    }
                }
            }
        });

        // Build response with deep population
        const responseData = {
            latitude,
            longitude,
            formattedAddress,
            masteredCityId: null,
            masteredCityName: null,
            masteredDivisionId: null,
            masteredDivisionName: null,
            masteredRegionId: null,
            masteredRegionName: null,
            masteredCountryId: null,
            masteredCountryName: null
        };

        if (nearestCity) {
            responseData.masteredCityId = nearestCity._id;
            responseData.masteredCityName = nearestCity.cityName;

            // Deep populate: masteredDivisionId -> masteredRegionId -> masteredCountryId
            if (nearestCity.masteredDivisionId) {
                const divisionsCollection = db.collection('mastereddivisions');
                const division = await divisionsCollection.findOne({
                    _id: new ObjectId(nearestCity.masteredDivisionId.toString())
                });

                if (division) {
                    responseData.masteredDivisionId = division._id;
                    responseData.masteredDivisionName = division.divisionName;

                    if (division.masteredRegionId) {
                        const regionsCollection = db.collection('masteredregions');
                        const region = await regionsCollection.findOne({
                            _id: new ObjectId(division.masteredRegionId.toString())
                        });

                        if (region) {
                            responseData.masteredRegionId = region._id;
                            responseData.masteredRegionName = region.regionName;

                            if (region.masteredCountryId) {
                                const countriesCollection = db.collection('masteredcountries');
                                const country = await countriesCollection.findOne({
                                    _id: new ObjectId(region.masteredCountryId.toString())
                                });

                                if (country) {
                                    responseData.masteredCountryId = country._id;
                                    responseData.masteredCountryName = country.countryName;
                                }
                            }
                        }
                    }
                }
            }

            context.log(`Venues_Geocode: Nearest city: ${nearestCity.cityName} (${nearestCity._id})`);
        } else {
            context.log('Venues_Geocode: No nearby mastered city found');
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseData)
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

app.http('Venues_Geocode', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'venues/geocode',
    handler: standardMiddleware(venuesGeocodeHandler)
});

/**
 * GET /api/venues/check-proximity
 * Check if there are existing venues near a given lat/lng coordinate
 *
 * Query Parameters:
 * - lat: (required) Latitude
 * - lng: (required) Longitude
 * - radius: Radius in yards (default: 100)
 * - appId: Application ID (default: "1")
 *
 * Response: {
 *   hasNearbyVenues: boolean,
 *   count: number,
 *   nearbyVenues: [{ _id, name, address1, city, latitude, longitude, distanceInYards }]
 * }
 */
async function venuesCheckProximityHandler(request, context) {
    context.log('Venues_CheckProximity: Request received');

    // Support both GET (query params) and POST (body) — Express only had GET,
    // but FE VenueModalAddWithSearch.js sends POST with body { lat, lng, radius, appId }
    let lat, lng, radius, appId;

    if (request.method === 'POST') {
        const body = await request.json();
        // Accept both lat/lng and latitude/longitude — FE sends latitude/longitude
        const rawLat = body.lat != null ? body.lat : body.latitude;
        const rawLng = body.lng != null ? body.lng : body.longitude;
        lat = rawLat != null ? String(rawLat) : null;
        lng = rawLng != null ? String(rawLng) : null;
        radius = body.radius != null ? String(body.radius) : '100';
        appId = body.appId != null ? String(body.appId) : '1';
    } else {
        lat = request.query.get('lat');
        lng = request.query.get('lng');
        radius = request.query.get('radius') || '100';
        appId = request.query.get('appId') || '1';
    }

    if (!lat || !lng) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ValidationError',
                message: 'lat and lng query parameters are required',
                timestamp: new Date().toISOString()
            })
        };
    }

    let mongoClient;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const venuesCollection = db.collection('venues');

        // Convert yards to meters (1 yard = 0.9144 meters)
        const maxDistanceMeters = parseFloat(radius) * 0.9144;

        context.log(`Venues_CheckProximity: lat=${lat}, lng=${lng}, radius=${radius} yards (${maxDistanceMeters.toFixed(2)}m)`);

        // Use $geoNear aggregation pipeline
        const pipeline = [
            {
                $geoNear: {
                    near: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
                    distanceField: 'distance',
                    maxDistance: maxDistanceMeters,
                    spherical: true,
                    query: { appId, isActive: true }
                }
            },
            {
                $project: {
                    _id: 1,
                    name: 1,
                    address1: 1,
                    city: 1,
                    latitude: 1,
                    longitude: 1,
                    distanceInYards: { $divide: ['$distance', 0.9144] }
                }
            },
            { $sort: { distance: 1 } }
        ];

        const nearbyVenues = await venuesCollection.aggregate(pipeline).toArray();

        context.log(`Venues_CheckProximity: Found ${nearbyVenues.length} nearby venues`);

        // Map response fields to match Express BE (serverVenues.js lines 1103-1111):
        // Express returns { distance (rounded int), address } not { distanceInYards (float), address1 }
        const mappedVenues = nearbyVenues.map(v => ({
            _id: v._id,
            name: v.name,
            distance: Math.round(v.distanceInYards),
            address: v.address1,
            city: v.city,
            latitude: v.latitude,
            longitude: v.longitude
        }));

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hasNearbyVenues: mappedVenues.length > 0,
                count: mappedVenues.length,
                nearbyVenues: mappedVenues
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

app.http('Venues_CheckProximity', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'venues/check-proximity',
    handler: standardMiddleware(venuesCheckProximityHandler)
});
