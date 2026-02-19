// src/functions/Admin_DataHealth.js
// Domain: Admin - Data health checks for CALOPS dashboard (CALOPS-41)

const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const admin = require('firebase-admin');

// Initialize Firebase Admin if not already initialized
function getFirebaseAdmin() {
    if (admin.apps.length === 0) {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(serviceAccount))
            });
        } else {
            admin.initializeApp({
                credential: admin.credential.applicationDefault()
            });
        }
    }
    return admin;
}

// Cache for data health results (5 minute TTL)
let healthCache = null;
let healthCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/ops/data-health
 * Returns all data quality issues in one call
 *
 * Requires function key for authentication.
 * Results are cached for 5 minutes to prevent performance issues.
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - refresh: "true" to bypass cache
 * - limit: Max items per category (default: 100)
 *
 * Response: {
 *   eventsWithoutVenue: [...],
 *   venuesMissingGeocoding: [...],
 *   venuesMissingMasteredCity: [...],
 *   eventsUsingInactiveVenue: [...],
 *   eventsWithBadVenueDenorm: [...],
 *   organizersNotLinkedToUser: [...],
 *   usersWithInvalidOrganizerId: [...],
 *   firebaseUsersWithoutUserlogin: [...],
 *   firebaseUsersWithoutEmail: [...],
 *   firebaseUsersDuplicateEmail: [...],
 *   userloginsDuplicateEmail: [...],
 *   expiredRecurringEventsStillActive: [...],
 *   eventsInPastStillActive: [...],
 *   venueQualityMetrics: { totalVenues, withMasteredCity, withGeocoding, pctMasteredCity, pctGeocoding },
 *   summary: { totalIssues, criticalCount, warningCount },
 *   cached: boolean,
 *   cachedAt: ISO string
 * }
 */
async function dataHealthHandler(request, context) {
    const startTime = Date.now();
    context.log('Admin_DataHealth: Request received');

    const appId = request.query.get('appId') || '1';
    const refresh = request.query.get('refresh') === 'true';
    const limit = Math.min(500, parseInt(request.query.get('limit') || '100', 10));

    // Check cache
    const now = Date.now();
    if (!refresh && healthCache && (now - healthCacheTime) < CACHE_TTL_MS) {
        context.log('Admin_DataHealth: Returning cached results');
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...healthCache,
                cached: true,
                cachedAt: new Date(healthCacheTime).toISOString()
            }, null, 2)
        };
    }

    let mongoClient;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db();

        const results = {
            eventsWithoutVenue: [],
            venuesMissingGeocoding: [],
            venuesMissingMasteredCity: [],
            eventsUsingInactiveVenue: [],
            eventsWithBadVenueDenorm: [],
            organizersNotLinkedToUser: [],
            usersWithInvalidOrganizerId: [],
            firebaseUsersWithoutUserlogin: [],
            firebaseUsersWithoutEmail: [],
            firebaseUsersDuplicateEmail: [],
            userloginsDuplicateEmail: [],
            expiredRecurringEventsStillActive: [],
            eventsInPastStillActive: [],
            venueQualityMetrics: {
                totalVenues: 0,
                withMasteredCity: 0,
                withGeocoding: 0,
                pctMasteredCity: 0,
                pctGeocoding: 0
            },
            summary: {
                totalIssues: 0,
                criticalCount: 0,
                warningCount: 0
            }
        };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 1. Events without venue
        context.log('Checking: Events without venue...');
        results.eventsWithoutVenue = await db.collection('events').find({
            appId,
            isActive: true,
            $or: [
                { venueId: null },
                { venueId: { $exists: false } }
            ]
        }).project({
            _id: 1,
            title: 1,
            ownerOrganizerID: 1,
            startDateTime: 1
        }).limit(limit).toArray();

        // 2. Venues missing geocoding
        context.log('Checking: Venues missing geocoding...');
        results.venuesMissingGeocoding = await db.collection('venues').find({
            appId,
            isActive: true,
            $or: [
                { geolocation: null },
                { geolocation: { $exists: false } },
                { 'geolocation.coordinates': { $size: 0 } },
                { 'geolocation.coordinates.0': 0, 'geolocation.coordinates.1': 0 }
            ]
        }).project({
            _id: 1,
            name: 1,
            city: 1,
            state: 1
        }).limit(limit).toArray();

        // 3. Venues missing masteredCityId
        context.log('Checking: Venues missing masteredCityId...');
        results.venuesMissingMasteredCity = await db.collection('venues').find({
            appId,
            isActive: true,
            $or: [
                { masteredCityId: null },
                { masteredCityId: { $exists: false } }
            ]
        }).project({
            _id: 1,
            name: 1,
            city: 1,
            state: 1
        }).limit(limit).toArray();

        // 3b. Venue quality metrics (% with masteredCity and geocoding)
        context.log('Calculating: Venue quality metrics...');
        const totalVenues = await db.collection('venues').countDocuments({ appId, isActive: true });
        const venuesWithMasteredCity = await db.collection('venues').countDocuments({
            appId,
            isActive: true,
            masteredCityId: { $exists: true, $nin: [null, ''] }
        });
        const venuesWithGeocoding = await db.collection('venues').countDocuments({
            appId,
            isActive: true,
            'geolocation.coordinates.0': { $ne: 0 },
            'geolocation.coordinates.1': { $ne: 0 }
        });
        results.venueQualityMetrics = {
            totalVenues,
            withMasteredCity: venuesWithMasteredCity,
            withGeocoding: venuesWithGeocoding,
            pctMasteredCity: totalVenues > 0 ? Math.round((venuesWithMasteredCity / totalVenues) * 100) : 0,
            pctGeocoding: totalVenues > 0 ? Math.round((venuesWithGeocoding / totalVenues) * 100) : 0
        };
        context.log(`  Venue quality: ${results.venueQualityMetrics.pctMasteredCity}% mastered, ${results.venueQualityMetrics.pctGeocoding}% geocoded`);

        // 3c. Events using inactive or unapproved venues
        context.log('Checking: Events using inactive/unapproved venues...');
        const eventsWithVenue = await db.collection('events').find({
            appId,
            isActive: true,
            venueId: { $exists: true, $nin: [null, ''] }
        }).project({
            _id: 1,
            title: 1,
            venueId: 1,
            startDateTime: 1
        }).limit(limit * 3).toArray();

        // Build set of valid venue IDs (active AND approved)
        const validVenueIds = new Set();
        const allVenues = await db.collection('venues').find({
            appId
        }).project({ _id: 1, isActive: 1, isApproved: 1, name: 1 }).toArray();

        const venueMap = new Map();
        for (const v of allVenues) {
            venueMap.set(v._id.toString(), v);
            if (v.isActive && v.isApproved !== false) {
                validVenueIds.add(v._id.toString());
            }
        }

        for (const event of eventsWithVenue) {
            const venueIdStr = event.venueId?.toString();
            if (venueIdStr && !validVenueIds.has(venueIdStr)) {
                const venue = venueMap.get(venueIdStr);
                results.eventsUsingInactiveVenue.push({
                    _id: event._id,
                    title: event.title,
                    startDateTime: event.startDateTime,
                    venueId: event.venueId,
                    venueName: venue?.name || 'Unknown',
                    venueIsActive: venue?.isActive ?? 'N/A',
                    venueIsApproved: venue?.isApproved ?? 'N/A'
                });
            }
            if (results.eventsUsingInactiveVenue.length >= limit) break;
        }

        // 3d. Events with bad venue denormalization (city/state/coords don't match venue)
        context.log('Checking: Events with bad venue denormalization...');
        const venuesForDenorm = await db.collection('venues').find({
            appId,
            isActive: true
        }).project({
            _id: 1,
            name: 1,
            city: 1,
            state: 1,
            'geolocation.coordinates': 1
        }).toArray();

        const venueDenormMap = new Map();
        for (const v of venuesForDenorm) {
            venueDenormMap.set(v._id.toString(), v);
        }

        const eventsToCheckDenorm = await db.collection('events').find({
            appId,
            isActive: true,
            venueId: { $exists: true, $nin: [null, ''] }
        }).project({
            _id: 1,
            title: 1,
            venueId: 1,
            startDateTime: 1,
            'denormalizedEventInfo.city': 1,
            'denormalizedEventInfo.state': 1,
            'denormalizedEventInfo.lat': 1,
            'denormalizedEventInfo.lng': 1
        }).limit(limit * 3).toArray();

        for (const event of eventsToCheckDenorm) {
            const venueIdStr = event.venueId?.toString();
            const venue = venueDenormMap.get(venueIdStr);
            if (!venue) continue;

            const denorm = event.denormalizedEventInfo || {};
            const issues = [];

            // Check city mismatch
            if (venue.city && denorm.city !== venue.city) {
                issues.push(`city: "${denorm.city || 'missing'}" vs "${venue.city}"`);
            }
            // Check state mismatch
            if (venue.state && denorm.state !== venue.state) {
                issues.push(`state: "${denorm.state || 'missing'}" vs "${venue.state}"`);
            }
            // Check coordinates mismatch (if venue has coords)
            const venueCoords = venue.geolocation?.coordinates;
            if (venueCoords && venueCoords[0] !== 0 && venueCoords[1] !== 0) {
                if (!denorm.lat || !denorm.lng ||
                    Math.abs(denorm.lng - venueCoords[0]) > 0.0001 ||
                    Math.abs(denorm.lat - venueCoords[1]) > 0.0001) {
                    issues.push(`coords mismatch`);
                }
            }

            if (issues.length > 0) {
                results.eventsWithBadVenueDenorm.push({
                    _id: event._id,
                    title: event.title,
                    startDateTime: event.startDateTime,
                    venueId: event.venueId,
                    venueName: venue.name,
                    issues: issues.join(', ')
                });
            }
            if (results.eventsWithBadVenueDenorm.length >= limit) break;
        }

        // 4. Organizers not linked to a user
        context.log('Checking: Organizers not linked to user...');
        results.organizersNotLinkedToUser = await db.collection('organizers').find({
            appId,
            isActive: true,
            $or: [
                { firebaseUserId: null },
                { firebaseUserId: { $exists: false } },
                { firebaseUserId: '' }
            ]
        }).project({
            _id: 1,
            fullName: 1,
            contactEmail: 1
        }).limit(limit).toArray();

        // 5. Users with invalid organizerId (organizerId that doesn't exist)
        context.log('Checking: Users with invalid organizerId...');
        const usersWithOrganizerId = await db.collection('userlogins').find({
            appId,
            organizerId: { $exists: true, $nin: [null, ''] }
        }).project({
            _id: 1,
            firebaseUserId: 1,
            organizerId: 1,
            email: 1
        }).limit(limit * 2).toArray();

        for (const user of usersWithOrganizerId) {
            try {
                const orgExists = await db.collection('organizers').findOne({
                    _id: new ObjectId(user.organizerId)
                });
                if (!orgExists) {
                    results.usersWithInvalidOrganizerId.push({
                        firebaseUserId: user.firebaseUserId,
                        organizerId: user.organizerId,
                        email: user.email
                    });
                }
            } catch (e) {
                // Invalid ObjectId format
                results.usersWithInvalidOrganizerId.push({
                    firebaseUserId: user.firebaseUserId,
                    organizerId: user.organizerId,
                    email: user.email,
                    error: 'Invalid ObjectId format'
                });
            }
            if (results.usersWithInvalidOrganizerId.length >= limit) break;
        }

        // 6. Firebase users checks
        context.log('Checking: Firebase users...');
        try {
            const firebaseAdmin = getFirebaseAdmin();
            const auth = firebaseAdmin.auth();

            // Get all Firebase users with their details
            const allFirebaseUsers = [];
            let nextPageToken;
            do {
                const listUsersResult = await auth.listUsers(1000, nextPageToken);
                for (const userRecord of listUsersResult.users) {
                    // Only include non-disabled users
                    if (!userRecord.disabled) {
                        allFirebaseUsers.push({
                            uid: userRecord.uid,
                            email: userRecord.email || null,
                            displayName: userRecord.displayName || null,
                            createdAt: userRecord.metadata.creationTime,
                            lastSignIn: userRecord.metadata.lastSignInTime
                        });
                    }
                }
                nextPageToken = listUsersResult.pageToken;
            } while (nextPageToken);

            context.log(`  Found ${allFirebaseUsers.length} active Firebase users`);

            // Get all userlogins firebaseUserIds for this appId
            const userlogins = await db.collection('userlogins').find({
                appId,
                firebaseUserId: { $exists: true, $nin: [null, ''] }
            }).project({ firebaseUserId: 1 }).toArray();

            const userloginUids = new Set(userlogins.map(u => u.firebaseUserId));
            context.log(`  Found ${userloginUids.size} userlogins records`);

            // Track emails for duplicate detection
            const emailCounts = new Map();

            // Process all Firebase users
            for (const fbUser of allFirebaseUsers) {
                // Check: Firebase users without userlogin
                if (!userloginUids.has(fbUser.uid)) {
                    if (results.firebaseUsersWithoutUserlogin.length < limit) {
                        results.firebaseUsersWithoutUserlogin.push({
                            firebaseUid: fbUser.uid,
                            email: fbUser.email,
                            displayName: fbUser.displayName,
                            createdAt: fbUser.createdAt,
                            lastSignIn: fbUser.lastSignIn
                        });
                    }
                }

                // Check: Firebase users without email
                if (!fbUser.email) {
                    if (results.firebaseUsersWithoutEmail.length < limit) {
                        results.firebaseUsersWithoutEmail.push({
                            firebaseUid: fbUser.uid,
                            displayName: fbUser.displayName,
                            createdAt: fbUser.createdAt,
                            lastSignIn: fbUser.lastSignIn
                        });
                    }
                }

                // Track email for duplicate detection
                if (fbUser.email) {
                    const lowerEmail = fbUser.email.toLowerCase();
                    if (!emailCounts.has(lowerEmail)) {
                        emailCounts.set(lowerEmail, []);
                    }
                    emailCounts.set(lowerEmail, [...emailCounts.get(lowerEmail), fbUser]);
                }
            }

            // Check: Duplicate emails
            for (const [email, users] of emailCounts) {
                if (users.length > 1) {
                    if (results.firebaseUsersDuplicateEmail.length < limit) {
                        results.firebaseUsersDuplicateEmail.push({
                            email: email,
                            count: users.length,
                            uids: users.map(u => u.uid.slice(0, 12) + '...').join(', ')
                        });
                    }
                }
            }

            context.log(`  Found ${results.firebaseUsersWithoutUserlogin.length} without userlogins`);
            context.log(`  Found ${results.firebaseUsersWithoutEmail.length} without email`);
            context.log(`  Found ${results.firebaseUsersDuplicateEmail.length} duplicate emails`);
        } catch (firebaseError) {
            context.warn(`Firebase check failed: ${firebaseError.message}`);
            // Don't fail the whole health check if Firebase is unavailable
        }

        // 6b. Userlogins with duplicate emails (MongoDB-side duplicates)
        // This catches orphaned records where user re-registered with new Firebase account
        context.log('Checking: Userlogins with duplicate emails...');
        const userloginEmailAgg = await db.collection('userlogins').aggregate([
            { $match: { appId, 'firebaseUserInfo.email': { $exists: true, $ne: null } } },
            { $group: {
                _id: { $toLower: '$firebaseUserInfo.email' },
                count: { $sum: 1 },
                records: { $push: {
                    id: '$_id',
                    firebaseUserId: '$firebaseUserId',
                    firstName: '$firstName',
                    lastName: '$lastName',
                    createdAt: '$createdAt',
                    roleIds: '$roleIds'
                }}
            }},
            { $match: { count: { $gt: 1 } } },
            { $limit: limit }
        ]).toArray();

        for (const dup of userloginEmailAgg) {
            results.userloginsDuplicateEmail.push({
                email: dup._id,
                count: dup.count,
                records: dup.records.map(r => ({
                    id: r.id?.toString(),
                    firebaseUserId: r.firebaseUserId ? r.firebaseUserId.slice(0, 12) + '...' : null,
                    name: [r.firstName, r.lastName].filter(Boolean).join(' ') || '(no name)',
                    createdAt: r.createdAt,
                    hasRoles: r.roleIds?.length > 0
                }))
            });
        }
        context.log(`  Found ${results.userloginsDuplicateEmail.length} duplicate emails in userlogins`);

        // 7. Expired recurring events still active
        context.log('Checking: Expired recurring events still active...');
        results.expiredRecurringEventsStillActive = await db.collection('events').find({
            appId,
            isActive: true,
            isRecurring: true,
            rruleEndDate: { $lt: today }
        }).project({
            _id: 1,
            title: 1,
            rruleEndDate: 1,
            ownerOrganizerID: 1
        }).limit(limit).toArray();

        // 8. Past events still active (non-recurring)
        context.log('Checking: Past events still active...');
        results.eventsInPastStillActive = await db.collection('events').find({
            appId,
            isActive: true,
            isRecurring: { $ne: true },
            startDateTime: { $lt: today }
        }).project({
            _id: 1,
            title: 1,
            startDateTime: 1,
            ownerOrganizerID: 1
        }).limit(limit).toArray();

        // Calculate summary
        results.summary.totalIssues =
            results.eventsWithoutVenue.length +
            results.venuesMissingGeocoding.length +
            results.venuesMissingMasteredCity.length +
            results.eventsUsingInactiveVenue.length +
            results.eventsWithBadVenueDenorm.length +
            results.organizersNotLinkedToUser.length +
            results.usersWithInvalidOrganizerId.length +
            results.firebaseUsersWithoutUserlogin.length +
            results.firebaseUsersWithoutEmail.length +
            results.firebaseUsersDuplicateEmail.length +
            results.userloginsDuplicateEmail.length +
            results.expiredRecurringEventsStillActive.length +
            results.eventsInPastStillActive.length;

        // Critical: data integrity issues
        results.summary.criticalCount =
            results.usersWithInvalidOrganizerId.length +
            results.firebaseUsersWithoutUserlogin.length +
            results.firebaseUsersDuplicateEmail.length +
            results.userloginsDuplicateEmail.length +
            results.eventsUsingInactiveVenue.length +
            results.eventsWithoutVenue.length;

        // Warning: data quality issues
        results.summary.warningCount =
            results.summary.totalIssues - results.summary.criticalCount;

        // Update cache
        healthCache = results;
        healthCacheTime = now;

        const duration = Date.now() - startTime;
        context.log(`Admin_DataHealth: Completed in ${duration}ms, found ${results.summary.totalIssues} issues`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...results,
                cached: false,
                generatedAt: new Date().toISOString(),
                durationMs: duration
            }, null, 2)
        };

    } catch (error) {
        context.error(`Admin_DataHealth error: ${error.message}`);
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
app.http('Admin_DataHealth', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'ops/data-health',
    handler: dataHealthHandler
});
