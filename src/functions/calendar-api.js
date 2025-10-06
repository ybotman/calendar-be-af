const { app } = require('@azure/functions');

// Calendar API endpoints
app.http('getCalendars', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'calendars',
    handler: async (request, context) => {
        context.log('Get calendars requested');
        
        try {
            // TODO: Replace with actual database query
            const mockCalendars = [
                {
                    id: '1',
                    name: 'Personal Calendar',
                    description: 'My personal events',
                    color: '#3498db',
                    isDefault: true
                },
                {
                    id: '2',
                    name: 'Work Calendar',
                    description: 'Work-related events',
                    color: '#e74c3c',
                    isDefault: false
                }
            ];
            
            return {
                status: 200,
                body: {
                    success: true,
                    data: mockCalendars,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            context.log.error('Error fetching calendars:', error);
            return {
                status: 500,
                body: {
                    success: false,
                    error: 'Failed to fetch calendars',
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

app.http('createCalendar', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'calendars',
    handler: async (request, context) => {
        context.log('Create calendar requested');
        
        try {
            const requestBody = await request.json();
            
            // TODO: Add validation with Joi
            // TODO: Replace with actual database insert
            const newCalendar = {
                id: Date.now().toString(),
                name: requestBody.name,
                description: requestBody.description || '',
                color: requestBody.color || '#3498db',
                isDefault: requestBody.isDefault || false,
                createdAt: new Date().toISOString()
            };
            
            return {
                status: 201,
                body: {
                    success: true,
                    data: newCalendar,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            context.log.error('Error creating calendar:', error);
            return {
                status: 500,
                body: {
                    success: false,
                    error: 'Failed to create calendar',
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

app.http('getCalendarById', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'calendars/{id}',
    handler: async (request, context) => {
        const calendarId = request.params.id;
        context.log(`Get calendar ${calendarId} requested`);
        
        try {
            // TODO: Replace with actual database query
            const mockCalendar = {
                id: calendarId,
                name: 'Sample Calendar',
                description: 'A sample calendar',
                color: '#3498db',
                isDefault: calendarId === '1'
            };
            
            return {
                status: 200,
                body: {
                    success: true,
                    data: mockCalendar,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            context.log.error(`Error fetching calendar ${calendarId}:`, error);
            return {
                status: 500,
                body: {
                    success: false,
                    error: 'Failed to fetch calendar',
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

app.http('updateCalendar', {
    methods: ['PUT'],
    authLevel: 'function',
    route: 'calendars/{id}',
    handler: async (request, context) => {
        const calendarId = request.params.id;
        context.log(`Update calendar ${calendarId} requested`);
        
        try {
            const requestBody = await request.json();
            
            // TODO: Add validation with Joi
            // TODO: Replace with actual database update
            const updatedCalendar = {
                id: calendarId,
                name: requestBody.name,
                description: requestBody.description,
                color: requestBody.color,
                isDefault: requestBody.isDefault,
                updatedAt: new Date().toISOString()
            };
            
            return {
                status: 200,
                body: {
                    success: true,
                    data: updatedCalendar,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            context.log.error(`Error updating calendar ${calendarId}:`, error);
            return {
                status: 500,
                body: {
                    success: false,
                    error: 'Failed to update calendar',
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

app.http('deleteCalendar', {
    methods: ['DELETE'],
    authLevel: 'function',
    route: 'calendars/{id}',
    handler: async (request, context) => {
        const calendarId = request.params.id;
        context.log(`Delete calendar ${calendarId} requested`);
        
        try {
            // TODO: Replace with actual database delete
            
            return {
                status: 200,
                body: {
                    success: true,
                    message: `Calendar ${calendarId} deleted successfully`,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            context.log.error(`Error deleting calendar ${calendarId}:`, error);
            return {
                status: 500,
                body: {
                    success: false,
                    error: 'Failed to delete calendar',
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});