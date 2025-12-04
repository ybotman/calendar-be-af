// src/functions/Geo_EventDensity.js
// Domain: Geo - Event density detection for populated vs unpopulated areas
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * GET /api/geo/event-density
 * Detect if a visitor's location has events/venues (populated) vs none (unpopulated)
 *
 * Query Parameters:
 * - lat: Latitude (required)
 * - lng: Longitude (required)
 * - radius: Search radius in kilometers (default: 80)
 * - appId: Application ID (default: "1" for TangoTiempo)
 *
 * Response:
 * {
 *   eventCount: number,
 *   activeVenueCount: number,
 *   isPopulated: boolean,  // true if eventCount > 0 OR activeVenueCount > 0
 *   nearestEventDistance: number | null,  // km to nearest event
 *   nearestVenueName: string | null
 * }
 *
 * Use Case: Frontend entry flow (TIEMPO-329)
 * - Populated areas (Boston): Show "Find events near you"
 * - Unpopulated areas (Austin): Show "No events yet, be notified when events arrive"
 *
 * Linked Tickets: CALBEAF-56, TIEMPO-329
 */

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function geoEventDensityHandler(request, context) {
    context.log('Geo_EventDensity: Request received');

    // Extract and validate query parameters
    const lat = parseFloat(request.query.get('lat'));
    const lng = parseFloat(request.query.get('lng'));
    const radius = parseFloat(request.query.get('radius') || '80'); // default 80km
    const appId = request.query.get('appId') || '1'; // default TangoTiempo

    // Validate required parameters
    if (isNaN(lat) || isNaN(lng)) {
        context.log('Missing or invalid lat/lng parameters');
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'lat and lng are required and must be valid numbers',
                timestamp: new Date().toISOString()
            })
        };
    }

    // Validate coordinate ranges
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        context.log(`Invalid coordinates: lat=${lat}, lng=${lng}`);
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'lat must be between -90 and 90, lng must be between -180 and 180',
                timestamp: new Date().toISOString()
            })
        };
    }

    context.log(`Checking event density at lat=${lat}, lng=${lng}, radius=${radius}km, appId=${appId}`);

    let mongoClient;

    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const venuesCollection = db.collection('venues');
        const eventsCollection = db.collection('events');

        // Get today's date for event filtering
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // STEP 1: Find active venues within radius
        // NOTE: This assumes venues have lat/lng fields
        // If venues use geoPoint with {type: "Point", coordinates: [lng, lat]},
        // we'll need to use $geoNear or $geoWithin

        const venues = await venuesCollection.find({
            appId,
            isActive: true
        }).toArray();

        context.log(`Found ${venues.length} total active venues for appId ${appId}`);

        // Filter venues by distance (client-side filtering)
        // TODO: Convert to MongoDB geospatial query with 2dsphere index for better performance
        const nearbyVenues = venues.filter(venue => {
            // Check different possible lat/lng field names
            const venueLat = venue.lat || venue.latitude || (venue.geoPoint && venue.geoPoint.coordinates ? venue.geoPoint.coordinates[1] : null);
            const venueLng = venue.lng || venue.longitude || venue.long || (venue.geoPoint && venue.geoPoint.coordinates ? venue.geoPoint.coordinates[0] : null);

            if (!venueLat || !venueLng) {
                context.log(`Venue ${venue._id} missing coordinates`);
                return false;
            }

            const distance = calculateDistance(lat, lng, venueLat, venueLng);
            venue.distance = distance; // Store for later use
            return distance <= radius;
        });

        const activeVenueCount = nearbyVenues.length;
        context.log(`Found ${activeVenueCount} active venues within ${radius}km`);

        // STEP 2: Find events at nearby venues with startTime >= today
        let eventCount = 0;
        let nearestEventDistance = null;
        let nearestVenueName = null;

        if (nearbyVenues.length > 0) {
            // Get venue IDs
            const venueIds = nearbyVenues.map(v => v._id);

            // Query events at these venues
            const events = await eventsCollection.find({
                appId,
                venueId: { $in: venueIds.map(id => id.toString()) },
                startTime: { $gte: today }
            }).toArray();

            eventCount = events.length;
            context.log(`Found ${eventCount} upcoming events at nearby venues`);

            // Find nearest venue with events
            if (events.length > 0) {
                const venuesWithEvents = new Set(events.map(e => e.venueId));
                const nearbyVenuesWithEvents = nearbyVenues
                    .filter(v => venuesWithEvents.has(v._id.toString()))
                    .sort((a, b) => a.distance - b.distance);

                if (nearbyVenuesWithEvents.length > 0) {
                    const nearestVenue = nearbyVenuesWithEvents[0];
                    nearestEventDistance = Math.round(nearestVenue.distance * 10) / 10; // Round to 1 decimal
                    nearestVenueName = nearestVenue.name;
                }
            } else {
                // No events, but find nearest venue anyway
                const sortedVenues = nearbyVenues.sort((a, b) => a.distance - b.distance);
                if (sortedVenues.length > 0) {
                    nearestEventDistance = Math.round(sortedVenues[0].distance * 10) / 10;
                    nearestVenueName = sortedVenues[0].name;
                }
            }
        }

        // STEP 3: Determine if area is populated
        // Area is populated if EITHER eventCount > 0 OR activeVenueCount > 0
        // Example: Austin might have 0 events but 3 venues registered (pre-launch) -> isPopulated=true
        // Example: Chicago with 0 events AND 0 venues -> isPopulated=false
        const isPopulated = eventCount > 0 || activeVenueCount > 0;

        const result = {
            success: true,
            data: {
                eventCount,
                activeVenueCount,
                isPopulated,
                nearestEventDistance,
                nearestVenueName
            },
            query: {
                lat,
                lng,
                radius,
                appId
            },
            timestamp: new Date().toISOString()
        };

        context.log(`Event density result: ${JSON.stringify(result.data)}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result)
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
app.http('Geo_EventDensity', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'geo/event-density',
    handler: standardMiddleware(geoEventDensityHandler)
});
