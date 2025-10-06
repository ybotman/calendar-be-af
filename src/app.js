const { app } = require('@azure/functions');

// Import function modules
require('./functions/calendar-api');
require('./functions/calendar-maintenance');
require('./functions/calendar-events');
require('./functions/API_Docs');

// Health check endpoint
app.http('health', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'health',
    handler: async (request, context) => {
        context.log('Health check requested');
        
        return {
            status: 200,
            body: {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                service: 'calendar-backend-functions'
            }
        };
    }
});

module.exports = { app };