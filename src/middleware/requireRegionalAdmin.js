// src/middleware/requireRegionalAdmin.js
// Regional Admin authentication and authorization middleware for Azure Functions v4
const { firebaseAuth } = require('./firebaseAuth');
const { MongoClient, ObjectId } = require('mongodb');

/**
 * Regional Admin Permission Checker
 * Validates that user has RegionalAdmin role and proper permissions
 *
 * @param {import('@azure/functions').HttpRequest} request - Azure Functions request
 * @param {import('@azure/functions').InvocationContext} context - Azure Functions context
 * @returns {Promise<Object|null>} User object with RA permissions, or null if unauthorized
 *
 * Returns user object with:
 *   - firebaseUserId: Firebase UID
 *   - userRecord: Full user document from MongoDB
 *   - localAdminInfo: Admin configuration
 *   - allowedRegions: Array of allowed region ObjectIds
 *   - allowedDivisions: Array of allowed division ObjectIds
 *   - allowedCities: Array of allowed city ObjectIds
 */
async function requireRegionalAdmin(request, context) {
    let mongoClient;

    try {
        // Step 1: Verify Firebase token
        const decodedToken = await firebaseAuth(request, context);
        if (!decodedToken) {
            context.log('RA Auth: Firebase authentication failed');
            return null;
        }

        const firebaseUserId = decodedToken.uid;
        const appId = request.query.get('appId') ||
                      (request.method !== 'GET' ? (await request.clone().json().catch(() => ({}))).appId : null) ||
                      '1';

        // Step 2: Connect to MongoDB and get user record
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const userLoginsCollection = db.collection('userlogins');
        const rolesCollection = db.collection('roles');

        // Get user record
        const userRecord = await userLoginsCollection.findOne({
            firebaseUserId: firebaseUserId,
            appId: appId
        });

        if (!userRecord) {
            context.log(`RA Auth: User record not found for ${firebaseUserId}`);
            return null;
        }

        // Step 3: Populate roles
        let roles = [];
        if (userRecord.roleIds && userRecord.roleIds.length > 0) {
            const roleObjectIds = userRecord.roleIds.map(id =>
                id instanceof ObjectId ? id : new ObjectId(id)
            );
            roles = await rolesCollection
                .find({ _id: { $in: roleObjectIds } })
                .toArray();
        }

        // Step 4: Check if user has RegionalAdmin role
        const hasRARole = roles.some(role =>
            role.roleNameCode === 'RA' || role.roleName === 'RegionalAdmin'
        );

        if (!hasRARole) {
            context.log(`RA Auth: User ${firebaseUserId} does not have RegionalAdmin role`);
            return null;
        }

        // Step 5: Check localAdminInfo status
        const adminInfo = userRecord.localAdminInfo;
        if (!adminInfo || !adminInfo.isEnabled || !adminInfo.isApproved) {
            context.log(`RA Auth: User ${firebaseUserId} RA access not approved or enabled`, {
                isEnabled: adminInfo?.isEnabled || false,
                isApproved: adminInfo?.isApproved || false
            });
            return null;
        }

        // Step 6: Check if user has at least one allowed location
        const hasAllowedLocations = (
            (adminInfo.allowedAdminMasteredRegionIds && adminInfo.allowedAdminMasteredRegionIds.length > 0) ||
            (adminInfo.allowedAdminMasteredDivisionIds && adminInfo.allowedAdminMasteredDivisionIds.length > 0) ||
            (adminInfo.allowedAdminMasteredCityIds && adminInfo.allowedAdminMasteredCityIds.length > 0)
        );

        if (!hasAllowedLocations) {
            context.log(`RA Auth: User ${firebaseUserId} has no administrative regions assigned`);
            return null;
        }

        context.log(`RA Auth: User ${firebaseUserId} authenticated as RegionalAdmin`);

        // Return enhanced user object
        return {
            firebaseUserId,
            userRecord,
            roles,
            localAdminInfo: adminInfo,
            allowedRegions: adminInfo.allowedAdminMasteredRegionIds || [],
            allowedDivisions: adminInfo.allowedAdminMasteredDivisionIds || [],
            allowedCities: adminInfo.allowedAdminMasteredCityIds || []
        };

    } catch (error) {
        context.log(`RA Auth Error: ${error.message}`);
        return null;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

/**
 * Check if RA user has permission for a specific event/venue (by location)
 * Implements hierarchical permissions: Region > Division > City
 *
 * @param {Object} raUser - RA user object from requireRegionalAdmin
 * @param {Object} entity - Event or Venue with masteredRegionId, masteredDivisionId, masteredCityId
 * @returns {Boolean} - True if user has permission
 */
function checkRAPermission(raUser, entity) {
    if (!raUser || !entity) return false;

    // Check Region-level permissions (grants access to all divisions/cities within)
    if (raUser.allowedRegions && raUser.allowedRegions.length > 0 && entity.masteredRegionId) {
        const hasRegionPermission = raUser.allowedRegions.some(
            regionId => regionId.toString() === entity.masteredRegionId.toString()
        );
        if (hasRegionPermission) return true;
    }

    // Check Division-level permissions (grants access to all cities within)
    if (raUser.allowedDivisions && raUser.allowedDivisions.length > 0 && entity.masteredDivisionId) {
        const hasDivisionPermission = raUser.allowedDivisions.some(
            divisionId => divisionId.toString() === entity.masteredDivisionId.toString()
        );
        if (hasDivisionPermission) return true;
    }

    // Check City-level permissions (most granular)
    if (raUser.allowedCities && raUser.allowedCities.length > 0 && entity.masteredCityId) {
        const hasCityPermission = raUser.allowedCities.some(
            cityId => cityId.toString() === entity.masteredCityId.toString()
        );
        if (hasCityPermission) return true;
    }

    return false;
}

/**
 * Helper to create standard 403 Forbidden response for RA
 */
function forbiddenResponse(message = 'RegionalAdmin access denied', errorCode = 'RA_ACCESS_DENIED') {
    return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: false,
            error: errorCode,
            message: message,
            timestamp: new Date().toISOString()
        })
    };
}

module.exports = {
    requireRegionalAdmin,
    checkRAPermission,
    forbiddenResponse
};
