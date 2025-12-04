// src/functions/Organizers.js
// Domain: Organizers - GET endpoint for retrieving organizers with filtering and pagination
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * GET /api/organizers
 * Retrieve organizers with filtering and pagination from MongoDB
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - limit: Results per page (default: 100, max: 500)
 * - page: Page number (default: 1)
 * - isActive: Filter by active status (optional)
 * - isEnabled: Filter by enabled status (optional)
 * - wantRender: Filter by render status (optional)
 * - includeHidden: Include hidden organizers (isVisible=false) (optional)
 * - masteredRegionId: Filter by mastered region ID (optional)
 * - masteredDivisionId: Filter by mastered division ID (optional)
 * - masteredCityId: Filter by mastered city ID (optional)
 * - select: Comma-separated fields to return (optional)
 *
 * Response: { organizers: [...], pagination: { total, page, limit, pages } }
 */
async function organizersGetHandler(request, context) {
    context.log('Organizers_Get: Request received');

    let mongoClient;

    try {
        // Parse query parameters
        const appId = request.query.get('appId') || '1';
        const limit = Math.min(500, Math.max(1, parseInt(request.query.get('limit') || '100', 10)));
        const page = Math.max(1, parseInt(request.query.get('page') || '1', 10));
        const isActiveParam = request.query.get('isActive');
        const isEnabledParam = request.query.get('isEnabled');
        const wantRenderParam = request.query.get('wantRender');
        const includeHidden = request.query.get('includeHidden') === 'true';
        const masteredRegionId = request.query.get('masteredRegionId') || request.query.get('organizerRegion');
        const masteredDivisionId = request.query.get('masteredDivisionId') || request.query.get('organizerDivision');
        const masteredCityId = request.query.get('masteredCityId') || request.query.get('organizerCity');
        const select = request.query.get('select');

        context.log(`Fetching organizers: appId=${appId}, page=${page}, limit=${limit}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const organizersCollection = db.collection('organizers');

        // Build query filter
        const query = { appId };

        // Filter by isVisible unless includeHidden is true
        if (!includeHidden) {
            query.isVisible = { $ne: false };
        }

        // Filter by isActive if provided
        if (isActiveParam !== null && isActiveParam !== undefined) {
            query.isActive = isActiveParam === 'true';
        }

        // Filter by isEnabled if provided
        if (isEnabledParam !== null && isEnabledParam !== undefined) {
            query.isEnabled = isEnabledParam === 'true';
        }

        // Filter by wantRender if provided
        if (wantRenderParam !== null && wantRenderParam !== undefined) {
            query.wantRender = wantRenderParam === 'true';
        }

        // Filter by location IDs if provided
        if (masteredRegionId) {
            query.masteredRegionId = masteredRegionId;
        }
        if (masteredDivisionId) {
            query.masteredDivisionId = masteredDivisionId;
        }
        if (masteredCityId) {
            query.masteredCityId = masteredCityId;
        }

        // Calculate pagination
        const skip = (page - 1) * limit;

        // Build projection if select is provided
        const projection = {};
        if (select) {
            select.split(',').forEach(field => {
                projection[field.trim()] = 1;
            });
        } else {
            // Default fields for better performance
            projection._id = 1;
            projection.fullName = 1;
            projection.shortName = 1;
            projection.isActive = 1;
            projection.isEnabled = 1;
            projection.wantRender = 1;
            projection.isVisible = 1;
            projection.firebaseUserId = 1;
            projection.organizerRegion = 1;
            projection.masteredRegionId = 1;
            projection.masteredDivisionId = 1;
            projection.masteredCityId = 1;
        }

        // Execute query with pagination
        const organizersQuery = organizersCollection
            .find(query, { projection: Object.keys(projection).length > 0 ? projection : undefined })
            .sort({ fullName: 1 })
            .skip(skip)
            .limit(limit);

        const organizers = await organizersQuery.toArray();

        // Get total count for pagination info
        const total = await organizersCollection.countDocuments(query);
        const totalPages = Math.ceil(total / limit);

        context.log(`Found ${organizers.length} organizers (page ${page}/${totalPages}, total: ${total})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                organizers,
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
app.http('Organizers_Get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'organizers',
    handler: standardMiddleware(organizersGetHandler)
});

/**
 * GET /api/organizers/{id}
 * Get single organizer by ID
 *
 * @param {string} id - Organizer ID (MongoDB ObjectId)
 */
async function organizersGetByIdHandler(request, context) {
    const organizerId = request.params.id;
    const appId = request.query.get('appId') || '1';

    context.log(`Organizers_GetById: Request for organizer ${organizerId}`);

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
        const collection = db.collection('organizers');

        // Find organizer by ID and appId
        const organizer = await collection.findOne({
            _id: new ObjectId(organizerId),
            appId
        });

        if (!organizer) {
            context.log(`Organizer not found: ${organizerId}`);
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Organizer not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        context.log(`Organizer found: ${organizerId}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(organizer)
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

app.http('Organizers_GetById', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'organizers/{id}',
    handler: standardMiddleware(organizersGetByIdHandler)
});
