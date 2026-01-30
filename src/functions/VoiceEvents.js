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
 * - Multi-category filtering
 * - Geo-location filtering
 *
 * Query Parameters:
 * - appId: Application ID (required)
 * - start: Start date YYYY-MM-DD (required)
 * - end: End date YYYY-MM-DD (required)
 * - categoryId: Filter by category - supports:
 *     - Single ObjectId: "66c4d370a87a956db06c49ea"
 *     - Multiple (comma-separated): "66c4d370a87a956db06c49ea,66c4d370a87a956db06c49e9"
 *     - Shortcuts: "social" (practica+milonga), "classes" (class+workshop+dayworkshop)
 * - lat: Latitude for geo filter (default: 42.3601 - Boston)
 * - lng: Longitude for geo filter (default: -71.0589 - Boston)
 * - range: Range in miles (default: 100)
 * - limit: Max results (default: 20, max: 50)
 */
async function voiceEventsHandler(request, context) {
    const appId = request.query.get('appId');
    const startParam = request.query.get('start');
    const endParam = request.query.get('end');
    const categoryIdParam = request.query.get('categoryId');
    const limit = Math.min(50, Math.max(1, parseInt(request.query.get('limit')) || 20));

    // Geo parameters with Boston defaults
    const lat = parseFloat(request.query.get('lat')) || 42.3601;
    const lng = parseFloat(request.query.get('lng')) || -71.0589;
    const rangeMiles = parseFloat(request.query.get('range')) || 100;

    // Category shortcuts mapping (appId=1 TangoTiempo)
    const CATEGORY_SHORTCUTS = {
        'social': ['66c4d370a87a956db06c49ea', '66c4d370a87a956db06c49e9'], // Practica, Milonga
        'classes': ['66c4d370a87a956db06c49eb', '66c4d370a87a956db06c49ed', '6700258c9bde2a0fb8166f87'], // Class, Workshop, DayWorkshop
        'practica': ['66c4d370a87a956db06c49ea'],
        'milonga': ['66c4d370a87a956db06c49e9'],
        'class': ['66c4d370a87a956db06c49eb']
    };

    // Parse categoryId - supports shortcuts, single ID, or comma-separated IDs
    let categoryIds = [];
    if (categoryIdParam) {
        const lowerParam = categoryIdParam.toLowerCase();
        if (CATEGORY_SHORTCUTS[lowerParam]) {
            categoryIds = CATEGORY_SHORTCUTS[lowerParam];
        } else if (categoryIdParam.includes(',')) {
            categoryIds = categoryIdParam.split(',').map(id => id.trim()).filter(Boolean);
        } else {
            categoryIds = [categoryIdParam];
        }
    }

    context.log('Voice_Events: Request received', { appId, start: startParam, end: endParam, categoryIds, lat, lng, rangeMiles, limit });

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

    // End date: Use start of NEXT day to include events stored at midnight UTC
    // (e.g., Monday 7PM Eastern stored as Tuesday 00:00 UTC should be included in Monday query)
    const parseEndDate = (dateStr) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const d = new Date(dateStr + 'T00:00:00Z');
            d.setUTCDate(d.getUTCDate() + 1); // Start of next day
            d.setUTCHours(5, 0, 0, 0); // 5 AM UTC = midnight Eastern
            return d;
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
        const venuesCollection = db.collection('venues');

        // Build base filter
        const baseFilter = {
            appId,
            isActive: true,
            $or: [
                { isCanceled: { $exists: false } },
                { isCanceled: false }
            ]
        };

        // Geo filter: Find venues within range first
        const rangeMeters = rangeMiles * 1609.34; // Convert miles to meters
        const nearbyVenues = await venuesCollection.find({
            geolocation: {
                $nearSphere: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    },
                    $maxDistance: rangeMeters
                }
            }
        }).toArray();
        const nearbyVenueIds = nearbyVenues.map(v => v._id);
        context.log(`Voice_Events: Found ${nearbyVenueIds.length} venues within ${rangeMiles} miles`);

        // Add category filter if provided
        // Match both ObjectId and string formats (database may store either)
        const andConditions = [];

        // Venue geo filter - only include events at nearby venues
        if (nearbyVenueIds.length > 0) {
            andConditions.push({
                $or: [
                    { venueID: { $in: nearbyVenueIds } },
                    { venueID: { $in: nearbyVenueIds.map(id => id.toString()) } }
                ]
            });
        }

        // Multi-category filter
        if (categoryIds.length > 0) {
            try {
                const categoryConditions = [];
                for (const catId of categoryIds) {
                    const categoryObjId = new ObjectId(catId);
                    categoryConditions.push(
                        // ObjectId comparison
                        { categoryFirstId: categoryObjId },
                        { categorySecondId: categoryObjId },
                        { categoryThirdId: categoryObjId },
                        // String comparison (some events store as string)
                        { categoryFirstId: catId },
                        { categorySecondId: catId },
                        { categoryThirdId: catId }
                    );
                }
                andConditions.push({ $or: categoryConditions });
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
                recurrenceRule: { $exists: true, $nin: [null, ''] }
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

        // If filtering by categoryIds, fetch any missing category names
        // Don't set a single filteredCategoryName since we may have multiple categories
        for (const catId of categoryIds) {
            if (!categoryMap[catId]) {
                try {
                    const filteredCategory = await categoriesCollection.findOne({ _id: new ObjectId(catId) });
                    if (filteredCategory) {
                        categoryMap[catId] = filteredCategory.categoryName;
                    }
                } catch (e) {
                    // Invalid ObjectId, skip
                }
            }
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
            // Get category name from event's primary category
            const categoryName = (event.categoryFirstId ? categoryMap[event.categoryFirstId.toString()] : null)
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
                venueName: venue?.name || venue?.shortName || event.venueName || 'TBD',
                venueCity: venue?.city || event.venueCityName || '',
                venueAddress: venue?.address1 || venue?.address || '',
                venueTimezone,
                eventImage: event.eventImage || null,
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
