// src/functions/Roles.js
// Domain: Roles - GET endpoint for retrieving roles with pagination
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * GET /api/roles
 * Retrieve roles with pagination from MongoDB
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - limit: Results per page (default: 100, max: 500)
 * - page: Page number (default: 1)
 * - select: Comma-separated fields to return (optional)
 *
 * Response: { roles: [...], pagination: { total, page, limit, pages } }
 */
async function rolesGetHandler(request, context) {
    context.log('Roles_Get: Request received');

    let mongoClient;

    try {
        // Parse query parameters
        const appId = request.query.get('appId') || '1';
        const limit = Math.min(500, Math.max(1, parseInt(request.query.get('limit') || '100', 10)));
        const page = Math.max(1, parseInt(request.query.get('page') || '1', 10));
        const select = request.query.get('select');

        context.log(`Fetching roles: appId=${appId}, page=${page}, limit=${limit}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const rolesCollection = db.collection('roles');

        // Build query filter
        const query = { appId };

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
        const rolesQuery = rolesCollection
            .find(query, { projection: Object.keys(projection).length > 0 ? projection : undefined })
            .sort({ roleName: 1 })
            .skip(skip)
            .limit(limit);

        const roles = await rolesQuery.toArray();

        // Get total count for pagination info
        const total = await rolesCollection.countDocuments(query);
        const totalPages = Math.ceil(total / limit);

        context.log(`Found ${roles.length} roles (page ${page}/${totalPages}, total: ${total})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                roles,
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
app.http('Roles_Get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'roles',
    handler: standardMiddleware(rolesGetHandler)
});
