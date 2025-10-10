// src/functions/Health_MongoDB.js
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { lightweightMiddleware } = require('../middleware');

/**
 * MongoDB General Health Check
 *
 * @description Verifies connection to default MongoDB database
 * @route GET /api/health/mongodb
 * @access anonymous (local) | function (production)
 *
 * @returns {HealthResponse} MongoDB connection status
 *
 * @example
 * GET /api/health/mongodb
 *
 * Response:
 * {
 *   "status": "healthy",
 *   "environment": "default",
 *   "database": "tangotiempo",
 *   "connected": true,
 *   "responseTime": "45ms",
 *   "timestamp": "2025-10-10T03:00:00.000Z"
 * }
 */
async function mongoHealthHandler(request, context) {
  const startTime = Date.now();
  let client = null;

  try {
    // Get default MongoDB connection string
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'error',
          environment: 'default',
          error: 'MONGODB_URI not configured',
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
        environment: 'default',
        database: 'tangotiempo',
        connected: true,
        responseTime: `${duration}ms`,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    context.log.error('MongoDB health check failed:', error.message);

    return {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'unhealthy',
        environment: 'default',
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
        context.log.error('Error closing MongoDB connection:', closeError.message);
      }
    }
  }
}

// Register function with lightweight middleware
app.http('Health_MongoDB', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health/mongodb',
  handler: lightweightMiddleware(mongoHealthHandler)
});
