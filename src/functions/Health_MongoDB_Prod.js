// src/functions/Health_MongoDB_Prod.js
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { lightweightMiddleware } = require('../middleware');

/**
 * MongoDB PROD Environment Health Check
 *
 * @description Verifies connection to PRODUCTION MongoDB database
 * @route GET /api/health/mongodb/prod
 * @access anonymous (local) | function (production)
 *
 * @returns {HealthResponse} MongoDB PROD connection status
 *
 * @example
 * GET /api/health/mongodb/prod
 *
 * Response:
 * {
 *   "status": "healthy",
 *   "environment": "production",
 *   "database": "tangotiempo",
 *   "connected": true,
 *   "timestamp": "2025-10-07T03:00:00.000Z"
 * }
 */
async function mongoProdHealthHandler(request, context) {
  const startTime = Date.now();
  let client = null;

  try {
    // Get PROD MongoDB connection string
    const mongoUri = process.env.MONGODB_URI_PROD || process.env.MONGODB_URI;

    if (!mongoUri) {
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'error',
          environment: 'production',
          error: 'MONGODB_URI_PROD not configured',
          connected: false,
          timestamp: new Date().toISOString()
        })
      };
    }

    // Connect to MongoDB with timeout
    client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });

    await client.connect();

    // Test actual query
    const db = client.db('tangotiempo');
    await db.admin().ping();

    const duration = Date.now() - startTime;

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'healthy',
        environment: 'production',
        database: 'tangotiempo',
        connected: true,
        responseTime: `${duration}ms`,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    context.error('MongoDB PROD health check failed:', error.message);

    return {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'unhealthy',
        environment: 'production',
        error: error.message,
        connected: false,
        responseTime: `${duration}ms`,
        timestamp: new Date().toISOString()
      })
    };
  } finally {
    // Always close the connection
    if (client) {
      try {
        await client.close();
      } catch (closeError) {
        context.error('Error closing MongoDB PROD connection:', closeError.message);
      }
    }
  }
}

// Register function with lightweight middleware
app.http('Health_MongoDB_Prod', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health/mongodb/prod',
  handler: lightweightMiddleware(mongoProdHealthHandler)
});
