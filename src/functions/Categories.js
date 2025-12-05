// src/functions/Categories.js
// Domain: Categories - All category operations
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

// ============================================
// FUNCTION: GET /api/categories
// ============================================

/**
 * GET /api/categories
 * Retrieve categories from MongoDB with pagination
 *
 * Query Parameters:
 * - appId: Application ID (1=TangoTiempo, 2=HarmonyJunction) (required)
 * - limit: Results per page (default: 100, max: 500)
 * - page: Page number (default: 1)
 * - select: Comma-separated fields to return (optional)
 *
 * Response: { categories: [...], pagination: { total, page, limit, pages } }
 */
async function categoriesGetHandler(request, context) {
    // Extract query parameters
    const appId = request.query.get('appId');
    const page = request.query.get('page') || '1';
    const limit = request.query.get('limit') || '100';
    const select = request.query.get('select');

    // Log request details
    context.log('Categories_Get: Request received', {
      appId,
      page,
      limit,
      select
    });

    // Validate required parameters
    if (!appId) {
      context.log('Missing appId in categories request');
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'appId is required' })
      };
    }

    let mongoClient;

    try {
      // Parse and validate pagination parameters
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
      const skip = (pageNum - 1) * limitNum;

      context.log(`Fetching categories for appId: ${appId} with pagination: page ${pageNum}, limit ${limitNum}`);

      // Connect to MongoDB
      const mongoUri = process.env.MONGODB_URI;
      if (!mongoUri) {
        throw new Error('MongoDB connection string not configured');
      }

      mongoClient = new MongoClient(mongoUri);
      await mongoClient.connect();

      const db = mongoClient.db();
      const collection = db.collection('categories');

      // Build projection from select parameter
      const projection = {};
      if (select) {
        select.split(',').forEach(field => {
          projection[field.trim()] = 1;
        });
        // Always include _id unless explicitly excluded
        if (!projection._id && !select.includes('-_id')) {
          projection._id = 1;
        }
      }

      // Build MongoDB query
      const categoryQuery = collection
        .find({ appId })
        .sort({ categoryName: 1 })
        .skip(skip)
        .limit(limitNum);

      // Apply projection if select is provided
      if (Object.keys(projection).length > 0) {
        categoryQuery.project(projection);
      }

      // Execute queries in parallel for better performance
      const [categories, total] = await Promise.all([
        categoryQuery.toArray(),
        collection.countDocuments({ appId })
      ]);

      context.log(`Found ${categories.length} categories for appId: ${appId} (page ${pageNum}/${Math.ceil(total/limitNum)})`);

      // Return response with pagination info
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories: categories || [],
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            pages: Math.ceil(total / limitNum)
          }
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
app.http('Categories_Get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'categories',
  handler: standardMiddleware(categoriesGetHandler)
});