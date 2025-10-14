// Firebase Admin SDK singleton for Azure Functions
const admin = require('firebase-admin');

let firebaseApp = null;

/**
 * Initialize Firebase Admin SDK
 * Uses FIREBASE_JSON environment variable (base64 encoded service account)
 * Singleton pattern - only initializes once
 */
function initializeFirebase() {
    if (firebaseApp) {
        return firebaseApp;
    }

    try {
        const firebaseJson = process.env.FIREBASE_JSON;

        if (!firebaseJson) {
            throw new Error('FIREBASE_JSON environment variable not set');
        }

        // Decode base64 service account JSON
        const serviceAccount = JSON.parse(
            Buffer.from(firebaseJson, 'base64').toString('utf-8')
        );

        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id
        });

        console.log('Firebase Admin SDK initialized successfully');
        return firebaseApp;

    } catch (error) {
        console.error('Failed to initialize Firebase Admin SDK:', error.message);
        throw error;
    }
}

/**
 * Get Firebase Admin instance
 * Initializes if not already initialized
 */
function getFirebaseAdmin() {
    if (!firebaseApp) {
        initializeFirebase();
    }
    return admin;
}

/**
 * Verify Firebase ID token
 * @param {string} token - Firebase ID token from Authorization header
 * @returns {Promise<Object>} Decoded token with user info
 */
async function verifyIdToken(token) {
    const adminSDK = getFirebaseAdmin();
    return await adminSDK.auth().verifyIdToken(token);
}

module.exports = {
    initializeFirebase,
    getFirebaseAdmin,
    verifyIdToken
};
