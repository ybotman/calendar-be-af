// src/lib/syncFirebaseClaims.js
// Syncs Firebase custom claims based on MongoDB role assignments
// Used by: UserLogins.js (role-modifying endpoints)
// Related: TIEMPO-387 (Firestore messaging system)

const { getFirebaseAdmin } = require('./firebase-admin');

// Admin role names that grant Firestore write access
const ADMIN_ROLE_NAMES = ['SystemOwner', 'SystemAdmin'];

/**
 * Sync Firebase custom claims based on user's assigned roles
 * Sets { admin: true } if user has SA/SO role, { admin: false } otherwise
 *
 * @param {string} firebaseUserId - Firebase user ID
 * @param {Array} roleIds - Array of role ObjectIds assigned to user
 * @param {Object} db - MongoDB database instance
 * @param {string} appId - Application ID (default: '1')
 * @param {Object} context - Azure Functions context for logging (optional)
 * @returns {Promise<boolean>} - Whether user has admin claim after sync
 */
async function syncAdminClaim(firebaseUserId, roleIds, db, appId = '1', context = null) {
    const log = context ? context.log.bind(context) : console.log;

    try {
        // Look up admin roles by NAME (not hardcoded IDs)
        const adminRoles = await db.collection('roles').find({
            roleName: { $in: ADMIN_ROLE_NAMES },
            appId: appId
        }).toArray();

        const adminRoleIds = adminRoles.map(r => r._id.toString());

        // Check if any of user's roles are admin roles
        const userRoleIdStrings = roleIds.map(id => id.toString());
        const hasAdminRole = userRoleIdStrings.some(id => adminRoleIds.includes(id));

        // Set Firebase custom claim
        const admin = getFirebaseAdmin();
        await admin.auth().setCustomUserClaims(firebaseUserId, { admin: hasAdminRole });

        log(`[FIREBASE CLAIMS] firebaseUserId: ${firebaseUserId}, admin: ${hasAdminRole}`);

        return hasAdminRole;

    } catch (error) {
        // Log but don't throw - claims sync failure shouldn't block role update
        log(`[FIREBASE CLAIMS ERROR] firebaseUserId: ${firebaseUserId}, error: ${error.message}`);
        return false;
    }
}

/**
 * Check if a set of roleIds includes any admin roles
 * Useful for quick checks without setting claims
 *
 * @param {Array} roleIds - Array of role ObjectIds
 * @param {Object} db - MongoDB database instance
 * @param {string} appId - Application ID (default: '1')
 * @returns {Promise<boolean>} - Whether roleIds include an admin role
 */
async function hasAdminRole(roleIds, db, appId = '1') {
    const adminRoles = await db.collection('roles').find({
        roleName: { $in: ADMIN_ROLE_NAMES },
        appId: appId
    }).toArray();

    const adminRoleIds = adminRoles.map(r => r._id.toString());
    const userRoleIdStrings = roleIds.map(id => id.toString());

    return userRoleIdStrings.some(id => adminRoleIds.includes(id));
}

module.exports = {
    syncAdminClaim,
    hasAdminRole,
    ADMIN_ROLE_NAMES
};
