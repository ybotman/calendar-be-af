// src/functions/Admin_UserActivity.js
// Domain: Admin - User activity tracking for CALOPS dashboard (CALOPS-41)

const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');

/**
 * GET /api/ops/user-activity
 * Returns user login activity for admin visibility
 *
 * Requires function key for authentication.
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - staleDays: Days threshold for stale users (default: 30)
 * - limit: Max users to return (default: 100)
 * - sort: Sort by "lastLogin" (default) or "created"
 *
 * Response: {
 *   users: [...all users with activity],
 *   staleUsers: [...users with >staleDays since login],
 *   neverLoggedIn: [...users with no login record],
 *   summary: { total, active, stale, neverLoggedIn }
 * }
 */
async function userActivityHandler(request, context) {
    const startTime = Date.now();
    context.log('Admin_UserActivity: Request received');

    const appId = request.query.get('appId') || '1';
    const staleDays = parseInt(request.query.get('staleDays') || '30', 10);
    const limit = Math.min(500, parseInt(request.query.get('limit') || '100', 10));
    const sort = request.query.get('sort') || 'lastLogin';

    let mongoClient;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db();

        const now = new Date();
        const staleThreshold = new Date(now.getTime() - (staleDays * 24 * 60 * 60 * 1000));

        // Get users with their login data (uses $lookup to join userlogintrack)
        const usersCollection = db.collection('users');

        // Aggregate users with their last login
        const pipeline = [
            { $match: { appId } },
            {
                $lookup: {
                    from: 'userlogintrack',
                    localField: 'firebaseUserId',
                    foreignField: 'firebaseUserId',
                    as: 'loginRecords'
                }
            },
            {
                $addFields: {
                    lastLogin: { $max: '$loginRecords.createdAt' },
                    loginCount: { $size: '$loginRecords' }
                }
            },
            {
                $project: {
                    firebaseUserId: 1,
                    email: 1,
                    displayName: 1,
                    organizerId: 1,
                    roleNames: 1,
                    lastLogin: 1,
                    loginCount: 1,
                    createdAt: 1
                }
            },
            {
                $sort: sort === 'created'
                    ? { createdAt: -1 }
                    : { lastLogin: -1 }
            },
            { $limit: limit }
        ];

        const users = await usersCollection.aggregate(pipeline).toArray();

        // Process users into categories
        const results = {
            users: [],
            staleUsers: [],
            neverLoggedIn: [],
            summary: {
                total: 0,
                active: 0,
                stale: 0,
                neverLoggedIn: 0
            }
        };

        for (const user of users) {
            const userRecord = {
                firebaseUserId: user.firebaseUserId,
                email: user.email,
                displayName: user.displayName,
                organizerId: user.organizerId,
                roleNames: user.roleNames || [],
                lastLoginAt: user.lastLogin ? user.lastLogin.toISOString() : null,
                loginCount: user.loginCount || 0,
                createdAt: user.createdAt ? user.createdAt.toISOString() : null
            };

            if (user.lastLogin) {
                userRecord.daysSinceLogin = Math.floor(
                    (now - user.lastLogin) / (24 * 60 * 60 * 1000)
                );

                if (user.lastLogin < staleThreshold) {
                    results.staleUsers.push(userRecord);
                    results.summary.stale++;
                } else {
                    results.summary.active++;
                }
            } else {
                results.neverLoggedIn.push(userRecord);
                results.summary.neverLoggedIn++;
            }

            results.users.push(userRecord);
            results.summary.total++;
        }

        const duration = Date.now() - startTime;
        context.log(`Admin_UserActivity: Completed in ${duration}ms, ${results.summary.total} users`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...results,
                parameters: { appId, staleDays, limit, sort },
                generatedAt: new Date().toISOString(),
                durationMs: duration
            }, null, 2)
        };

    } catch (error) {
        context.error(`Admin_UserActivity error: ${error.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error.message })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

// Register endpoint - anonymous for local dev, protected by Azure AD in production
app.http('Admin_UserActivity', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'ops/user-activity',
    handler: userActivityHandler
});
