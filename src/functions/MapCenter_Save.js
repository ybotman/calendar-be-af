const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const Joi = require('joi');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');

/**
 * PUT /api/mapcenter
 * Save user's map center (lat, lng, zoom) to MongoDB
 *
 * Authentication: Required (Firebase Bearer token)
 * Request body: { lat: Number, lng: Number, zoom: Number }
 * Response: { lat, lng, zoom, updatedAt }
 */

// Joi validation schema for map center
const mapCenterSchema = Joi.object({
    lat: Joi.number()
        .min(-90)
        .max(90)
        .required()
        .messages({
            'number.min': 'Latitude must be between -90 and 90',
            'number.max': 'Latitude must be between -90 and 90',
            'any.required': 'Latitude is required'
        }),
    lng: Joi.number()
        .min(-180)
        .max(180)
        .required()
        .messages({
            'number.min': 'Longitude must be between -180 and 180',
            'number.max': 'Longitude must be between -180 and 180',
            'any.required': 'Longitude is required'
        }),
    zoom: Joi.number()
        .integer()
        .min(1)
        .max(20)
        .required()
        .messages({
            'number.min': 'Zoom must be between 1 and 20',
            'number.max': 'Zoom must be between 1 and 20',
            'any.required': 'Zoom is required'
        })
});

app.http('MapCenter_Save', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'mapcenter',
    handler: async (request, context) => {
        context.log('MapCenter_Save: Request received');

        let mongoClient;

        try {
            // Authenticate user
            const user = await firebaseAuth(request, context);
            if (!user) {
                return unauthorizedResponse();
            }

            const firebaseUid = user.uid;
            context.log(`Saving map center for user: ${firebaseUid}`);

            // Parse request body
            const requestBody = await request.json();

            // Validate request body
            const { error, value } = mapCenterSchema.validate(requestBody);
            if (error) {
                context.log.warn('Validation error:', error.details[0].message);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: {
                        success: false,
                        error: error.details[0].message,
                        timestamp: new Date().toISOString()
                    }
                };
            }

            // Prepare map center data
            const mapCenterData = {
                lat: value.lat,
                lng: value.lng,
                zoom: value.zoom,
                updatedAt: new Date()
            };

            // Connect to MongoDB
            const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
            if (!mongoUri) {
                throw new Error('MongoDB connection string not configured');
            }

            mongoClient = new MongoClient(mongoUri);
            await mongoClient.connect();

            const db = mongoClient.db();
            const usersCollection = db.collection('Users');

            // Update user's map center
            const result = await usersCollection.updateOne(
                { firebaseUserId: firebaseUid },
                { $set: { mapCenter: mapCenterData } }
            );

            if (result.matchedCount === 0) {
                context.log.warn('User not found in database');
                return {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                    body: {
                        success: false,
                        error: 'User not found',
                        timestamp: new Date().toISOString()
                    }
                };
            }

            context.log('Map center saved successfully');
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: {
                    success: true,
                    data: mapCenterData,
                    timestamp: new Date().toISOString()
                }
            };

        } catch (error) {
            context.log.error('Error saving map center:', error);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: {
                    success: false,
                    error: 'Failed to save map center',
                    timestamp: new Date().toISOString()
                }
            };
        } finally {
            if (mongoClient) {
                await mongoClient.close();
            }
        }
    }
});
