// src/functions/Analytics_EventCreation.js
// Domain: Analytics - Event creation patterns by organizers

const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');

/**
 * Event Creation Analytics - When are organizers adding events?
 *
 * @route GET /api/analytics/event-creation
 * @auth anonymous
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - timeType: "local" | "zulu" (default: "local")
 * - days: How many days back to analyze (default: 90)
 *
 * @returns {Object} Heatmaps for DOW and DOM with hourly breakdown
 *
 * Response: {
 *   byDayOfWeek: { Sunday: [h0..h23], Monday: [...], ... },
 *   byDayOfMonth: { 1: count, 2: count, ..., 31: count },
 *   byHour: [h0..h23],
 *   totals: { byDow: {...}, byDom: {...}, byHour: [...], overall: N },
 *   peak: { dow: {...}, dom: {...}, hour: {...} },
 *   topOrganizers: [...],
 *   metadata: {...}
 * }
 */
async function eventCreationAnalyticsHandler(request, context) {
    const startTime = Date.now();
    context.log('Analytics_EventCreation: Request received');

    // Parse query parameters (Azure Functions v4 style)
    const url = new URL(request.url);
    const appId = url.searchParams.get('appId') || '1';
    const timeType = url.searchParams.get('timeType') || 'local';
    const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '90', 10)));

    let mongoClient;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db();

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        // Get all manual events - we'll extract creation time from _id (ObjectId contains timestamp)
        // Filter by _id timestamp if cutoff is needed
        const cutoffObjectId = ObjectId.createFromTime(Math.floor(cutoffDate.getTime() / 1000));

        const events = await db.collection('events').find({
            appId,
            isDiscovered: { $ne: true },
            _id: { $gte: cutoffObjectId }
        }).project({
            _id: 1,
            createdAt: 1,
            ownerOrganizerID: 1,
            ownerOrganizerShortName: 1
        }).toArray();

        context.log(`Found ${events.length} manual events created in last ${days} days`);

        // Initialize data structures
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const byDayOfWeek = {};
        dayNames.forEach(day => { byDayOfWeek[day] = new Array(24).fill(0); });

        const byDayOfMonth = {};
        for (let d = 1; d <= 31; d++) { byDayOfMonth[d] = 0; }

        const byHour = new Array(24).fill(0);
        const byDomHour = {}; // DOM × Hour matrix
        for (let d = 1; d <= 31; d++) { byDomHour[d] = new Array(24).fill(0); }

        const organizerCounts = {};

        // Process each event
        for (const event of events) {
            // Use createdAt if available, otherwise extract from ObjectId
            const date = event.createdAt
                ? new Date(event.createdAt)
                : event._id.getTimestamp();

            // Adjust for local time if requested (assume EST = UTC-5)
            let hour = date.getUTCHours();
            let dayOfWeek = date.getUTCDay();
            let dayOfMonth = date.getUTCDate();

            if (timeType === 'local') {
                // Adjust for EST (UTC-5)
                hour = (hour - 5 + 24) % 24;
                // Adjust day if hour wrapped
                if (date.getUTCHours() < 5) {
                    const localDate = new Date(date.getTime() - 5 * 60 * 60 * 1000);
                    dayOfWeek = localDate.getDay();
                    dayOfMonth = localDate.getDate();
                }
            }

            // Aggregate
            byDayOfWeek[dayNames[dayOfWeek]][hour]++;
            byDayOfMonth[dayOfMonth]++;
            byDomHour[dayOfMonth][hour]++;
            byHour[hour]++;

            // Track by organizer
            const orgName = event.ownerOrganizerShortName || 'UNKNOWN';
            organizerCounts[orgName] = (organizerCounts[orgName] || 0) + 1;
        }

        // Calculate totals
        const totals = {
            byDow: {},
            byDom: { ...byDayOfMonth },
            byHour: [...byHour],
            overall: events.length
        };

        dayNames.forEach(day => {
            totals.byDow[day] = byDayOfWeek[day].reduce((a, b) => a + b, 0);
        });

        // Find peaks
        const peakDow = Object.entries(totals.byDow).sort((a, b) => b[1] - a[1])[0];
        const peakDom = Object.entries(totals.byDom).sort((a, b) => b[1] - a[1])[0];
        const peakHourIdx = byHour.indexOf(Math.max(...byHour));

        const peak = {
            dow: { day: peakDow[0], count: peakDow[1] },
            dom: { day: parseInt(peakDom[0]), count: peakDom[1] },
            hour: { hour: peakHourIdx, count: byHour[peakHourIdx], label: formatHour(peakHourIdx) }
        };

        // Top organizers
        const topOrganizers = Object.entries(organizerCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([name, count]) => ({ name, count }));

        const duration = Date.now() - startTime;

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: {
                    byDayOfWeek,
                    byDayOfMonth,
                    byDomHour,
                    byHour,
                    totals,
                    peak,
                    topOrganizers
                },
                metadata: {
                    appId,
                    timeType,
                    daysAnalyzed: days,
                    cutoffDate: cutoffDate.toISOString(),
                    eventsAnalyzed: events.length,
                    generatedAt: new Date().toISOString(),
                    durationMs: duration
                }
            }, null, 2)
        };

    } catch (error) {
        context.error(`Analytics_EventCreation error: ${error.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: error.message })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

function formatHour(hour) {
    if (hour === 0) return '12:00 AM';
    if (hour === 12) return '12:00 PM';
    return hour < 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`;
}

app.http('Analytics_EventCreation', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'analytics/event-creation',
    handler: eventCreationAnalyticsHandler
});
