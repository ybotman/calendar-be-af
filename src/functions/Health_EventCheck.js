// src/functions/Health_EventCheck.js
// Timer-triggered health check that verifies Events API returns data
// Runs hourly, alerts if Boston events for next week returns 0 or error

const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');

/**
 * Health_EventCheck - Hourly timer that checks Events API health
 *
 * Checks: Boston events for next 7 days
 * Alerts: Logs custom event to App Insights if 0 results or error
 *
 * Schedule: Every hour at minute 0 (0 * * * *)
 */
async function eventHealthCheckHandler(myTimer, context) {
    const startTime = Date.now();
    const checkName = 'Health_EventCheck';
    const city = 'Boston';
    const appId = '1';

    context.log(`${checkName}: Starting hourly event health check`);

    let client = null;
    let status = 'healthy';
    let eventCount = 0;
    let errorMessage = null;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MONGODB_URI not configured');
        }

        client = new MongoClient(mongoUri, {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000
        });

        await client.connect();
        const db = client.db();
        const eventsCollection = db.collection('events');

        // Query: Boston events for next 7 days
        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);

        const query = {
            appId: appId,
            masteredCityName: city,
            isActive: true,
            startDate: {
                $gte: now,
                $lte: nextWeek
            }
        };

        eventCount = await eventsCollection.countDocuments(query);

        context.log(`${checkName}: Found ${eventCount} events in ${city} for next 7 days`);

        // Check for zero events (potential issue)
        if (eventCount === 0) {
            status = 'warning';
            errorMessage = `Zero events found in ${city} for next 7 days`;
            context.warn(`${checkName}: WARNING - ${errorMessage}`);
        }

    } catch (error) {
        status = 'error';
        errorMessage = error.message;
        context.error(`${checkName}: ERROR - ${errorMessage}`);
    } finally {
        if (client) {
            try {
                await client.close();
            } catch (closeError) {
                context.error(`${checkName}: Error closing connection: ${closeError.message}`);
            }
        }
    }

    const duration = Date.now() - startTime;

    // Log custom event for App Insights tracking
    // Azure Monitor can alert on these custom events
    const healthResult = {
        checkName,
        status,
        city,
        eventCount,
        errorMessage,
        durationMs: duration,
        timestamp: new Date().toISOString(),
        timerScheduled: myTimer.scheduleStatus?.last,
        timerNext: myTimer.scheduleStatus?.next
    };

    // Always log the result (App Insights will capture this)
    context.log(`${checkName}: Result`, JSON.stringify(healthResult));

    // Log as custom trace with severity for alerting
    if (status === 'error') {
        context.error(`ALERT: EventHealthCheck FAILED - ${errorMessage}`, healthResult);
    } else if (status === 'warning') {
        context.warn(`ALERT: EventHealthCheck WARNING - ${errorMessage}`, healthResult);
    }

    return healthResult;
}

// Timer trigger: runs every hour at minute 0
// CRON: second minute hour day month weekday
// "0 0 * * * *" = at second 0, minute 0, every hour
app.timer('Health_EventCheck', {
    schedule: '0 0 * * * *',  // Every hour at :00
    handler: eventHealthCheckHandler,
    runOnStartup: false  // Set to true to test immediately on deploy
});
