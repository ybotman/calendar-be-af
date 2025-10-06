// src/functions/Category_Get.js
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');

// MongoDB connection settings
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'TangoTiempo';

// Connection pooling - reuse connection across invocations
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  const db = client.db(dbName);

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

app.http('Category_Get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'categories',
  handler: async (request, context) => {
    // Extract query parameters
    const appId = request.query.get('appId');
    const page = request.query.get('page') || '1';
    const limit = request.query.get('limit') || '100';
    const select = request.query.get('select');

    // Log request details
    context.log('Categories GET request received:', { 
      appId, 
      page, 
      limit, 
      select,
      headers: Object.fromEntries(request.headers.entries())
    });

    // Validate required parameters
    if (!appId) {
      context.log.warn('Missing appId in categories request');
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'appId is required' })
      };
    }

    try {
      // Parse and validate pagination parameters
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
      const skip = (pageNum - 1) * limitNum;

      context.log(`Fetching categories for appId: ${appId} with pagination: page ${pageNum}, limit ${limitNum}`);

      // Connect to database
      const { db } = await connectToDatabase();
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

      // Execute queries in parallel for better performance
      const [categories, total] = await Promise.all([
        collection
          .find({ appId })
          .project(projection)
          .sort({ categoryName: 1 }) // Sort by categoryName as per schema
          .skip(skip)
          .limit(limitNum)
          .toArray(),
        collection.countDocuments({ appId })
      ]);

      context.log(`Found ${categories.length} categories for appId: ${appId} (page ${pageNum}/${Math.ceil(total/limitNum)})`);

      // Return response with pagination info matching Express version
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
      // Log detailed error information
      context.log.error('Error fetching categories:', error);
      context.log.error('Error stack:', error.stack);

      // Handle specific MongoDB errors
      if (error.name === 'MongoServerError' || error.name === 'MongoNetworkError') {
        return {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Database unavailable',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
          })
        };
      }

      // Generic error response
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Error fetching categories',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        })
      };
    }
  }
});