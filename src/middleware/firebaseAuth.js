// Firebase Authentication Middleware for Azure Functions v4
const { verifyIdToken } = require('../lib/firebase-admin');

/**
 * Firebase Authentication Middleware
 * Validates Bearer token from Authorization header
 * Extracts firebaseUid and adds to request context
 *
 * @param {import('@azure/functions').HttpRequest} request - Azure Functions request
 * @param {import('@azure/functions').InvocationContext} context - Azure Functions context
 * @returns {Promise<Object|null>} Decoded token with user info, or null if unauthorized
 *
 * Usage in Azure Function:
 *   const user = await firebaseAuth(request, context);
 *   if (!user) {
 *     return { status: 401, body: { error: 'Unauthorized' } };
 *   }
 *   const firebaseUid = user.uid;
 */
async function firebaseAuth(request, context) {
    try {
        // Get Authorization header
        const authHeader = request.headers.get('authorization');

        if (!authHeader) {
            context.log('Missing Authorization header');
            return null;
        }

        // Extract Bearer token
        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            context.log('Invalid Authorization header format. Expected: Bearer <token>');
            return null;
        }

        const token = parts[1];

        // Verify Firebase ID token
        const decodedToken = await verifyIdToken(token);

        context.log(`User authenticated: ${decodedToken.uid}`);

        return decodedToken;

    } catch (error) {
        if (error.code === 'auth/id-token-expired') {
            context.log('Firebase token expired');
        } else if (error.code === 'auth/argument-error') {
            context.log('Invalid Firebase token format');
        } else {
            context.log('Firebase token verification failed:', error.message);
        }
        return null;
    }
}

/**
 * Helper to create standard 401 Unauthorized response
 * @param {string} message - Optional custom error message
 */
function unauthorizedResponse(message = 'Unauthorized - Valid Firebase token required') {
    return {
        status: 401,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            success: false,
            error: message,
            timestamp: new Date().toISOString()
        })
    };
}

module.exports = {
    firebaseAuth,
    unauthorizedResponse
};
