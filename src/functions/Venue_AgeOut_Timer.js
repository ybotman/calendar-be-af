// src/functions/Venue_AgeOut_Timer.js
// Domain: Venues - Weekly timer for venue activity management (App ID 1 only)
// CALBEAF-58: Age out inactive venues, mark old venues invalid, reactivate venues with recent activity
// NOTE: This timer is specific to appId="1". Multi-app support requires separate ticket.
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');

// App-specific configuration - currently hardcoded to app 1
// TODO: Multi-app support - different apps may have different aging requirements
const APP_ID = "1";

/**
 * Weekly Timer: Venue Age-Out and Activity Management (App ID 1)
 *
 * Runs every Sunday at 3:00 AM UTC (weekly)
 * CRON: 0 0 3 * * 0
 *
 * Three operations:
 * 1. Age Out to Inactive: Venues with no events for >366 days -> isActive: false
 * 2. Age Out to Invalid: Venues with no events for >730 days (2 years) -> isArchived: true
 * 3. Reactivate: Inactive venues with recent event activity -> isActive: true (safety net for CALBEAF-57)
 */
async function venueAgeOutTimerHandler(myTimer, context) {
    const startTime = Date.now();
    context.log(`Venue_AgeOut_Timer_App1: Starting weekly venue activity management for appId=${APP_ID}`);

    // Calculate cutoff dates
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setDate(oneYearAgo.getDate() - 366);

    const twoYearsAgo = new Date(now);
    twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);

    context.log(`Venue_AgeOut_Timer: Cutoff dates - 1 year: ${oneYearAgo.toISOString()}, 2 years: ${twoYearsAgo.toISOString()}`);

    let mongoClient;
    const results = {
        agedOutToInactive: 0,
        agedOutToArchived: 0,
        reactivated: 0,
        errors: []
    };

    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();
        const venuesCollection = db.collection('venues');
        const eventsCollection = db.collection('events');

        // ============================================
        // OPERATION 1: Reactivate venues with recent activity
        // Safety net for CALBEAF-57 - catches any edge cases
        // ============================================
        try {
            context.log('Venue_AgeOut_Timer: Starting reactivation check...');

            // Find all inactive venues for this app
            const inactiveVenues = await venuesCollection.find({
                appId: APP_ID,
                isActive: false,
                isArchived: { $ne: true } // Don't reactivate archived venues
            }).toArray();

            for (const venue of inactiveVenues) {
                // Check if venue has any events in the past year
                const recentEventCount = await eventsCollection.countDocuments({
                    venueID: venue._id.toString(),
                    startDate: { $gte: oneYearAgo }
                });

                if (recentEventCount > 0) {
                    await venuesCollection.updateOne(
                        { _id: venue._id },
                        {
                            $set: {
                                isActive: true,
                                reactivatedAt: now,
                                reactivatedByTimer: true,
                                reactivationReason: `Found ${recentEventCount} events in past year`
                            }
                        }
                    );
                    results.reactivated++;
                    context.log(`Venue_AgeOut_Timer: Reactivated venue ${venue._id} (${venue.name || 'unnamed'}) - ${recentEventCount} recent events`);
                }
            }
            context.log(`Venue_AgeOut_Timer: Reactivation complete - ${results.reactivated} venues reactivated`);
        } catch (error) {
            results.errors.push(`Reactivation error: ${error.message}`);
            context.error(`Venue_AgeOut_Timer: Reactivation error: ${error.message}`);
        }

        // ============================================
        // OPERATION 2: Age out to Archived (>2 years no activity)
        // Run this BEFORE inactive check so we don't double-process
        // ============================================
        try {
            context.log('Venue_AgeOut_Timer: Starting archive check (>2 years)...');

            // Find active or inactive venues that aren't already archived (for this app)
            const potentialArchiveVenues = await venuesCollection.find({
                appId: APP_ID,
                isArchived: { $ne: true }
            }).toArray();

            for (const venue of potentialArchiveVenues) {
                // Check if venue has any events in the past 2 years
                const recentEventCount = await eventsCollection.countDocuments({
                    venueID: venue._id.toString(),
                    startDate: { $gte: twoYearsAgo }
                });

                if (recentEventCount === 0) {
                    await venuesCollection.updateOne(
                        { _id: venue._id },
                        {
                            $set: {
                                isActive: false,
                                isArchived: true,
                                archivedAt: now,
                                archivedReason: 'No events for 2+ years (CALBEAF-58 timer)'
                            }
                        }
                    );
                    results.agedOutToArchived++;
                    context.log(`Venue_AgeOut_Timer: Archived venue ${venue._id} (${venue.name || 'unnamed'}) - no events in 2+ years`);
                }
            }
            context.log(`Venue_AgeOut_Timer: Archive complete - ${results.agedOutToArchived} venues archived`);
        } catch (error) {
            results.errors.push(`Archive error: ${error.message}`);
            context.error(`Venue_AgeOut_Timer: Archive error: ${error.message}`);
        }

        // ============================================
        // OPERATION 3: Age out to Inactive (>1 year no activity)
        // ============================================
        try {
            context.log('Venue_AgeOut_Timer: Starting inactive check (>1 year)...');

            // Find currently active venues (not archived) for this app
            const activeVenues = await venuesCollection.find({
                appId: APP_ID,
                isActive: true,
                isArchived: { $ne: true }
            }).toArray();

            for (const venue of activeVenues) {
                // Check if venue has any events in the past year
                const recentEventCount = await eventsCollection.countDocuments({
                    venueID: venue._id.toString(),
                    startDate: { $gte: oneYearAgo }
                });

                if (recentEventCount === 0) {
                    await venuesCollection.updateOne(
                        { _id: venue._id },
                        {
                            $set: {
                                isActive: false,
                                deactivatedAt: now,
                                deactivatedReason: 'No events for 1+ year (CALBEAF-58 timer)'
                            }
                        }
                    );
                    results.agedOutToInactive++;
                    context.log(`Venue_AgeOut_Timer: Deactivated venue ${venue._id} (${venue.name || 'unnamed'}) - no events in 1+ year`);
                }
            }
            context.log(`Venue_AgeOut_Timer: Deactivation complete - ${results.agedOutToInactive} venues deactivated`);
        } catch (error) {
            results.errors.push(`Deactivation error: ${error.message}`);
            context.error(`Venue_AgeOut_Timer: Deactivation error: ${error.message}`);
        }

    } catch (error) {
        results.errors.push(`Fatal error: ${error.message}`);
        context.error(`Venue_AgeOut_Timer: Fatal error: ${error.message}`);
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }

    const duration = Date.now() - startTime;
    context.log(`Venue_AgeOut_Timer: Completed in ${duration}ms`, results);

    return {
        success: results.errors.length === 0,
        duration: `${duration}ms`,
        results
    };
}

// Register timer function - runs weekly on Sunday at 3:00 AM UTC
// Named App1 to indicate this is specific to appId="1"
app.timer('Venue_AgeOut_Timer_App1', {
    schedule: '0 0 3 * * 0', // CRON: second minute hour day month weekday
    handler: venueAgeOutTimerHandler
});
