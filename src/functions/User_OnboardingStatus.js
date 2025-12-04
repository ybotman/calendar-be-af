const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');
const { standardMiddleware } = require('../middleware');

/**
 * User Onboarding Status Checker
 *
 * @description Returns onboarding completion status and checklist progress
 * Used for State 4A/4B first-login onboarding flows (TIEMPO-329)
 *
 * @route GET /api/user/onboarding-status
 * @auth Required (Firebase Bearer token)
 *
 * @returns {OnboardingStatusResponse} Onboarding completion details
 *
 * @example
 * GET /api/user/onboarding-status
 * Authorization: Bearer <firebase-token>
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "onboardingComplete": false,
 *     "steps": {
 *       "locationSet": true,
 *       "categoriesSelected": false,
 *       "notificationsEnabled": false,
 *       "organizerProfileComplete": null
 *     },
 *     "completionPercentage": 33
 *   }
 * }
 */

async function onboardingStatusHandler(request, context) {
    context.log('User_OnboardingStatus: GET request received');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        };
    }

    let mongoClient;

    try {
        // Authenticate user
        const user = await firebaseAuth(request, context);
        if (!user) {
            return unauthorizedResponse();
        }

        const firebaseUid = user.uid;
        context.log(`Checking onboarding status for user: ${firebaseUid}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const usersCollection = db.collection('userlogins');
        const cloudDefaultCollection = db.collection('CloudDefault');

        // Find user profile
        const userProfile = await usersCollection.findOne(
            { firebaseUid: firebaseUid },
            {
                projection: {
                    roles: 1,
                    fcmTokens: 1,
                    favoriteCategories: 1,
                    backendInfo: 1
                }
            }
        );

        if (!userProfile) {
            return {
                status: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'UserNotFound',
                    message: 'User profile not found',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Check if user is an Event Organizer
        const isOrganizer = userProfile.roles?.includes('RegionalOrganizer') &&
                           userProfile.backendInfo?.regionalOrganizerInfo?.isEnabled === true;

        // STEP 1: Check if location (MapCenter) is set
        const mapCenter = await cloudDefaultCollection.findOne({
            owner: firebaseUid,
            defaultType: 'MapCenter'
        });
        const locationSet = mapCenter !== null;

        // STEP 2: Check if favorite categories are selected
        const categoriesSelected = Array.isArray(userProfile.favoriteCategories) &&
                                   userProfile.favoriteCategories.length > 0;

        // STEP 3: Check if notifications (FCM) are enabled
        const notificationsEnabled = Array.isArray(userProfile.fcmTokens) &&
                                     userProfile.fcmTokens.length > 0;

        // STEP 4: Check organizer profile completeness (only for organizers)
        let organizerProfileComplete = null;
        if (isOrganizer) {
            const organizerInfo = userProfile.backendInfo?.regionalOrganizerInfo;
            // Profile is complete if they have organizerId and bio/contact info
            organizerProfileComplete = !!(
                organizerInfo?.organizerId &&
                organizerInfo?.isApproved &&
                organizerInfo?.bio
            );
        }

        // Calculate completion percentage
        let totalSteps = 3; // locationSet, categoriesSelected, notificationsEnabled
        let completedSteps = 0;

        if (locationSet) completedSteps++;
        if (categoriesSelected) completedSteps++;
        if (notificationsEnabled) completedSteps++;

        // Add organizer step if applicable
        if (isOrganizer) {
            totalSteps++;
            if (organizerProfileComplete) completedSteps++;
        }

        const completionPercentage = Math.round((completedSteps / totalSteps) * 100);
        const onboardingComplete = completedSteps === totalSteps;

        context.log(`Onboarding status for ${firebaseUid}: ${completionPercentage}% (${completedSteps}/${totalSteps})`);

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: JSON.stringify({
                success: true,
                data: {
                    onboardingComplete: onboardingComplete,
                    steps: {
                        locationSet: locationSet,
                        categoriesSelected: categoriesSelected,
                        notificationsEnabled: notificationsEnabled,
                        organizerProfileComplete: organizerProfileComplete
                    },
                    completionPercentage: completionPercentage,
                    completedSteps: completedSteps,
                    totalSteps: totalSteps
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        // Let errorHandler middleware handle the error
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

// Register function with standard middleware
app.http('User_OnboardingStatus', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'user/onboarding-status',
    handler: standardMiddleware(onboardingStatusHandler)
});
