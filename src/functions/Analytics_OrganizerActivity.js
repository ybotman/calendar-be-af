// src/functions/Analytics_OrganizerActivity.js
// Domain: Analytics - Event creation patterns by organizers

const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * Event Creation Analytics - When are organizers adding events?
 *
 * @route GET /api/analytics/event-creation
 * @auth anonymous
 *
 * Query Parameters:
 * - appId: Application ID (default: "1")
 * - timeType: "local" | "zulu" (default: "local")
 * - range: Flexible time range (default: "3M")
 *     Format: {number}{unit} where unit is H|D|W|M|Yr, or "All"
 *     Examples: 1H, 3H, 24H, 1D, 7D, 1W, 2W, 1M, 3M, 6M, 1Yr, 2Yr, All
 * - source: "all" | "manual" | "discovered" (default: "manual")
 *     all = all events, manual = human-created, discovered = AI-discovered
 *
 * @returns {Object} Heatmaps for DOW and DOM with hourly breakdown
 */
async function eventCreationAnalyticsHandler(request, context) {
    const startTime = Date.now();
    context.log('Analytics_OrganizerActivity: Request received');

    // Parse query parameters (Azure Functions v4 style)
    const url = new URL(request.url);
    const appId = url.searchParams.get('appId') || '1';
    const timeType = url.searchParams.get('timeType') || 'local';

    // Support both 'range' (new) and 'days' (legacy) params
    const rangeParam = (url.searchParams.get('range') || '').toUpperCase();
    const daysParam = url.searchParams.get('days');

    // Source filter: all, manual, discovered (default: manual for backward compat)
    const sourceParam = (url.searchParams.get('source') || 'manual').toLowerCase();

    let mongoClient;

    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db();

        // Calculate cutoff date based on range or days param
        let cutoffDate = null;
        let timeFilterLabel = 'All Time';

        if (rangeParam === 'ALL') {
            cutoffDate = null;
            timeFilterLabel = 'All Time';
        } else if (rangeParam) {
            // Parse format: number + unit (e.g., 3H, 7D, 2W, 6M, 1Yr)
            const match = rangeParam.match(/^(\d+)(H|D|W|M|YR)$/i);

            if (match) {
                const num = parseInt(match[1], 10);
                const unit = match[2].toUpperCase();

                switch (unit) {
                    case 'H':
                        cutoffDate = new Date(Date.now() - num * 60 * 60 * 1000);
                        timeFilterLabel = `Last ${num} Hour${num > 1 ? 's' : ''}`;
                        break;
                    case 'D':
                        cutoffDate = new Date(Date.now() - num * 24 * 60 * 60 * 1000);
                        timeFilterLabel = `Last ${num} Day${num > 1 ? 's' : ''}`;
                        break;
                    case 'W':
                        cutoffDate = new Date(Date.now() - num * 7 * 24 * 60 * 60 * 1000);
                        timeFilterLabel = `Last ${num} Week${num > 1 ? 's' : ''}`;
                        break;
                    case 'M':
                        cutoffDate = new Date();
                        cutoffDate.setMonth(cutoffDate.getMonth() - num);
                        timeFilterLabel = `Last ${num} Month${num > 1 ? 's' : ''}`;
                        break;
                    case 'YR':
                        cutoffDate = new Date();
                        cutoffDate.setFullYear(cutoffDate.getFullYear() - num);
                        timeFilterLabel = `Last ${num} Year${num > 1 ? 's' : ''}`;
                        break;
                }
            } else {
                // Invalid format - default to 3M
                cutoffDate = new Date();
                cutoffDate.setMonth(cutoffDate.getMonth() - 3);
                timeFilterLabel = 'Last 3 Months (default)';
            }
        } else if (daysParam) {
            // Legacy days param support
            const days = Math.min(365, Math.max(1, parseInt(daysParam, 10)));
            cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            timeFilterLabel = `Last ${days} Day${days > 1 ? 's' : ''}`;
        } else {
            // Default to 3 months
            cutoffDate = new Date();
            cutoffDate.setMonth(cutoffDate.getMonth() - 3);
            timeFilterLabel = 'Last 3 Months (default)';
        }

        // Build query filter
        const query = { appId };

        // Apply source filter
        if (sourceParam === 'manual') {
            query.isDiscovered = { $ne: true };
        } else if (sourceParam === 'discovered') {
            query.isDiscovered = true;
        }
        // 'all' = no isDiscovered filter

        // Add time filter using ObjectId if cutoffDate is set
        if (cutoffDate) {
            const cutoffObjectId = ObjectId.createFromTime(Math.floor(cutoffDate.getTime() / 1000));
            query._id = { $gte: cutoffObjectId };
        }

        // Get events with organizer IDs
        const events = await db.collection('events').find(query).project({
            _id: 1,
            createdAt: 1,
            ownerOrganizerID: 1
        }).toArray();

        context.log(`Found ${events.length} manual events, range: ${timeFilterLabel}`);

        // Get unique organizer IDs and fetch their names
        const organizerIds = [...new Set(events
            .map(e => e.ownerOrganizerID)
            .filter(id => id)
        )];

        // Fetch organizer names from organizers collection
        const organizerMap = {};
        if (organizerIds.length > 0) {
            const organizers = await db.collection('organizers').find({
                _id: { $in: organizerIds.map(id => {
                    try {
                        return new ObjectId(id);
                    } catch {
                        return id;
                    }
                })}
            }).project({
                _id: 1,
                shortName: 1,
                fullName: 1
            }).toArray();

            organizers.forEach(org => {
                organizerMap[org._id.toString()] = org.shortName || org.fullName || 'Unknown';
            });
        }

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

            // Track by organizer - use looked-up name
            const orgId = event.ownerOrganizerID;
            const orgName = orgId ? (organizerMap[orgId.toString()] || 'Unknown') : 'No Organizer';
            organizerCounts[orgName] = (organizerCounts[orgName] || 0) + 1;
        }

        // Calculate totals
        const totals = {
            byDow: {},
            byDom: { ...byDayOfMonth },
            byHour: [...byHour],
            total: events.length  // 'total' to match frontend expectations
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

        // Top organizers - return shortName to match frontend expectations
        const topOrganizers = Object.entries(organizerCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([shortName, count]) => ({ shortName, count }));

        const duration = Date.now() - startTime;

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600'
            },
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
                    source: sourceParam,
                    range: rangeParam || (daysParam ? `${daysParam}D` : '3M'),
                    timeFilter: timeFilterLabel,
                    cutoffDate: cutoffDate?.toISOString() || null,
                    eventsAnalyzed: events.length,
                    generatedAt: new Date().toISOString(),
                    durationMs: duration
                }
            }, null, 2)
        };

    } catch (error) {
        context.error(`Analytics_OrganizerActivity error: ${error.message}`);
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

// Register function with standard middleware
app.http('Analytics_OrganizerActivity', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'analytics/event-creation',
    handler: standardMiddleware(eventCreationAnalyticsHandler)
});
