const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { getTimezoneForVenue } = require('../utils/timezoneMapping');

/**
 * GET /api/venues
 * Retrieve venues with filtering and pagination from MongoDB
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - limit: Results per page (default: 100)
 * - page: Page number (default: 1)
 * - isActive: Filter by active status (optional)
 * - name: Search by name (case-insensitive, optional)
 * - cityId or masteredCityId: Filter by city (optional)
 * - masteredDivisionId: Filter by division (optional)
 * - masteredRegionId: Filter by region (optional)
 * - lat: Latitude for geo search (-90 to 90)
 * - lng: Longitude for geo search (-180 to 180)
 * - radius: Search radius with unit (default: "50km", supports km/m/mi)
 * - sortByDistance: Sort results by distance from lat/lng ("true"/"false")
 * - all: "true" to return all matching venues, bypassing pagination
 * - select: Comma-separated fields to return (optional)
 * - populate: "true" to populate location references (optional)
 *
 * Response: { data: [...venues...], pagination: { total, page, limit, pages } }
 */

// Handler function
async function venuesGetHandler(request, context) {
    context.log('Venues_Get: Request received');

    let mongoClient;

    try {
        // Parse query parameters
        const appId = request.query.get('appId') || '1';
        const limit = parseInt(request.query.get('limit') || '100', 10);
        const page = parseInt(request.query.get('page') || '1', 10);
        const isActiveParam = request.query.get('isActive');
        const name = request.query.get('name');
        const cityId = request.query.get('cityId') || request.query.get('masteredCityId');
        const masteredDivisionId = request.query.get('masteredDivisionId');
        const masteredRegionId = request.query.get('masteredRegionId');
        const lat = request.query.get('lat');
        const lng = request.query.get('lng');
        const radius = request.query.get('radius');
        const sortByDistance = request.query.get('sortByDistance');
        const all = request.query.get('all');
        const select = request.query.get('select');
        // CALBEAF-64: Population is now DEFAULT to match Express parity
        // Use ?populate=false to disable
        const populate = request.query.get('populate') !== 'false';

        context.log(`Fetching venues: appId=${appId}, page=${page}, limit=${limit}, populate=${populate}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const venuesCollection = db.collection('venues');

        // Build query filter
        const query = { appId };

        // Filter by isActive if provided
        if (isActiveParam !== null && isActiveParam !== undefined) {
            query.isActive = isActiveParam === 'true';
        }

        // Filter by name (case-insensitive partial match)
        if (name) {
            query.name = { $regex: name, $options: 'i' };
        }

        // Filter by city
        if (cityId) {
            query.masteredCityId = new ObjectId(cityId);
        }

        // CALBEAF-74b: Filter by division and region (Express parity)
        if (masteredDivisionId) {
            query.masteredDivisionId = new ObjectId(masteredDivisionId);
        }
        if (masteredRegionId) {
            query.masteredRegionId = new ObjectId(masteredRegionId);
        }

        // CALBEAF-74b: Geo search — $geoWithin/$centerSphere on geolocation field
        let geoLat = null;
        let geoLng = null;
        if (lat && lng) {
            geoLat = parseFloat(lat);
            geoLng = parseFloat(lng);

            if (isNaN(geoLat) || isNaN(geoLng) ||
                geoLat < -90 || geoLat > 90 ||
                geoLng < -180 || geoLng > 180) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Invalid lat/lng values. lat: -90 to 90, lng: -180 to 180' })
                };
            }

            // Parse radius: number + optional unit (km, m, mi). Default 50km
            let radiusMeters = 50000;
            if (radius) {
                const radiusMatch = radius.match(/^([\d.]+)\s*(km|m|mi)?$/i);
                if (radiusMatch) {
                    const radiusValue = parseFloat(radiusMatch[1]);
                    const radiusUnit = (radiusMatch[2] || 'km').toLowerCase();
                    if (radiusUnit === 'km') {
                        radiusMeters = radiusValue * 1000;
                    } else if (radiusUnit === 'mi') {
                        radiusMeters = radiusValue * 1609.344;
                    } else {
                        radiusMeters = radiusValue;
                    }
                }
            }

            const radiusRadians = radiusMeters / 6378137;
            query.geolocation = {
                $geoWithin: {
                    $centerSphere: [[geoLng, geoLat], radiusRadians]
                }
            };

            context.log(`Venues_Get: Geo filter — radius ${radiusMeters}m from [${geoLat},${geoLng}]`);
        }

        // Calculate pagination
        const skip = (page - 1) * limit;

        // Build projection if select is provided
        const projection = {};
        if (select) {
            select.split(',').forEach(field => {
                projection[field.trim()] = 1;
            });
        }

        // CALBEAF-74b: "all" param — return everything, bypass pagination (Express parity)
        const projectionOpt = Object.keys(projection).length > 0 ? projection : undefined;
        let venues, total, totalPages;

        if (all === 'true') {
            venues = await venuesCollection
                .find(query, { projection: projectionOpt })
                .sort({ name: 1 })
                .toArray();
            total = venues.length;
            totalPages = 1;
        } else {
            const venuesQuery = venuesCollection
                .find(query, { projection: projectionOpt })
                .sort({ name: 1 })
                .skip(skip)
                .limit(limit);

            [venues, total] = await Promise.all([
                venuesQuery.toArray(),
                venuesCollection.countDocuments(query)
            ]);
            totalPages = Math.ceil(total / limit);
        }

        // CALBEAF-74b: Distance calculation and sort (Express parity)
        if (geoLat !== null && geoLng !== null) {
            const toRad = (deg) => deg * Math.PI / 180;
            const haversine = (lat1, lon1, lat2, lon2) => {
                const R = 6371;
                const dLat = toRad(lat2 - lat1);
                const dLon = toRad(lon2 - lon1);
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                return R * c;
            };

            for (const venue of venues) {
                const geo = venue.geolocation;
                if (geo && geo.coordinates && geo.coordinates.length === 2) {
                    venue.distance = Math.round(haversine(geoLat, geoLng, geo.coordinates[1], geo.coordinates[0]) * 100) / 100;
                    venue.distanceUnit = 'km';
                } else {
                    venue.distance = null;
                    venue.distanceUnit = 'km';
                }
            }

            if (sortByDistance === 'true') {
                venues.sort((a, b) => {
                    if (a.distance === null && b.distance === null) return 0;
                    if (a.distance === null) return 1;
                    if (b.distance === null) return -1;
                    return a.distance - b.distance;
                });
            }
        }

        // CALBEAF-64: Populate masteredCityId by default to match Express parity
        // Returns only {_id, cityName} - not full city object
        if (populate && venues.length > 0) {
            const citiesCollection = db.collection('masteredcities');
            const cityIds = [...new Set(venues
                .map(v => v.masteredCityId)
                .filter(id => id))];

            if (cityIds.length > 0) {
                const cities = await citiesCollection
                    .find({ _id: { $in: cityIds } }, { projection: { _id: 1, cityName: 1 } })
                    .toArray();

                // Map to {_id, cityName} format to match Express
                const cityMap = new Map(cities.map(c => [c._id.toString(), { _id: c._id, cityName: c.cityName }]));

                venues = venues.map(venue => ({
                    ...venue,
                    masteredCityId: venue.masteredCityId
                        ? cityMap.get(venue.masteredCityId.toString()) || venue.masteredCityId
                        : null
                }));
            }
        }

        context.log(`Found ${venues.length} venues (page ${page}/${totalPages}, total: ${total})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: venues,
                pagination: {
                    total,
                    page,
                    limit,
                    pages: totalPages
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
app.http('Venues_Get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'venues',
    handler: standardMiddleware(venuesGetHandler)
});

/**
 * GET /api/venues/{id}
 * Get single venue by ID
 */
async function venuesGetByIdHandler(request, context) {
    const venueId = request.params.id;
    // CALBEAF-64: Population is now DEFAULT to match Express parity
    const populate = request.query.get('populate') !== 'false';

    context.log(`Venues_GetById: Request for venue ${venueId}, populate=${populate}`);

    let mongoClient;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('venues');

        let venue = await collection.findOne({
            _id: new ObjectId(venueId)
        });

        if (!venue) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Venue not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // CALBEAF-64: Populate masteredCityId by default - returns only {_id, cityName}
        if (populate && venue.masteredCityId) {
            const citiesCollection = db.collection('masteredcities');
            const city = await citiesCollection.findOne(
                { _id: venue.masteredCityId },
                { projection: { _id: 1, cityName: 1 } }
            );
            if (city) {
                venue.masteredCityId = { _id: city._id, cityName: city.cityName };
            }
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(venue)
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Venues_GetById', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'venues/{id}',
    handler: standardMiddleware(venuesGetByIdHandler)
});

/**
 * POST /api/venues
 * Create a new venue
 */
async function venuesCreateHandler(request, context) {
    context.log('Venues_Create: Request received');

    let mongoClient;

    try {
        const body = await request.json();
        const appId = body.appId || '1';

        // Validate required fields
        if (!body.name) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'name is required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Require coordinates
        if (body.latitude === undefined || body.longitude === undefined) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'latitude and longitude are required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('venues');

        const latitude = parseFloat(body.latitude);
        const longitude = parseFloat(body.longitude);

        // Check for duplicate venue within 100 yards (~91 meters)
        const duplicateCheck = await collection.findOne({
            appId,
            geolocation: {
                $near: {
                    $geometry: { type: 'Point', coordinates: [longitude, latitude] },
                    $maxDistance: 91.44
                }
            }
        });

        if (duplicateCheck) {
            return {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'DuplicateError',
                    message: 'A venue already exists within 100 yards of this location',
                    existingVenueId: duplicateCheck._id,
                    existingVenueName: duplicateCheck.name,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Create venue document
        const newVenue = {
            appId,
            name: body.name,
            shortName: body.shortName || '',
            address1: body.address1 || '',
            address2: body.address2 || '',
            address3: body.address3 || '',
            city: body.city || '',
            state: body.state || '',
            zip: body.zip || '',
            phone: body.phone || '',
            comments: body.comments || '',
            latitude,
            longitude,
            geolocation: {
                type: 'Point',
                coordinates: [longitude, latitude]
            },
            masteredCityId: body.masteredCityId ? new ObjectId(body.masteredCityId) : null,
            masteredDivisionId: body.masteredDivisionId ? new ObjectId(body.masteredDivisionId) : null,
            masteredRegionId: body.masteredRegionId ? new ObjectId(body.masteredRegionId) : null,
            masteredCountryId: body.masteredCountryId ? new ObjectId(body.masteredCountryId) : null,
            timezone: body.timezone || getTimezoneForVenue({ city: body.city, state: body.state, country: body.country || 'US' }),
            country: body.country || 'US',
            isActive: body.isActive !== undefined ? body.isActive : true,
            isApproved: body.isApproved !== undefined ? body.isApproved : false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await collection.insertOne(newVenue);
        newVenue._id = result.insertedId;

        context.log(`[VENUE CREATE] Name: "${newVenue.name}", VenueId: ${newVenue._id}, City: ${newVenue.city}`);

        return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newVenue)
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Venues_Create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'venues',
    handler: standardMiddleware(venuesCreateHandler)
});

/**
 * PUT /api/venues/{id}
 * Update a venue
 */
async function venuesUpdateHandler(request, context) {
    const venueId = request.params.id;
    context.log(`Venues_Update: Request for venue ${venueId}`);

    let mongoClient;

    try {
        const body = await request.json();
        const appId = body.appId || request.query.get('appId') || '1';

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('venues');

        // Check if venue exists
        const existing = await collection.findOne({
            _id: new ObjectId(venueId)
        });

        if (!existing) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Venue not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Build update object
        const updateData = { ...body };
        delete updateData.appId;
        delete updateData._id;
        updateData.updatedAt = new Date();

        // Handle coordinate updates
        if (body.latitude !== undefined && body.longitude !== undefined) {
            const latitude = parseFloat(body.latitude);
            const longitude = parseFloat(body.longitude);

            updateData.latitude = latitude;
            updateData.longitude = longitude;
            updateData.geolocation = {
                type: 'Point',
                coordinates: [longitude, latitude]
            };

            // Check for duplicates if coordinates changed
            if (latitude !== existing.latitude || longitude !== existing.longitude) {
                const duplicateCheck = await collection.findOne({
                    appId,
                    _id: { $ne: new ObjectId(venueId) },
                    geolocation: {
                        $near: {
                            $geometry: { type: 'Point', coordinates: [longitude, latitude] },
                            $maxDistance: 91.44
                        }
                    }
                });

                if (duplicateCheck) {
                    return {
                        status: 409,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            success: false,
                            error: 'DuplicateError',
                            message: 'Another venue exists within 100 yards of the new location',
                            timestamp: new Date().toISOString()
                        })
                    };
                }
            }
        }

        // Convert ObjectId fields if provided
        if (body.masteredCityId) {
            updateData.masteredCityId = new ObjectId(body.masteredCityId);
        }
        if (body.masteredDivisionId) {
            updateData.masteredDivisionId = new ObjectId(body.masteredDivisionId);
        }
        if (body.masteredRegionId) {
            updateData.masteredRegionId = new ObjectId(body.masteredRegionId);
        }
        if (body.masteredCountryId) {
            updateData.masteredCountryId = new ObjectId(body.masteredCountryId);
        }

        // Auto-detect timezone when location fields change but timezone is not explicitly set
        if (!body.timezone && (body.city || body.state || body.country)) {
            const resolvedCity = body.city || existing.city;
            const resolvedState = body.state || existing.state;
            const resolvedCountry = body.country || existing.country || 'US';
            updateData.timezone = getTimezoneForVenue({ city: resolvedCity, state: resolvedState, country: resolvedCountry });
        }

        const updatedTimezone = updateData.timezone || null;

        const result = await collection.findOneAndUpdate(
            { _id: new ObjectId(venueId) },
            { $set: updateData },
            { returnDocument: 'after' }
        );

        // Cascade timezone to future events (Express parity)
        if (updatedTimezone && updatedTimezone !== existing.timezone) {
            const eventsCollection = db.collection('events');
            const cascadeResult = await eventsCollection.updateMany(
                { venueID: new ObjectId(venueId), startDate: { $gte: new Date() } },
                { $set: { venueTimezone: updatedTimezone } }
            );
            context.log(`[VENUE UPDATE] Timezone cascade: updated ${cascadeResult.modifiedCount} future events to timezone ${updatedTimezone}`);
        }

        context.log(`[VENUE UPDATE] VenueId: ${venueId}, UpdatedFields: ${Object.keys(updateData).join(', ')}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result)
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Venues_Update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'venues/{id}',
    handler: standardMiddleware(venuesUpdateHandler)
});

/**
 * DELETE /api/venues/{id}
 * Delete a venue
 */
async function venuesDeleteHandler(request, context) {
    const venueId = request.params.id;

    context.log(`Venues_Delete: Request for venue ${venueId}`);

    let mongoClient;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('venues');

        // Find venue first for logging
        const venue = await collection.findOne({
            _id: new ObjectId(venueId)
        });

        if (!venue) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Venue not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        await collection.deleteOne({
            _id: new ObjectId(venueId)
        });

        context.log(`[VENUE DELETE] VenueId: ${venueId}, Name: "${venue.name}"`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'Venue deleted successfully',
                timestamp: new Date().toISOString()
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Venues_Delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'venues/{id}',
    handler: standardMiddleware(venuesDeleteHandler)
});
