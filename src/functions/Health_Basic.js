// src/functions/Health_Basic.js
const { app } = require('@azure/functions');
const { lightweightMiddleware } = require('../middleware');

// Health check handler (without middleware for raw response)
async function healthCheckHandler(request, context) {
  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'calendar-be-af',
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
      uptime: process.uptime()
    })
  };
}

// Register function with lightweight middleware
app.http('Health_Basic', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: lightweightMiddleware(healthCheckHandler)
});