// src/functions/Metrics_Get.js
const { app } = require('@azure/functions');
const { lightweightMiddleware, getMetricsSummary } = require('../middleware');

// Metrics handler
async function metricsHandler(request, context) {
  const logger = context.logger;

  logger.info('Metrics request received');

  // Get metrics summary
  const summary = getMetricsSummary();

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      data: summary,
      timestamp: new Date().toISOString()
    })
  };
}

// Register function
app.http('Metrics_Get', {
  methods: ['GET'],
  authLevel: 'anonymous', // TODO: Add authentication in CALBEAF-39
  route: 'metrics',
  handler: lightweightMiddleware(metricsHandler)
});
