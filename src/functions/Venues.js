const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

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
        const select = request.query.get('select');
        const populate = request.query.get('populate') === 'true';

        context.log(`Fetching venues: appId=${appId}, page=${page}, limit=${limit}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const venuesCollection = db.collection('Venues');

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
            const { ObjectId } = require('mongodb');
            query.masteredCityId = new ObjectId(cityId);
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

        // Execute query with pagination
        const venuesQuery = venuesCollection
            .find(query, { projection: Object.keys(projection).length > 0 ? projection : undefined })
            .sort({ name: 1 })
            .skip(skip)
            .limit(limit);

        let venues = await venuesQuery.toArray();

        // Get total count for pagination
        const total = await venuesCollection.countDocuments(query);
        const totalPages = Math.ceil(total / limit);

        // Populate masteredCityId if requested
        if (populate && venues.length > 0) {
            const citiesCollection = db.collection('masteredCities');
            const cityIds = [...new Set(venues
                .map(v => v.masteredCityId)
                .filter(id => id))];

            if (cityIds.length > 0) {
                const cities = await citiesCollection
                    .find({ _id: { $in: cityIds } })
                    .toArray();

                const cityMap = new Map(cities.map(c => [c._id.toString(), c]));

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
app.http('Venues_Get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'venues',
    handler: standardMiddleware(venuesGetHandler)
});
