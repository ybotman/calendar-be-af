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
 * - range: Flexible time range (default: "3M")
 *     Format: {number}{unit} where unit is H|D|W|M|Yr, or "All"
 *     Examples: 1H, 3H, 24H, 1D, 7D, 1W, 2W, 1M, 3M, 6M, 1Yr, 2Yr, All
 *
 * @returns {HeatmapResponse} 7x24 matrix with traffic patterns
 *
 * @example
 * GET /api/analytics/visitor-heatmap?range=1H   (last 1 hour)
 * GET /api/analytics/visitor-heatmap?range=24H  (last 24 hours)
 * GET /api/analytics/visitor-heatmap?range=7D   (last 7 days)
 * GET /api/analytics/visitor-heatmap?range=2W   (last 2 weeks)
 * GET /api/analytics/visitor-heatmap?range=6M   (last 6 months)
 * GET /api/analytics/visitor-heatmap?range=1Yr  (last 1 year)
 * GET /api/analytics/visitor-heatmap?range=All  (all time)
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

// Helper: Initialize empty 7x24 matrix (DOW)
function initializeMatrix() {
    const matrix = {};
    DAYS_OF_WEEK.forEach(day => {
        matrix[day] = Array(24).fill(0);
    });
    return matrix;
}

// Helper: Initialize empty 31x24 matrix (DOM)
function initializeDomMatrix() {
    const matrix = {};
    for (let d = 1; d <= 31; d++) {
        matrix[d] = Array(24).fill(0);
    }
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

// Helper: Aggregate individual history events into DOW and DOM matrices
function aggregateHistoryData(docs, timeType) {
    const dayField = timeType === 'local' ? 'dayOfWeekLocal' : 'dayOfWeekZulu';
    const hourField = timeType === 'local' ? 'hourOfDayLocal' : 'hourOfDayZulu';
    const domField = timeType === 'local' ? 'dayOfMonthLocal' : 'dayOfMonthZulu';

    const dowMatrix = initializeMatrix();
    const domMatrix = initializeDomMatrix();

    docs.forEach(doc => {
        const day = doc[dayField];
        const hour = doc[hourField];
        const dom = doc[domField] || (doc.timestamp ? new Date(doc.timestamp).getUTCDate() : null);

        const hourInt = hour !== null && hour !== undefined ? parseInt(hour, 10) : -1;

        // DOW matrix
        if (day && DAYS_OF_WEEK.includes(day) && hourInt >= 0 && hourInt < 24) {
            dowMatrix[day][hourInt]++;
        }

        // DOM matrix (1-31)
        if (dom && dom >= 1 && dom <= 31 && hourInt >= 0 && hourInt < 24) {
            domMatrix[dom][hourInt]++;
        }
    });

    return { dowMatrix, domMatrix };
}

// Helper: Merge two DOW matrices
function mergeMatrices(matrix1, matrix2) {
    const merged = initializeMatrix();

    DAYS_OF_WEEK.forEach(day => {
        for (let h = 0; h < 24; h++) {
            merged[day][h] = Math.round(matrix1[day][h] + matrix2[day][h]);
        }
    });

    return merged;
}

// Helper: Merge two DOM matrices
function mergeDomMatrices(matrix1, matrix2) {
    const merged = initializeDomMatrix();

    for (let d = 1; d <= 31; d++) {
        for (let h = 0; h < 24; h++) {
            merged[d][h] = Math.round(matrix1[d][h] + matrix2[d][h]);
        }
    }

    return merged;
}

// Helper: Calculate DOM totals
function calculateDomTotals(matrix) {
    const byDom = {};
    let overall = 0;

    for (let d = 1; d <= 31; d++) {
        let dayTotal = 0;
        matrix[d].forEach(count => {
            dayTotal += count;
            overall += count;
        });
        byDom[d] = dayTotal;
    }

    return { byDom, overall };
}

// Helper: Find peak DOM
function findDomPeak(matrix) {
    let peakDom = null;
    let peakHour = null;
    let peakCount = 0;

    for (let d = 1; d <= 31; d++) {
        matrix[d].forEach((count, hour) => {
            if (count > peakCount) {
                peakCount = count;
                peakDom = d;
                peakHour = hour;
            }
        });
    }

    return {
        day: peakDom,
        hour: peakHour,
        count: peakCount
    };
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
        // Supports: NH (hours), ND (days), NW (weeks), NM (months), NYr (years), All
        // Examples: 1H, 3H, 1D, 7D, 1W, 2W, 1M, 3M, 6M, 1Yr, 2Yr, All
        let cutoffDate = null;
        let timeFilterLabel = 'All Time';

        if (rangeParam === 'ALL') {
            // No filter - all time
            cutoffDate = null;
            timeFilterLabel = 'All Time';
        } else {
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
        }

        context.log(`Time filter: ${timeFilterLabel}, cutoff: ${cutoffDate?.toISOString() || 'none'}`);

        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MongoDB connection string not configured');
        }

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();

        const db = mongoClient.db();

        let visitorDowMatrix = initializeMatrix();
        let visitorDomMatrix = initializeDomMatrix();
        let loginDowMatrix = initializeMatrix();
        let loginDomMatrix = initializeDomMatrix();
        let visitorCount = 0;
        let loginCount = 0;

        // Build time filter query
        const timeFilter = cutoffDate ? { timestamp: { $gte: cutoffDate } } : {};

        // Query VisitorTrackingHistory (for time-filtered data)
        if (includeVisitors) {
            context.log('Querying VisitorTrackingHistory...');
            const visitors = await db.collection('VisitorTrackingHistory').find(timeFilter).toArray();

            visitorCount = visitors.length;
            const visitorData = aggregateHistoryData(visitors, timeType);
            visitorDowMatrix = visitorData.dowMatrix;
            visitorDomMatrix = visitorData.domMatrix;

            context.log(`Processed ${visitorCount} visitor events`);
        }

        // Query UserLoginHistory (for time-filtered data)
        if (includeLogins) {
            context.log('Querying UserLoginHistory...');
            const logins = await db.collection('UserLoginHistory').find(timeFilter).toArray();

            loginCount = logins.length;
            const loginData = aggregateHistoryData(logins, timeType);
            loginDowMatrix = loginData.dowMatrix;
            loginDomMatrix = loginData.domMatrix;

            context.log(`Processed ${loginCount} login events`);
        }

        // Merge DOW matrices
        const heatmap = mergeMatrices(visitorDowMatrix, loginDowMatrix);

        // Merge DOM matrices
        const domHeatmap = mergeDomMatrices(visitorDomMatrix, loginDomMatrix);

        // Calculate DOW totals and peak
        const totals = calculateTotals(heatmap);
        const peak = findPeak(heatmap);

        // Calculate DOM totals and peak
        const domTotals = calculateDomTotals(domHeatmap);
        const domPeak = findDomPeak(domHeatmap);

        context.log('Heatmap generated successfully', {
            totalDataPoints: totals.overall,
            peakTime: peak.timestamp,
            domPeakDay: domPeak.day,
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
                    heatmap: heatmap,           // DOW heatmap (7x24)
                    domHeatmap: domHeatmap,     // DOM heatmap (31x24)
                    totals: totals,
                    domTotals: domTotals,
                    peak: peak,                 // DOW peak
                    domPeak: domPeak,           // DOM peak
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
    authLevel: 'function',
    route: 'analytics/visitor-heatmap',
    handler: standardMiddleware(visitorHeatmapHandler)
});
