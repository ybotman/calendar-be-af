// src/functions/MasteredLocations.js
// Domain: MasteredLocations - Mastered location hierarchy (countries, regions, divisions, cities)
// and active regions endpoint
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

// ============================================
// FUNCTION: GET /api/masteredLocations/countries
// ============================================

/**
 * GET /api/masteredLocations/countries
 * Retrieve mastered countries with pagination
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - isActive: Filter by active status (optional boolean string)
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 100, max: 500)
 *
 * Response: { countries: [...], pagination: { total, page, limit, pages } }
 */
async function masteredCountriesGetHandler(request, context) {
    context.log('MasteredLocations_Countries: Request received');

    let mongoClient;

    try {
        const appId = request.query.get('appId') || '1';
        const isActiveParam = request.query.get('isActive');
        const page = parseInt(request.query.get('page') || '1', 10);
        const limit = Math.min(500, Math.max(1, parseInt(request.query.get('limit') || '100', 10)));
        const skip = (page - 1) * limit;

        context.log(`Fetching mastered countries: appId=${appId}, page=${page}, limit=${limit}`);

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('masteredcountries');

        // Build query filter
        const query = { appId };
        if (isActiveParam !== null && isActiveParam !== undefined) {
            query.isActive = isActiveParam === 'true';
        }

        // Execute query with pagination
        const [countries, total] = await Promise.all([
            collection.find(query).sort({ countryName: 1 }).skip(skip).limit(limit).toArray(),
            collection.countDocuments(query)
        ]);

        context.log(`Found ${countries.length} mastered countries (page ${page}/${Math.ceil(total / limit)}, total: ${total})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                countries: countries || [],
                pagination: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('MasteredLocations_Countries', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'masteredLocations/countries',
    handler: standardMiddleware(masteredCountriesGetHandler)
});

// ============================================
// FUNCTION: GET /api/masteredLocations/regions
// ============================================

/**
 * GET /api/masteredLocations/regions
 * Retrieve mastered regions with optional country filter and population
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - countryId: Filter by masteredCountryId (optional)
 * - isActive: Filter by active status (optional boolean string)
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 100, max: 500)
 * - populate: "true" to lookup and attach country data (optional)
 *
 * Response: { regions: [...], pagination: { total, page, limit, pages } }
 */
async function masteredRegionsGetHandler(request, context) {
    context.log('MasteredLocations_Regions: Request received');

    let mongoClient;

    try {
        const appId = request.query.get('appId') || '1';
        const countryId = request.query.get('countryId');
        const isActiveParam = request.query.get('isActive');
        const page = parseInt(request.query.get('page') || '1', 10);
        const limit = Math.min(500, Math.max(1, parseInt(request.query.get('limit') || '100', 10)));
        const skip = (page - 1) * limit;
        const populate = request.query.get('populate') === 'true';

        context.log(`Fetching mastered regions: appId=${appId}, countryId=${countryId}, page=${page}, limit=${limit}, populate=${populate}`);

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('masteredregions');

        // Build query filter
        const query = { appId };
        if (countryId) {
            query.masteredCountryId = new ObjectId(countryId);
        }
        if (isActiveParam !== null && isActiveParam !== undefined) {
            query.isActive = isActiveParam === 'true';
        }

        // Execute query with pagination
        const [regions, total] = await Promise.all([
            collection.find(query).sort({ regionName: 1 }).skip(skip).limit(limit).toArray(),
            collection.countDocuments(query)
        ]);

        // Populate country data if requested
        let populatedRegions = regions;
        if (populate && regions.length > 0) {
            const countriesCollection = db.collection('masteredcountries');
            const countryIds = [...new Set(
                regions
                    .map(r => r.masteredCountryId)
                    .filter(id => id)
                    .map(id => id.toString())
            )];

            if (countryIds.length > 0) {
                const countries = await countriesCollection
                    .find({ _id: { $in: countryIds.map(id => new ObjectId(id)) } })
                    .toArray();
                const countryMap = new Map(countries.map(c => [c._id.toString(), c]));

                populatedRegions = regions.map(region => ({
                    ...region,
                    masteredCountryId: region.masteredCountryId
                        ? countryMap.get(region.masteredCountryId.toString()) || region.masteredCountryId
                        : region.masteredCountryId
                }));
            }
        }

        context.log(`Found ${regions.length} mastered regions (page ${page}/${Math.ceil(total / limit)}, total: ${total})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regions: populatedRegions || [],
                pagination: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('MasteredLocations_Regions', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'masteredLocations/regions',
    handler: standardMiddleware(masteredRegionsGetHandler)
});

// ============================================
// FUNCTION: GET /api/masteredLocations/divisions
// ============================================

/**
 * GET /api/masteredLocations/divisions
 * Retrieve mastered divisions with optional region filter and population
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - regionId: Filter by masteredRegionId (optional)
 * - isActive: Filter by active status (optional boolean string)
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 100, max: 500)
 * - populate: "true" to lookup and attach region data (optional)
 *
 * Response: { divisions: [...], pagination: { total, page, limit, pages } }
 */
async function masteredDivisionsGetHandler(request, context) {
    context.log('MasteredLocations_Divisions: Request received');

    let mongoClient;

    try {
        const appId = request.query.get('appId') || '1';
        const regionId = request.query.get('regionId');
        const isActiveParam = request.query.get('isActive');
        const page = parseInt(request.query.get('page') || '1', 10);
        const limit = Math.min(500, Math.max(1, parseInt(request.query.get('limit') || '100', 10)));
        const skip = (page - 1) * limit;
        const populate = request.query.get('populate') === 'true';

        context.log(`Fetching mastered divisions: appId=${appId}, regionId=${regionId}, page=${page}, limit=${limit}, populate=${populate}`);

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('mastereddivisions');

        // Build query filter
        const query = { appId };
        if (regionId) {
            query.masteredRegionId = new ObjectId(regionId);
        }
        if (isActiveParam !== null && isActiveParam !== undefined) {
            query.isActive = isActiveParam === 'true';
        }

        // Execute query with pagination
        const [divisions, total] = await Promise.all([
            collection.find(query).sort({ divisionName: 1 }).skip(skip).limit(limit).toArray(),
            collection.countDocuments(query)
        ]);

        // Populate region data if requested
        let populatedDivisions = divisions;
        if (populate && divisions.length > 0) {
            const regionsCollection = db.collection('masteredregions');
            const regionIds = [...new Set(
                divisions
                    .map(d => d.masteredRegionId)
                    .filter(id => id)
                    .map(id => id.toString())
            )];

            if (regionIds.length > 0) {
                const regions = await regionsCollection
                    .find({ _id: { $in: regionIds.map(id => new ObjectId(id)) } })
                    .toArray();
                const regionMap = new Map(regions.map(r => [r._id.toString(), r]));

                populatedDivisions = divisions.map(division => ({
                    ...division,
                    masteredRegionId: division.masteredRegionId
                        ? regionMap.get(division.masteredRegionId.toString()) || division.masteredRegionId
                        : division.masteredRegionId
                }));
            }
        }

        context.log(`Found ${divisions.length} mastered divisions (page ${page}/${Math.ceil(total / limit)}, total: ${total})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                divisions: populatedDivisions || [],
                pagination: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('MasteredLocations_Divisions', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'masteredLocations/divisions',
    handler: standardMiddleware(masteredDivisionsGetHandler)
});

// ============================================
// FUNCTION: GET /api/masteredLocations/cities
// ============================================

/**
 * GET /api/masteredLocations/cities
 * Retrieve mastered cities with optional division filter and population
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - divisionId: Filter by masteredDivisionId (optional)
 * - isActive: Filter by isActive status (optional boolean string)
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 100, max: 500)
 * - populate: "true" to lookup and attach division data (optional)
 *
 * Response: { cities: [...], pagination: { total, page, limit, pages } }
 * Each city includes top-level latitude and longitude extracted from location.coordinates
 */
async function masteredCitiesGetHandler(request, context) {
    context.log('MasteredLocations_Cities: Request received');

    let mongoClient;

    try {
        const appId = request.query.get('appId') || '1';
        const divisionId = request.query.get('divisionId');
        const isActiveParam = request.query.get('isActive');
        const page = parseInt(request.query.get('page') || '1', 10);
        const limit = Math.min(500, Math.max(1, parseInt(request.query.get('limit') || '100', 10)));
        const skip = (page - 1) * limit;
        const populate = request.query.get('populate') === 'true';

        context.log(`Fetching mastered cities: appId=${appId}, divisionId=${divisionId}, page=${page}, limit=${limit}, populate=${populate}`);

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('masteredcities');

        // Build query filter
        const query = { appId };
        if (divisionId) {
            query.masteredDivisionId = new ObjectId(divisionId);
        }
        if (isActiveParam !== null && isActiveParam !== undefined) {
            query.isActive = isActiveParam === 'true';
        }

        // Execute query with pagination
        const [cities, total] = await Promise.all([
            collection.find(query).sort({ cityName: 1 }).skip(skip).limit(limit).toArray(),
            collection.countDocuments(query)
        ]);

        // Map cities to include top-level latitude and longitude from location.coordinates
        let mappedCities = cities.map(city => {
            const mapped = { ...city };
            if (city.location && city.location.coordinates && city.location.coordinates.length >= 2) {
                mapped.latitude = city.location.coordinates[1];
                mapped.longitude = city.location.coordinates[0];
            }
            return mapped;
        });

        // Populate division data if requested
        if (populate && mappedCities.length > 0) {
            const divisionsCollection = db.collection('mastereddivisions');
            const divisionIds = [...new Set(
                mappedCities
                    .map(c => c.masteredDivisionId)
                    .filter(id => id)
                    .map(id => id.toString())
            )];

            if (divisionIds.length > 0) {
                const divisions = await divisionsCollection
                    .find({ _id: { $in: divisionIds.map(id => new ObjectId(id)) } })
                    .toArray();
                const divisionMap = new Map(divisions.map(d => [d._id.toString(), d]));

                mappedCities = mappedCities.map(city => ({
                    ...city,
                    masteredDivisionId: city.masteredDivisionId
                        ? divisionMap.get(city.masteredDivisionId.toString()) || city.masteredDivisionId
                        : city.masteredDivisionId
                }));
            }
        }

        context.log(`Found ${cities.length} mastered cities (page ${page}/${Math.ceil(total / limit)}, total: ${total})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cities: mappedCities || [],
                pagination: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('MasteredLocations_Cities', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'masteredLocations/cities',
    handler: standardMiddleware(masteredCitiesGetHandler)
});

// ============================================
// FUNCTION: GET /api/masteredLocations/nearestMastered
// ============================================

/**
 * GET /api/masteredLocations/nearestMastered
 * Find the nearest mastered city using geospatial query, with deep population
 * of the full location hierarchy (city -> division -> region -> country)
 *
 * Query Parameters:
 * - latitude: Required - latitude coordinate
 * - longitude: Required - longitude coordinate
 * - maxDistance: Optional - maximum distance in meters
 * - isActive: Optional - filter by active status
 * - appId: Application ID (default: "1")
 *
 * Response: { cityID, cityName, distance, regionID, regionName,
 *             divisionID, divisionName, countryID, countryName,
 *             latitude, longitude }
 */
async function nearestMasteredGetHandler(request, context) {
    context.log('MasteredLocations_NearestMastered: Request received');

    let mongoClient;

    try {
        const latitude = request.query.get('latitude');
        const longitude = request.query.get('longitude');
        const maxDistance = request.query.get('maxDistance');
        const isActiveParam = request.query.get('isActive');
        const appId = request.query.get('appId') || '1';

        // Validate required parameters
        if (!latitude || !longitude) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'latitude and longitude are required' })
            };
        }

        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);

        if (isNaN(lat) || isNaN(lng)) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'latitude and longitude must be valid numbers' })
            };
        }

        context.log(`Finding nearest mastered city to lat=${lat}, lng=${lng}, maxDistance=${maxDistance}, appId=${appId}`);

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const citiesCollection = db.collection('masteredcities');

        // Build geospatial query
        const nearQuery = {
            $geometry: { type: 'Point', coordinates: [lng, lat] }
        };
        if (maxDistance) {
            nearQuery.$maxDistance = parseFloat(maxDistance);
        }

        const query = {
            appId,
            location: { $near: nearQuery }
        };

        if (isActiveParam !== null && isActiveParam !== undefined) {
            query.isActive = isActiveParam === 'true';
        }

        // Find the nearest city
        const city = await citiesCollection.findOne(query);

        if (!city) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'No mastered city found near the given coordinates' })
            };
        }

        // Deep populate: division -> region -> country
        const division = city.masteredDivisionId
            ? await db.collection('mastereddivisions').findOne({ _id: city.masteredDivisionId })
            : null;

        const region = division && division.masteredRegionId
            ? await db.collection('masteredregions').findOne({ _id: division.masteredRegionId })
            : null;

        const country = region && region.masteredCountryId
            ? await db.collection('masteredcountries').findOne({ _id: region.masteredCountryId })
            : null;

        // Extract coordinates from the city
        const cityLat = city.location && city.location.coordinates ? city.location.coordinates[1] : null;
        const cityLng = city.location && city.location.coordinates ? city.location.coordinates[0] : null;

        const result = {
            cityID: city._id,
            cityName: city.cityName || null,
            distance: null,
            regionID: region ? region._id : null,
            regionName: region ? region.regionName : null,
            divisionID: division ? division._id : null,
            divisionName: division ? division.divisionName : null,
            countryID: country ? country._id : null,
            countryName: country ? country.countryName : null,
            latitude: cityLat,
            longitude: cityLng
        };

        context.log(`Nearest mastered city: ${result.cityName} (${result.cityID})`);

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

app.http('MasteredLocations_NearestMastered', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'masteredLocations/nearestMastered',
    handler: standardMiddleware(nearestMasteredGetHandler)
});

// ============================================
// FUNCTION: GET /api/regions/activeRegions
// ============================================

/**
 * GET /api/regions/activeRegions
 * Retrieve active regions from the regions collection
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 100, max: 500)
 *
 * Response: { regions: [...], pagination: { total, page, limit, pages } }
 */
async function activeRegionsGetHandler(request, context) {
    context.log('Regions_ActiveRegions: Request received');

    let mongoClient;

    try {
        const appId = request.query.get('appId') || '1';
        const page = parseInt(request.query.get('page') || '1', 10);
        const limit = Math.min(500, Math.max(1, parseInt(request.query.get('limit') || '100', 10)));
        const skip = (page - 1) * limit;

        context.log(`Fetching active regions: appId=${appId}, page=${page}, limit=${limit}`);

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const collection = db.collection('regions');

        // Query for active regions
        const query = { active: true, appId };

        // Execute query with pagination
        const [regions, total] = await Promise.all([
            collection.find(query).skip(skip).limit(limit).toArray(),
            collection.countDocuments(query)
        ]);

        context.log(`Found ${regions.length} active regions (page ${page}/${Math.ceil(total / limit)}, total: ${total})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regions: regions || [],
                pagination: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Regions_ActiveRegions', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'regions/activeRegions',
    handler: standardMiddleware(activeRegionsGetHandler)
});
