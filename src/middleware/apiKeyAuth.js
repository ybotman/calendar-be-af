// API Key Authentication Middleware for Azure Functions v4
// Used for service-to-service calls (AIDI → Fulton, etc.)

/**
 * API Key Authentication Middleware
 * Validates x-api-key header against OUTREACH_API_KEY env var
 *
 * @param {import('@azure/functions').HttpRequest} request - Azure Functions request
 * @param {import('@azure/functions').InvocationContext} context - Azure Functions context
 * @returns {boolean} true if valid, false if unauthorized
 *
 * Usage in Azure Function:
 *   if (!apiKeyAuth(request, context)) {
 *     return apiKeyUnauthorizedResponse();
 *   }
 */
function apiKeyAuth(request, context) {
    const apiKey = request.headers.get('x-api-key');
    const expectedKey = process.env.OUTREACH_API_KEY;

    if (!expectedKey) {
        context.log('OUTREACH_API_KEY environment variable not configured');
        return false;
    }

    if (!apiKey) {
        context.log('Missing x-api-key header');
        return false;
    }

    if (apiKey !== expectedKey) {
        context.log('Invalid API key');
        return false;
    }

    return true;
}

/**
 * Helper to create standard 401 response for API key auth failures
 */
function apiKeyUnauthorizedResponse() {
    return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: false,
            error: 'Unauthorized',
            message: 'Valid x-api-key header required',
            timestamp: new Date().toISOString()
        })
    };
}

module.exports = {
    apiKeyAuth,
    apiKeyUnauthorizedResponse
};
