// src/functions/VoiceEvents.js
// Domain: Voice - Optimized event API for TangoVoice GPT
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { RRule } = require('rrule');
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

    // Parse start date at start of day, end date at end of day (in UTC)
    // This ensures events on the boundary days are included
    const parseStartDate = (dateStr) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return new Date(dateStr + 'T00:00:00Z');
        }
        return new Date(dateStr);
    };

    const parseEndDate = (dateStr) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return new Date(dateStr + 'T23:59:59Z');
        }
        return new Date(dateStr);
    };

    const startDate = parseStartDate(startParam);
    const endDate = parseEndDate(endParam);

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

        // Date filtering - matches calendar-be approach
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
            // ALL recurring events (no date filter) - calendar expands via RRULE
            {
                recurrenceRule: { $exists: true, $ne: null, $ne: '' }
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

        // Fetch events (no limit here - applied after RRULE expansion)
        const events = await eventsCollection
            .find(filter)
            .sort({ startDate: 1 })
            .toArray();

        // Get category names for mapping (field is categoryName, not name)
        const categories = await categoriesCollection.find({ appId }).toArray();
        const categoryMap = {};
        categories.forEach(cat => {
            categoryMap[cat._id.toString()] = cat.categoryName;
        });

        // If filtering by categoryId, also fetch that specific category (may not have appId match)
        let filteredCategoryName = null;
        if (categoryId && !categoryMap[categoryId]) {
            const filteredCategory = await categoriesCollection.findOne({ _id: new ObjectId(categoryId) });
            if (filteredCategory) {
                filteredCategoryName = filteredCategory.categoryName;
                categoryMap[categoryId] = filteredCategory.categoryName;
            }
        } else if (categoryId) {
            filteredCategoryName = categoryMap[categoryId];
        }

        // Get unique venue IDs and fetch venue data
        const venueIds = [...new Set(events.map(e => e.venueID).filter(Boolean))];
        const venues = venueIds.length > 0
            ? await venuesCollection.find({ _id: { $in: venueIds.map(id => typeof id === 'string' ? new ObjectId(id) : id) } }).toArray()
            : [];
        const venueMap = {};
        venues.forEach(v => {
            venueMap[v._id.toString()] = v;
        });

        // Helper: Parse RRULE to human-readable description
        const parseRecurrence = (rruleStr) => {
            if (!rruleStr) return null;

            const dayMap = { SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' };
            const freqMap = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' };

            let freq = '';
            let days = [];
            let until = null;

            const parts = rruleStr.split(';');
            for (const part of parts) {
                const [key, value] = part.split('=');
                if (key === 'FREQ') freq = freqMap[value] || value;
                if (key === 'BYDAY') days = value.split(',').map(d => dayMap[d] || d);
                if (key === 'UNTIL') until = value;
            }

            let description = freq;
            if (days.length > 0) {
                description += ` on ${days.join(', ')}`;
            }

            return { description, until };
        };

        // Helper: Expand recurring event into occurrences within date range
        const expandRecurringEvent = (event, queryStart, queryEnd, venueTimezone) => {
            if (!event.recurrenceRule) return [event];

            try {
                const eventStart = new Date(event.startDate);
                const tz = venueTimezone || 'America/New_York';

                // Convert UTC startDate to venue local time for DTSTART
                // This ensures BYDAY=TU means Tuesday in LOCAL time, not UTC
                const localParts = eventStart.toLocaleString('en-CA', {
                    timeZone: tz,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
                // Format: "2026-01-06, 19:30:00" -> "20260106T193000"
                const localDateStr = localParts.replace(/[^\d]/g, '').substring(0, 14);
                const formattedLocal = localDateStr.substring(0, 8) + 'T' + localDateStr.substring(8);

                // Build RRULE string with timezone-aware DTSTART
                const rruleStr = `DTSTART;TZID=${tz}:${formattedLocal}\nRRULE:${event.recurrenceRule}`;

                const rule = RRule.fromString(rruleStr);

                // Query range in venue local context - extend end by 1 day
                const rangeEnd = new Date(queryEnd);
                rangeEnd.setDate(rangeEnd.getDate() + 1);

                const occurrences = rule.between(queryStart, rangeEnd, true);

                if (occurrences.length === 0) return [];

                // Create expanded event for each occurrence
                // Preserve original time-of-day from event.startDate
                const originalHours = eventStart.getUTCHours();
                const originalMinutes = eventStart.getUTCMinutes();

                return occurrences.map(occurrenceDate => {
                    // rrule returns dates - set the original time
                    const newDate = new Date(occurrenceDate);
                    newDate.setUTCHours(originalHours, originalMinutes, 0, 0);

                    return {
                        ...event,
                        _originalStartDate: event.startDate,
                        startDate: newDate,
                        _isExpandedOccurrence: true
                    };
                });
            } catch (err) {
                // If RRULE parsing fails, return original event
                context.log(`RRULE parse error for event ${event._id}: ${err.message}`);
                return [event];
            }
        };

        // Separate recurring and non-recurring events, then expand recurring ones
        const nonRecurringEvents = events.filter(e => !e.recurrenceRule || e.recurrenceRule === '');
        const recurringEvents = events.filter(e => e.recurrenceRule && e.recurrenceRule !== '');

        // Expand all recurring events into occurrences (pass venue timezone for each)
        const expandedRecurring = recurringEvents.flatMap(e => {
            const venue = e.venueID ? venueMap[e.venueID.toString()] : null;
            const tz = venue?.timezone || 'America/New_York';
            return expandRecurringEvent(e, startDate, endDate, tz);
        });

        // Combine and sort by date
        const allEvents = [...nonRecurringEvents, ...expandedRecurring]
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
            .slice(0, limit);

        context.log(`Voice_Events: ${nonRecurringEvents.length} non-recurring, ${recurringEvents.length} recurring -> ${expandedRecurring.length} occurrences`);

        // Format events for voice
        const formattedEvents = allEvents.map(event => {
            const venue = event.venueID ? venueMap[event.venueID.toString()] : null;
            // Use filtered category name if available, otherwise fall back to event's primary category
            const categoryName = filteredCategoryName
                || (event.categoryFirstId ? categoryMap[event.categoryFirstId.toString()] : null)
                || 'Event';

            // Get venue timezone (default to Eastern if not set)
            const venueTimezone = venue?.timezone || 'America/New_York';

            // Check if event has recurrence rule
            const isRecurring = !!(event.recurrenceRule && event.recurrenceRule !== '');
            const recurrence = isRecurring ? parseRecurrence(event.recurrenceRule) : null;

            // Use original startDate for all events (simpler, matches calendar-be)
            const displayDate = new Date(event.startDate);

            // Format date in venue's local timezone: "Friday, January 10th"
            const dateFormatted = displayDate.toLocaleDateString('en-US', {
                timeZone: venueTimezone,
                weekday: 'long',
                month: 'long',
                day: 'numeric'
            });

            // Format time using venue display times if available (already in local time)
            // Otherwise convert UTC to venue timezone
            let timeFormatted = '';
            if (event.venueStartDisplay) {
                timeFormatted = event.venueEndDisplay
                    ? `${event.venueStartDisplay} - ${event.venueEndDisplay}`
                    : event.venueStartDisplay;
            } else if (event.startDate) {
                const startTime = new Date(event.startDate);
                timeFormatted = startTime.toLocaleTimeString('en-US', {
                    timeZone: venueTimezone,
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
                venueTimezone,
                isRecurring,
                recurrenceDescription: recurrence?.description || null,
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
