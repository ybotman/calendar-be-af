const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * Visitor/Login Traffic Heatmap Analytics
 *
 * @description Generates Time of Day vs Day of Week heatmap showing traffic patterns
 * Aggregates data from VisitorTrackingHistory and UserLoginHistory collections
 * to create a 7x24 matrix of activity counts
 *
 * @route GET /api/analytics/visitor-heatmap
 * @auth anonymous
 *
 * Query Parameters:
 * - timeType: "local" | "zulu" (default: "local")
 * - includeLogins: boolean (default: true)
 * - includeVisitors: boolean (default: true)
 * - range: "1H" | "1D" | "1W" | "1M" | "3M" | "1Yr" | "All" (default: "3M")
 *
 * @returns {HeatmapResponse} 7x24 matrix with traffic patterns
 *
 * @example
 * GET /api/analytics/visitor-heatmap?range=1H
 * GET /api/analytics/visitor-heatmap?range=1D
 * GET /api/analytics/visitor-heatmap?range=1W
 * GET /api/analytics/visitor-heatmap?range=3M
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "heatmap": {
 *       "Monday": [1, 0, 0, 2, 5, 12, 25, ...],
 *       "Tuesday": [...],
 *       ...
 *     },
 *     "totals": {
 *       "byDay": { "Monday": 456, "Tuesday": 423, ... },
 *       "byHour": { "0": 15, "1": 8, ... },
 *       "overall": 2832
 *     },
 *     "peak": {
 *       "day": "Thursday",
 *       "hour": 17,
 *       "count": 45,
 *       "timestamp": "Thursday at 5:00 PM"
 *     }
 *   }
 * }
 */

// Helper: Day of week order
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Helper: Format hour as 12-hour time
function formatHour(hour) {
    if (hour === 0) return '12:00 AM';
    if (hour < 12) return `${hour}:00 AM`;
    if (hour === 12) return '12:00 PM';
    return `${hour - 12}:00 PM`;
}

// Helper: Initialize empty 7x24 matrix
function initializeMatrix() {
    const matrix = {};
    DAYS_OF_WEEK.forEach(day => {
        matrix[day] = Array(24).fill(0);
    });
    return matrix;
}

// Helper: Aggregate hour/day data from MongoDB documents
function aggregateData(docs, timeType) {
    const hourField = timeType === 'local' ? 'visitsByHourLocal' : 'visitsByHourZulu';
    const dayField = timeType === 'local' ? 'visitsByDayOfWeekLocal' : 'visitsByDayOfWeekZulu';
    const loginHourField = timeType === 'local' ? 'loginsByHourLocal' : 'loginsByHourZulu';
    const loginDayField = timeType === 'local' ? 'loginsByDayOfWeekLocal' : 'loginsByDayOfWeekZulu';

    const matrix = initializeMatrix();
    let totalCount = 0;

    docs.forEach(doc => {
        // Get hour data (support both visitor and login field names)
        const hourData = doc[hourField] || doc[loginHourField] || {};

        // Get day data (support both visitor and login field names)
        const dayData = doc[dayField] || doc[loginDayField] || {};

        // For each day, distribute hour counts
        DAYS_OF_WEEK.forEach(day => {
            const dayCount = dayData[day] || 0;

            if (dayCount > 0) {
                // Get hour distribution for this IP/user
                const hourCounts = {};
                let hourTotal = 0;

                for (let h = 0; h < 24; h++) {
                    const count = hourData[h] || 0;
                    hourCounts[h] = count;
                    hourTotal += count;
                }

                // If we have hour data, distribute proportionally
                if (hourTotal > 0) {
                    for (let h = 0; h < 24; h++) {
                        const proportion = hourCounts[h] / hourTotal;
                        matrix[day][h] += Math.round(dayCount * proportion);
                    }
                } else {
                    // No hour data - distribute evenly across day
                    for (let h = 0; h < 24; h++) {
                        matrix[day][h] += dayCount / 24;
                    }
                }
            }
        });
    });

    return matrix;
}

// Helper: Aggregate individual history events into matrix
function aggregateHistoryData(docs, timeType) {
    const dayField = timeType === 'local' ? 'dayOfWeekLocal' : 'dayOfWeekZulu';
    const hourField = timeType === 'local' ? 'hourOfDayLocal' : 'hourOfDayZulu';

    const matrix = initializeMatrix();

    docs.forEach(doc => {
        const day = doc[dayField];
        const hour = doc[hourField];

        // Only count if we have valid day/hour data
        if (day && DAYS_OF_WEEK.includes(day) && hour !== null && hour !== undefined) {
            const hourInt = parseInt(hour, 10);
            if (hourInt >= 0 && hourInt < 24) {
                matrix[day][hourInt]++;
            }
        }
    });

    return matrix;
}

// Helper: Merge two matrices
function mergeMatrices(matrix1, matrix2) {
    const merged = initializeMatrix();

    DAYS_OF_WEEK.forEach(day => {
        for (let h = 0; h < 24; h++) {
            merged[day][h] = Math.round(matrix1[day][h] + matrix2[day][h]);
        }
    });

    return merged;
}

// Helper: Calculate totals from matrix
function calculateTotals(matrix) {
    const byDay = {};
    const byHour = Array(24).fill(0);
    let overall = 0;

    DAYS_OF_WEEK.forEach(day => {
        let dayTotal = 0;
        matrix[day].forEach((count, hour) => {
            dayTotal += count;
            byHour[hour] += count;
            overall += count;
        });
        byDay[day] = dayTotal;
    });

    return { byDay, byHour, overall };
}

// Helper: Find peak time
function findPeak(matrix) {
    let peakDay = null;
    let peakHour = null;
    let peakCount = 0;

    DAYS_OF_WEEK.forEach(day => {
        matrix[day].forEach((count, hour) => {
            if (count > peakCount) {
                peakCount = count;
                peakDay = day;
                peakHour = hour;
            }
        });
    });

    return {
        day: peakDay,
        hour: peakHour,
        count: peakCount,
        timestamp: peakDay && peakHour !== null ? `${peakDay} at ${formatHour(peakHour)}` : null
    };
}

async function visitorHeatmapHandler(request, context) {
    context.log('Analytics_VisitorHeatmap: GET request received');

    let mongoClient;

    try {
        // Parse query parameters
        const url = new URL(request.url);
        const timeType = url.searchParams.get('timeType') || 'local';
        const includeLogins = url.searchParams.get('includeLogins') !== 'false';
        const includeVisitors = url.searchParams.get('includeVisitors') !== 'false';

        // Time range param: 1H, 1D, 1W, 1M, 3M, 1Yr, All
        const rangeParam = (url.searchParams.get('range') || '3M').toUpperCase();

        // Validate timeType
        if (timeType !== 'local' && timeType !== 'zulu') {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid timeType. Must be "local" or "zulu"',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Calculate time filter cutoff based on range
        let cutoffDate = null;
        let timeFilterLabel = 'all time';

        const RANGE_CONFIG = {
            '1H':  { hours: 1,    label: 'Last 1 Hour' },
            '1D':  { days: 1,    label: 'Last 1 Day' },
            '1W':  { days: 7,    label: 'Last 1 Week' },
            '1M':  { months: 1,  label: 'Last 1 Month' },
            '3M':  { months: 3,  label: 'Last 3 Months' },
            '1YR': { months: 12, label: 'Last 1 Year' },
            'ALL': { all: true,  label: 'All Time' }
        };

        const rangeConfig = RANGE_CONFIG[rangeParam] || RANGE_CONFIG['3M'];
        timeFilterLabel = rangeConfig.label;

        if (rangeConfig.hours) {
            cutoffDate = new Date(Date.now() - rangeConfig.hours * 60 * 60 * 1000);
        } else if (rangeConfig.days) {
            cutoffDate = new Date(Date.now() - rangeConfig.days * 24 * 60 * 60 * 1000);
        } else if (rangeConfig.months) {
            cutoffDate = new Date();
            cutoffDate.setMonth(cutoffDate.getMonth() - rangeConfig.months);
        }
        // If rangeConfig.all, cutoffDate stays null (no filter)

        context.log(`Time filter: ${timeFilterLabel}, cutoff: ${cutoffDate?.toISOString() || 'none'}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();

        let visitorMatrix = initializeMatrix();
        let loginMatrix = initializeMatrix();
        let visitorCount = 0;
        let loginCount = 0;

        // Build time filter query
        const timeFilter = cutoffDate ? { timestamp: { $gte: cutoffDate } } : {};

        // Query VisitorTrackingHistory (for time-filtered data)
        if (includeVisitors) {
            context.log('Querying VisitorTrackingHistory...');
            const visitors = await db.collection('VisitorTrackingHistory').find(timeFilter).toArray();

            visitorCount = visitors.length;
            visitorMatrix = aggregateHistoryData(visitors, timeType);

            context.log(`Processed ${visitorCount} visitor events`);
        }

        // Query UserLoginHistory (for time-filtered data)
        if (includeLogins) {
            context.log('Querying UserLoginHistory...');
            const logins = await db.collection('UserLoginHistory').find(timeFilter).toArray();

            loginCount = logins.length;
            loginMatrix = aggregateHistoryData(logins, timeType);

            context.log(`Processed ${loginCount} login events`);
        }

        // Merge matrices
        const heatmap = mergeMatrices(visitorMatrix, loginMatrix);

        // Calculate totals and peak
        const totals = calculateTotals(heatmap);
        const peak = findPeak(heatmap);

        context.log('Heatmap generated successfully', {
            totalDataPoints: totals.overall,
            peakTime: peak.timestamp,
            timeType
        });

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
            },
            body: JSON.stringify({
                success: true,
                data: {
                    heatmap: heatmap,
                    totals: totals,
                    peak: peak,
                    sources: {
                        userLogins: loginCount,
                        anonymousVisitors: visitorCount,
                        total: loginCount + visitorCount
                    },
                    metadata: {
                        timeType: timeType,
                        range: rangeParam,
                        timeFilter: timeFilterLabel,
                        cutoffDate: cutoffDate?.toISOString() || null,
                        includeLogins: includeLogins,
                        includeVisitors: includeVisitors,
                        generatedAt: new Date().toISOString(),
                        dataPoints: totals.overall
                    }
                },
                timestamp: new Date().toISOString()
            })
        };

    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

// Register function with standard middleware
app.http('Analytics_VisitorHeatmap', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'analytics/visitor-heatmap',
    handler: standardMiddleware(visitorHeatmapHandler)
});
