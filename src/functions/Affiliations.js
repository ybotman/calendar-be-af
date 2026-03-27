// src/functions/Affiliations.js
// Domain: Affiliations - GET endpoint for barbershop societies and a cappella organizations
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * GET /api/affiliations
 * Retrieve affiliations (societies/organizations) with optional filtering
 *
 * Query Parameters:
 * - appId: Application ID (default: "2" for HarmonyJunction)
 * - isBarbershop: Filter by barbershop orgs (true/false)
 * - type: Filter by type ("singing" or "admin")
 * - region: Filter by region (partial match)
 * - limit: Results per page (default: 100, max: 500)
 * - page: Page number (default: 1)
 *
 * Response: { affiliations: [...], pagination: { total, page, limit, pages } }
 */
async function affiliationsGetHandler(request, context) {
    context.log('Affiliations_Get: Request received');

    let mongoClient;

    try {
        // Parse query parameters
        const appId = request.query.get('appId') || '2';
        const limit = Math.min(500, Math.max(1, parseInt(request.query.get('limit') || '100', 10)));
        const page = Math.max(1, parseInt(request.query.get('page') || '1', 10));
        const isBarbershop = request.query.get('isBarbershop');
        const type = request.query.get('type');
        const region = request.query.get('region');

        context.log(`Fetching affiliations: appId=${appId}, page=${page}, limit=${limit}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const affiliationsCollection = db.collection('affiliations');

        // Build query filter
        const query = { appId };

        // Optional filters
        if (isBarbershop !== null && isBarbershop !== undefined) {
            query.isBarbershop = isBarbershop === 'true';
        }

        if (type) {
            query.type = type;
        }

        if (region) {
            query.region = { $regex: region, $options: 'i' };
        }

        // Only active affiliations
        query.isActive = { $ne: false };

        // Calculate pagination
        const skip = (page - 1) * limit;

        // Execute query with pagination
        const affiliations = await affiliationsCollection
            .find(query)
            .sort({ abbr: 1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        // Get total count for pagination info
        const total = await affiliationsCollection.countDocuments(query);
        const totalPages = Math.ceil(total / limit);

        context.log(`Found ${affiliations.length} affiliations (page ${page}/${totalPages}, total: ${total})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                affiliations,
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
app.http('Affiliations_Get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'affiliations',
    handler: standardMiddleware(affiliationsGetHandler)
});
