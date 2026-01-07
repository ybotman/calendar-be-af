// src/functions/VoiceEvents.js
// Domain: Voice - Optimized event API for TangoVoice GPT
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

/**
 * GET /api/voice/events
 * Voice-optimized event listing for GPT/AI assistants
 *
 * Features:
 * - Pre-formatted dates for natural language
 * - Filters out expired recurring events
 * - Smaller response payload
 * - Summary field for GPT
 *
 * Query Parameters:
 * - appId: Application ID (required)
 * - start: Start date YYYY-MM-DD (required)
 * - end: End date YYYY-MM-DD (required)
 * - categoryId: Filter by category ObjectId (optional)
 * - limit: Max results (default: 20, max: 50)
 */
async function voiceEventsHandler(request, context) {
    const appId = request.query.get('appId');
    const startParam = request.query.get('start');
    const endParam = request.query.get('end');
    const categoryId = request.query.get('categoryId');
    const limit = Math.min(50, Math.max(1, parseInt(request.query.get('limit')) || 20));

    context.log('Voice_Events: Request received', { appId, start: startParam, end: endParam, categoryId, limit });

    // Validate required parameters
    if (!appId) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'appId is required' })
        };
    }

    if (!startParam || !endParam) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'start and end dates are required (YYYY-MM-DD)' })
        };
    }

    const startDate = new Date(startParam);
    const endDate = new Date(endParam);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD' })
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
        const eventsCollection = db.collection('events');
        const categoriesCollection = db.collection('categories');
        const venuesCollection = db.collection('Venues');

        // Calculate 1 month before query start for recurring event filter
        // Tighter window to exclude old recurring events (e.g., Nov events in Jan query)
        const oneMonthBeforeStart = new Date(startDate);
        oneMonthBeforeStart.setMonth(oneMonthBeforeStart.getMonth() - 1);

        // Build base filter
        const baseFilter = {
            appId,
            isActive: true,
            $or: [
                { isCanceled: { $exists: false } },
                { isCanceled: false }
            ]
        };

        // Add category filter if provided
        const andConditions = [];
        if (categoryId) {
            try {
                const categoryObjId = new ObjectId(categoryId);
                andConditions.push({
                    $or: [
                        { categoryFirstId: categoryObjId },
                        { categorySecondId: categoryObjId },
                        { categoryThirdId: categoryObjId }
                    ]
                });
            } catch (err) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Invalid categoryId format' })
                };
            }
        }

        // Date filtering with expired recurring event exclusion
        const dateConditions = [
            // Non-recurring events in date range
            {
                startDate: { $gte: startDate, $lte: endDate },
                $or: [
                    { recurrenceRule: { $exists: false } },
                    { recurrenceRule: null },
                    { recurrenceRule: '' }
                ]
            },
            // Recurring events - startDate within 1 month before query start AND not after query end
            {
                startDate: { $gte: oneMonthBeforeStart, $lte: endDate },
                $and: [
                    { recurrenceRule: { $exists: true } },
                    { recurrenceRule: { $ne: null } },
                    { recurrenceRule: { $ne: '' } }
                ]
            }
        ];

        // Build final filter
        let filter = {
            ...baseFilter,
            $or: dateConditions
        };

        if (andConditions.length > 0) {
            filter = {
                $and: [
                    { ...baseFilter, $or: dateConditions },
                    ...andConditions
                ]
            };
        }

        // Fetch events
        const events = await eventsCollection
            .find(filter)
            .sort({ startDate: 1 })
            .limit(limit)
            .toArray();

        // Get category names for mapping
        const categories = await categoriesCollection.find({ appId }).toArray();
        const categoryMap = {};
        categories.forEach(cat => {
            categoryMap[cat._id.toString()] = cat.name;
        });

        // Get unique venue IDs and fetch venue data
        const venueIds = [...new Set(events.map(e => e.venueID).filter(Boolean))];
        const venues = venueIds.length > 0
            ? await venuesCollection.find({ _id: { $in: venueIds.map(id => typeof id === 'string' ? new ObjectId(id) : id) } }).toArray()
            : [];
        const venueMap = {};
        venues.forEach(v => {
            venueMap[v._id.toString()] = v;
        });

        // Helper: Calculate next occurrence date for recurring events
        const getNextOccurrence = (originalDate, queryStart, queryEnd) => {
            const original = new Date(originalDate);
            const start = new Date(queryStart);
            const end = new Date(queryEnd);
            const dayOfWeek = original.getDay(); // 0=Sunday, 1=Monday, etc.

            // Find first occurrence of this day of week within query range
            const candidate = new Date(start);
            const startDayOfWeek = candidate.getDay();
            let daysToAdd = dayOfWeek - startDayOfWeek;
            if (daysToAdd < 0) daysToAdd += 7;

            candidate.setDate(candidate.getDate() + daysToAdd);

            // If candidate is within range, use it; otherwise use query start
            if (candidate >= start && candidate <= end) {
                return candidate;
            }
            return start;
        };

        // Format events for voice
        const formattedEvents = events.map(event => {
            const venue = event.venueID ? venueMap[event.venueID.toString()] : null;
            const categoryName = event.categoryFirstId
                ? categoryMap[event.categoryFirstId.toString()] || 'Event'
                : 'Event';

            // Check if event has recurrence rule
            const isRecurring = !!(event.recurrenceRule && event.recurrenceRule !== '');

            // For recurring events, calculate occurrence date within query range
            // For non-recurring events, use the original startDate
            let displayDate;
            if (isRecurring) {
                displayDate = getNextOccurrence(event.startDate, startDate, endDate);
            } else {
                displayDate = new Date(event.startDate);
            }

            // Format date: "Friday, January 10th"
            const dateFormatted = displayDate.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
            });

            // Format time using venue display times if available
            let timeFormatted = '';
            if (event.venueStartDisplay) {
                timeFormatted = event.venueEndDisplay
                    ? `${event.venueStartDisplay} - ${event.venueEndDisplay}`
                    : event.venueStartDisplay;
            } else if (event.startDate) {
                const startTime = new Date(event.startDate);
                timeFormatted = startTime.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
            }

            return {
                id: event._id.toString(),
                title: event.title,
                category: categoryName,
                dateFormatted,
                timeFormatted,
                venueName: venue?.name || event.venueName || 'TBD',
                venueCity: venue?.city || event.venueCityName || '',
                venueAddress: venue?.address || '',
                isRecurring,
                isCanceled: event.isCanceled || false,
                description: event.description ? event.description.substring(0, 200) : ''
            };
        });

        // Generate summary
        const categoryCount = {};
        formattedEvents.forEach(e => {
            categoryCount[e.category] = (categoryCount[e.category] || 0) + 1;
        });

        let summary = '';
        if (formattedEvents.length === 0) {
            summary = 'No events found for the specified criteria.';
        } else if (Object.keys(categoryCount).length === 1) {
            const cat = Object.keys(categoryCount)[0];
            const count = categoryCount[cat];
            summary = `Found ${count} ${cat.toLowerCase()}${count > 1 ? 's' : ''}.`;
        } else {
            const parts = Object.entries(categoryCount).map(([cat, count]) =>
                `${count} ${cat.toLowerCase()}${count > 1 ? 's' : ''}`
            );
            summary = `Found ${parts.join(', ')}.`;
        }

        context.log(`Voice_Events: Returning ${formattedEvents.length} events`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                summary,
                count: formattedEvents.length,
                events: formattedEvents
            })
        };

    } catch (error) {
        context.error('Voice_Events error:', error);
        throw error;
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Voice_Events', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'voice/events',
    handler: standardMiddleware(voiceEventsHandler)
});

module.exports = { voiceEventsHandler };
