// src/functions/Health_Version.js
const { app } = require('@azure/functions');
const packageJson = require('../../package.json');

app.http('Health_Version', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health/version',
  handler: async (request, context) => {
    context.log('Health version request received');

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'healthy',
        version: packageJson.version || '1.0.0',
        name: packageJson.name || 'calendar-be-af',
        description: packageJson.description || 'Azure Functions backend for Calendar application',
        node: process.version,
        azureFunctions: '4.x',
        timestamp: new Date().toISOString(),
        environment: {
          NODE_ENV: process.env.NODE_ENV || 'development',
          region: process.env.AZURE_REGION || 'unknown',
          functionApp: process.env.WEBSITE_SITE_NAME || 'local'
        }
      })
    };
  }
});