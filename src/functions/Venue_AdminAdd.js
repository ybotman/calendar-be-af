// src/functions/Venue_AdminAdd.js
// Domain: Venues - Admin-only venue creation without distance limit
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');

/**
 * POST /api/venues/admin
 * Create a new venue WITHOUT the 100-yard proximity check
 *
 * REQUIRES: RegionalAdmin role (roleNameCode = "RA")
 *
 * Use case: Adding venues close to existing ones (e.g., multiple buildings
 * on a college campus, adjacent studios in the same building)
 *
 * Request Body:
 * - name: Venue name (required)
 * - latitude: Latitude coordinate (required)
 * - longitude: Longitude coordinate (required)
 * - address1, address2, address3: Address lines (optional)
 * - city, state, zip: Location (optional)
 * - phone, comments: Additional info (optional)
 * - masteredCityId, masteredDivisionId, masteredRegionId, masteredCountryId (optional)
 * - timezone: IANA timezone (optional, defaults to America/New_York)
 * - appId: Application ID (optional, defaults to "1")
 *
 * Response: Created venue object with _id
 */
async function venueAdminAddHandler(request, context) {
    context.log('Venue_AdminAdd: Request received');

    // Step 1: Verify Firebase authentication
    const decodedToken = await firebaseAuth(request, context);
    if (!decodedToken) {
        context.log('Venue_AdminAdd: Authentication failed');
        return unauthorizedResponse('Valid Firebase token required');
    }

    const firebaseUserId = decodedToken.uid;
    context.log(`Venue_AdminAdd: User authenticated - ${firebaseUserId}`);

    let mongoClient;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const userLoginsCollection = db.collection('userlogins');
        const rolesCollection = db.collection('roles');
        const venuesCollection = db.collection('venues');

        // Step 2: Look up user and verify RegionalAdmin role
        const user = await userLoginsCollection.findOne({ firebaseUserId });

        if (!user) {
            context.log(`Venue_AdminAdd: User not found in userlogins - ${firebaseUserId}`);
            return {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Forbidden',
                    message: 'User not registered in the system',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Step 3: Check for RegionalAdmin role
        const regionalAdminRole = await rolesCollection.findOne({
            roleNameCode: 'RA',
            appId: user.appId || '1'
        });

        if (!regionalAdminRole) {
            context.log('Venue_AdminAdd: RegionalAdmin role not found in database');
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ConfigurationError',
                    message: 'RegionalAdmin role not configured',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Check if user has the RegionalAdmin role
        const hasRARole = user.roleIds && user.roleIds.some(
            roleId => roleId.toString() === regionalAdminRole._id.toString()
        );

        if (!hasRARole) {
            context.log(`Venue_AdminAdd: User ${firebaseUserId} does not have RegionalAdmin role`);
            return {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Forbidden',
                    message: 'RegionalAdmin role required for this operation',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Step 4: Verify localAdminInfo is active
        const adminInfo = user.localAdminInfo;
        if (!adminInfo || !adminInfo.isApproved || !adminInfo.isEnabled || !adminInfo.isActive) {
            context.log(`Venue_AdminAdd: User ${firebaseUserId} admin privileges not active`);
            return {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Forbidden',
                    message: 'Admin privileges not active. Contact system administrator.',
                    timestamp: new Date().toISOString()
                })
            };
        }

        context.log(`Venue_AdminAdd: User ${firebaseUserId} verified as RegionalAdmin`);

        // Step 5: Parse and validate request body
        const body = await request.json();
        const appId = body.appId || '1';

        // Validate required fields
        if (!body.name) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'name is required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        if (body.latitude === undefined || body.longitude === undefined) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'latitude and longitude are required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        const latitude = parseFloat(body.latitude);
        const longitude = parseFloat(body.longitude);

        // Validate coordinate ranges
        if (isNaN(latitude) || latitude < -90 || latitude > 90) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'latitude must be between -90 and 90',
                    timestamp: new Date().toISOString()
                })
            };
        }

        if (isNaN(longitude) || longitude < -180 || longitude > 180) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'ValidationError',
                    message: 'longitude must be between -180 and 180',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Step 6: Check for EXACT duplicate (same name at same location)
        // We skip the 100-yard check but still prevent identical duplicates
        const exactDuplicate = await venuesCollection.findOne({
            appId,
            name: body.name,
            latitude,
            longitude
        });

        if (exactDuplicate) {
            return {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'DuplicateError',
                    message: 'A venue with this exact name and location already exists',
                    existingVenueId: exactDuplicate._id,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Step 7: Create venue document (NO proximity check)
        const newVenue = {
            appId,
            name: body.name,
            shortName: body.shortName || '',
            address1: body.address1 || '',
            address2: body.address2 || '',
            address3: body.address3 || '',
            city: body.city || '',
            state: body.state || '',
            zip: body.zip || '',
            phone: body.phone || '',
            comments: body.comments || '',
            latitude,
            longitude,
            geolocation: {
                type: 'Point',
                coordinates: [longitude, latitude]
            },
            masteredCityId: body.masteredCityId ? new ObjectId(body.masteredCityId) : null,
            masteredDivisionId: body.masteredDivisionId ? new ObjectId(body.masteredDivisionId) : null,
            masteredRegionId: body.masteredRegionId ? new ObjectId(body.masteredRegionId) : null,
            masteredCountryId: body.masteredCountryId ? new ObjectId(body.masteredCountryId) : null,
            timezone: body.timezone || 'America/New_York',
            country: body.country || 'US',
            isActive: body.isActive !== undefined ? body.isActive : true,
            isApproved: true, // Admin-created venues are auto-approved
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: firebaseUserId,
            createdByAdmin: true // Flag to indicate admin bypass of proximity check
        };

        const result = await venuesCollection.insertOne(newVenue);
        newVenue._id = result.insertedId;

        context.log(`[VENUE ADMIN CREATE] Name: "${newVenue.name}", VenueId: ${newVenue._id}, City: ${newVenue.city}, CreatedBy: ${firebaseUserId}`);

        return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...newVenue,
                message: 'Venue created successfully (admin bypass - no proximity check)',
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        context.error('Venue_AdminAdd error:', error);
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

// Register function with standard middleware
app.http('Venue_AdminAdd', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'venues/admin',
    handler: standardMiddleware(venueAdminAddHandler)
});

module.exports = { venueAdminAddHandler };
