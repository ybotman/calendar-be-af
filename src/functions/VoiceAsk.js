// src/functions/VoiceAsk.js
// Domain: Voice - Natural language tango event queries
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { RRule } = require('rrule');
const OpenAI = require('openai');
const { standardMiddleware } = require('../middleware');

/**
 * GET/POST /api/voice/ask
 * Natural language voice queries for tango events
 *
 * VOICE IN → VOICE OUT: Designed for Siri Shortcuts
 * GET is preferred for Siri (easier URL string building)
 *
 * GET Request:
 * - /api/voice/ask?query=practicas+this+weekend+boston&appId=1
 *
 * POST Request Body:
 * - query: Natural language query (required) e.g., "What practicas are this weekend in Boston?"
 * - appId: Application ID (optional, default: "1")
 *
 * Response:
 * - spoken: Text formatted for voice assistants to speak
 * - summary: Short summary
 * - parsed: The extracted parameters (category, timeframe, city)
 * - count: Number of events found
 * - events: Array of event details
 */

/**
 * Fuzzy matching for tango terms
 * Handles common Siri speech recognition errors
 */
const FUZZY_TERMS = {
    // Practica variations (Siri often hears "practical")
    'practical': 'practica',
    'practicals': 'practicas',
    'practice': 'practica',
    'practices': 'practicas',
    'practico': 'practica',
    'pratico': 'practica',
    'practic': 'practica',

    // Milonga variations
    'melonga': 'milonga',
    'melongas': 'milongas',
    'my longa': 'milonga',
    'mylonga': 'milonga',
    'mill onga': 'milonga',
    'millonga': 'milonga',
    'malonga': 'milonga',
    'molonga': 'milonga',

    // Tango variations
    'tangle': 'tango',
    'tangle events': 'tango events',

    // Class variations
    'tango class': 'class',
    'tango classes': 'classes',
    'tango lesson': 'lesson',
    'tango lessons': 'lessons'
};

/**
 * Apply fuzzy matching to normalize Siri speech recognition errors
 */
function applyFuzzyMatching(query) {
    let normalized = query.toLowerCase();

    // Sort by length descending to match longer phrases first
    const sortedTerms = Object.keys(FUZZY_TERMS).sort((a, b) => b.length - a.length);

    for (const term of sortedTerms) {
        const regex = new RegExp('\\b' + term.replace(/\s+/g, '\\s+') + '\\b', 'gi');
        normalized = normalized.replace(regex, FUZZY_TERMS[term]);
    }

    return normalized;
}

/**
 * Valid OpenAI TTS voices
 */
const VALID_OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

/**
 * Azure Speech voice mapping
 */
const AZURE_VOICE_MAP = {
    'nova': 'en-US-JennyNeural',      // Female, warm (like OpenAI nova)
    'shimmer': 'en-US-AriaNeural',    // Female, soft
    'alloy': 'en-US-GuyNeural',       // Male, neutral
    'echo': 'en-US-DavisNeural',      // Male
    'fable': 'en-GB-SoniaNeural',     // British female
    'onyx': 'en-US-TonyNeural'        // Deep male
};

/**
 * Generate speech audio using Azure Speech Services
 */
async function generateAzureSpeechAudio(text, voice, context) {
    const speechKey = process.env.AZURE_SPEECH_KEY;
    const speechRegion = process.env.AZURE_SPEECH_REGION || 'eastus';

    if (!speechKey) {
        throw new Error('No Azure Speech key configured');
    }

    const azureVoice = AZURE_VOICE_MAP[voice] || 'en-US-JennyNeural';
    context.log(`VoiceAsk Azure TTS: Using voice "${azureVoice}"`);

    // Build SSML
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
        <voice name='${azureVoice}'>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</voice>
    </speak>`;

    const response = await fetch(
        `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': speechKey,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
            },
            body: ssml
        }
    );

    if (!response.ok) {
        throw new Error(`Azure Speech API error: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    context.log(`VoiceAsk Azure TTS: Generated ${audioBuffer.length} bytes`);
    return audioBuffer;
}

/**
 * Generate speech audio using OpenAI TTS
 */
async function generateOpenAISpeechAudio(text, voice, context) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('No OpenAI API key configured');
    }

    const selectedVoice = VALID_OPENAI_VOICES.includes(voice) ? voice : 'nova';
    context.log(`VoiceAsk OpenAI TTS: Using voice "${selectedVoice}"`);

    const openai = new OpenAI({ apiKey });
    const mp3Response = await openai.audio.speech.create({
        model: 'tts-1',
        voice: selectedVoice,
        input: text
    });

    const arrayBuffer = await mp3Response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    context.log(`VoiceAsk OpenAI TTS: Generated ${audioBuffer.length} bytes`);
    return audioBuffer;
}

/**
 * Generate speech audio - tries OpenAI first, falls back to Azure
 * @param {string} text - Text to convert to speech
 * @param {string} voice - Voice to use
 * @param {object} context - Azure function context for logging
 * @returns {Buffer} - Audio buffer
 */
async function generateSpeechAudio(text, voice, context) {
    context.log(`VoiceAsk TTS: Generating audio, text length: ${text.length}`);

    // Try OpenAI first
    try {
        return await generateOpenAISpeechAudio(text, voice, context);
    } catch (openaiErr) {
        context.log('VoiceAsk TTS: OpenAI failed:', openaiErr.message);

        // Fall back to Azure Speech
        try {
            context.log('VoiceAsk TTS: Trying Azure Speech fallback...');
            return await generateAzureSpeechAudio(text, voice, context);
        } catch (azureErr) {
            context.error('VoiceAsk TTS: Azure also failed:', azureErr.message);
            throw new Error(`TTS failed - OpenAI: ${openaiErr.message}, Azure: ${azureErr.message}`);
        }
    }
}

// City mapping with coordinates
const CITIES = {
    'boston': { lat: 42.3601, lng: -71.0589, range: 100 },
    'cambridge': { lat: 42.3736, lng: -71.1097, range: 100 },
    'somerville': { lat: 42.3876, lng: -71.0995, range: 100 },
    'chicago': { lat: 41.8781, lng: -87.6298, range: 100 },
    'new york': { lat: 40.7128, lng: -74.0060, range: 50 },
    'nyc': { lat: 40.7128, lng: -74.0060, range: 50 },
    'san francisco': { lat: 37.7749, lng: -122.4194, range: 75 },
    'sf': { lat: 37.7749, lng: -122.4194, range: 75 },
    'los angeles': { lat: 34.0522, lng: -118.2437, range: 75 },
    'la': { lat: 34.0522, lng: -118.2437, range: 75 },
    'seattle': { lat: 47.6062, lng: -122.3321, range: 100 },
    'miami': { lat: 25.7617, lng: -80.1918, range: 100 },
    'denver': { lat: 39.7392, lng: -104.9903, range: 100 },
    'austin': { lat: 30.2672, lng: -97.7431, range: 100 },
    'portland': { lat: 45.5155, lng: -122.6789, range: 100 },
    'washington dc': { lat: 38.9072, lng: -77.0369, range: 75 },
    'dc': { lat: 38.9072, lng: -77.0369, range: 75 },
    'philadelphia': { lat: 39.9526, lng: -75.1652, range: 75 },
    'philly': { lat: 39.9526, lng: -75.1652, range: 75 }
};

// Category shortcuts
const CATEGORY_MAP = {
    'practica': 'practica',
    'practicas': 'practica',
    'milonga': 'milonga',
    'milongas': 'milonga',
    'class': 'classes',
    'classes': 'classes',
    'lesson': 'classes',
    'lessons': 'classes',
    'social': 'social',
    'dancing': 'social',
    'all': null,
    'events': null,
    'tango': null
};

// OpenAI system prompt for parsing
const SYSTEM_PROMPT = `You are a tango event query parser. Extract structured data from natural language queries about tango events.

Return JSON only with these fields:
- category: "practica" | "milonga" | "class" | "social" | "all"
- timeframe: "tonight" | "tomorrow" | "this_weekend" | "this_week" | "next_week" | "this_month" | "six_weeks"
- city: lowercase city name or null if not specified

Rules:
- "social dancing" or "dancing" or "dance" = "social" (practica + milonga)
- "lessons" or "learning" or "learn" = "class"
- "events" or "tango" without specific category = "all"
- If no category specified, use "all"
- If no timeframe specified, use "this_week"
- If no city specified, return null (will use default Boston)
- Recognize city aliases: "nyc" = "new york", "sf" = "san francisco", "la" = "los angeles", "dc" = "washington dc", "philly" = "philadelphia"

Examples:
"What practicas are this weekend in Boston?" → {"category":"practica","timeframe":"this_weekend","city":"boston"}
"Any milongas tonight?" → {"category":"milonga","timeframe":"tonight","city":null}
"Tango events in Chicago" → {"category":"all","timeframe":"this_week","city":"chicago"}
"Where can I dance this weekend?" → {"category":"social","timeframe":"this_weekend","city":null}
"Classes next week" → {"category":"class","timeframe":"next_week","city":null}`;

/**
 * Parse query using OpenAI
 */
async function parseQueryWithAI(query, context) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        context.log('VoiceAsk: No OpenAI API key, falling back to keyword parsing');
        return parseQueryWithKeywords(query);
    }

    try {
        const openai = new OpenAI({ apiKey });
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: query }
            ],
            temperature: 0,
            max_tokens: 100
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
            const parsed = JSON.parse(content);
            context.log('VoiceAsk: AI parsed:', parsed);
            return parsed;
        }
    } catch (err) {
        context.log('VoiceAsk: OpenAI error, falling back to keywords:', err.message);
    }

    return parseQueryWithKeywords(query);
}

/**
 * Fallback keyword-based parsing
 */
function parseQueryWithKeywords(query) {
    const lower = query.toLowerCase();

    // Category detection
    let category = 'all';
    if (lower.includes('practica')) category = 'practica';
    else if (lower.includes('milonga')) category = 'milonga';
    else if (lower.includes('class') || lower.includes('lesson')) category = 'class';
    else if (lower.includes('social') || lower.includes('danc')) category = 'social';

    // Timeframe detection
    let timeframe = 'this_week';
    if (lower.includes('tonight') || lower.includes('today')) timeframe = 'tonight';
    else if (lower.includes('tomorrow')) timeframe = 'tomorrow';
    else if (lower.includes('weekend')) timeframe = 'this_weekend';
    else if (lower.includes('next week')) timeframe = 'next_week';
    else if (lower.includes('month')) timeframe = 'this_month';

    // City detection
    let city = null;
    for (const cityName of Object.keys(CITIES)) {
        if (lower.includes(cityName)) {
            city = cityName;
            break;
        }
    }

    return { category, timeframe, city };
}

/**
 * Resolve timeframe to start/end dates
 */
function resolveTimeframe(timeframe) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay(); // 0 = Sunday

    const addDays = (date, days) => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    };

    const formatDate = (date) => {
        return date.toISOString().split('T')[0];
    };

    switch (timeframe) {
        case 'tonight':
            return { start: formatDate(today), end: formatDate(today) };

        case 'tomorrow': {
            const tomorrow = addDays(today, 1);
            return { start: formatDate(tomorrow), end: formatDate(tomorrow) };
        }

        case 'this_weekend': {
            // Friday to Sunday
            let friday = addDays(today, (5 - dayOfWeek + 7) % 7);
            if (dayOfWeek >= 5) friday = today; // Already weekend
            const sunday = addDays(friday, 2);
            return { start: formatDate(friday), end: formatDate(sunday) };
        }

        case 'this_week':
            return { start: formatDate(today), end: formatDate(addDays(today, 7)) };

        case 'next_week': {
            const daysUntilNextMonday = (8 - dayOfWeek) % 7 || 7;
            const nextMonday = addDays(today, daysUntilNextMonday);
            const nextSunday = addDays(nextMonday, 6);
            return { start: formatDate(nextMonday), end: formatDate(nextSunday) };
        }

        case 'this_month':
            return { start: formatDate(today), end: formatDate(addDays(today, 30)) };

        case 'six_weeks':
        default:
            return { start: formatDate(today), end: formatDate(addDays(today, 42)) };
    }
}

/**
 * Resolve city to coordinates
 */
function resolveCity(cityName) {
    if (!cityName) {
        // Default to Boston
        return CITIES['boston'];
    }
    const lower = cityName.toLowerCase();
    return CITIES[lower] || CITIES['boston'];
}

/**
 * Format timeframe for spoken response
 */
function formatTimeframeSpoken(timeframe) {
    const map = {
        'tonight': 'tonight',
        'tomorrow': 'tomorrow',
        'this_weekend': 'this weekend',
        'this_week': 'this week',
        'next_week': 'next week',
        'this_month': 'this month',
        'six_weeks': 'in the next six weeks'
    };
    return map[timeframe] || 'this week';
}

/**
 * Format events into spoken response
 */
function formatSpokenResponse(events, parsed, cityName) {
    const categoryLabel = parsed.category === 'all' ? 'tango events' :
        parsed.category === 'social' ? 'social events' :
            parsed.category + 's';

    const locationPhrase = cityName ? ` in ${titleCase(cityName)}` : '';
    const timePhrase = formatTimeframeSpoken(parsed.timeframe);

    if (events.length === 0) {
        return `I didn't find any ${categoryLabel} ${timePhrase}${locationPhrase}. Try expanding your search to a longer time period.`;
    }

    // Group by category for summary
    const categoryCount = {};
    events.forEach(e => {
        const cat = e.category || 'Event';
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    });

    const summaryParts = Object.entries(categoryCount)
        .map(([cat, count]) => `${count} ${cat.toLowerCase()}${count > 1 ? 's' : ''}`);

    let spoken = `I found ${summaryParts.join(', ')} ${timePhrase}${locationPhrase}. `;

    // Add first 5 events with details
    const maxEvents = Math.min(5, events.length);
    for (let i = 0; i < maxEvents; i++) {
        const e = events[i];
        spoken += `${e.dateFormatted} at ${e.timeFormatted}, ${e.title} at ${e.venueName}${e.venueCity ? ' in ' + e.venueCity : ''}. `;
    }

    if (events.length > maxEvents) {
        spoken += `And ${events.length - maxEvents} more.`;
    }

    return spoken;
}

/**
 * Title case helper
 */
function titleCase(str) {
    return str.split(' ').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
}

/**
 * Main handler - supports both GET and POST
 */
async function voiceAskHandler(request, context) {
    context.log('VoiceAsk: Request received, method:', request.method);
    context.log('VoiceAsk: Available cities:', Object.keys(CITIES).join(', '));

    let query, appId, voice;

    // Support both GET (query string) and POST (JSON body)
    if (request.method === 'GET') {
        // GET: Read from query string (preferred for Siri Shortcuts)
        const url = new URL(request.url);
        query = url.searchParams.get('query') || url.searchParams.get('q');
        appId = url.searchParams.get('appId') || url.searchParams.get('app') || '1';
        voice = url.searchParams.get('voice'); // If set, return audio instead of JSON
        context.log('VoiceAsk: GET request, query from URL params, voice:', voice || 'none');
    } else {
        // POST: Read from JSON body
        try {
            const body = await request.json();
            query = body.query;
            appId = body.appId || '1';
            voice = body.voice; // If set, return audio instead of JSON
        } catch (err) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    spoken: "I couldn't understand that request. Please try again.",
                    error: 'INVALID_JSON'
                })
            };
        }
    }

    // Default query if none provided: milongas and practicas this weekend in Boston
    if (!query || query.trim() === '') {
        query = 'milongas and practicas this weekend in boston';
        context.log('VoiceAsk: No query provided, using default:', query);
    }

    // Apply fuzzy matching to handle Siri speech recognition errors
    const originalQuery = query;
    query = applyFuzzyMatching(query);
    if (query !== originalQuery.toLowerCase()) {
        context.log('VoiceAsk: Fuzzy matched:', originalQuery, '->', query);
    }

    context.log('VoiceAsk: Query:', query);

    // Parse the query
    const parsed = await parseQueryWithAI(query, context);
    context.log('VoiceAsk: Parsed:', parsed);

    // Resolve parameters
    const dates = resolveTimeframe(parsed.timeframe);
    const location = resolveCity(parsed.city);
    const categoryId = CATEGORY_MAP[parsed.category] || null;

    context.log('VoiceAsk: Resolved:', {
        dates,
        city: parsed.city || 'boston (default)',
        lat: location.lat,
        lng: location.lng,
        range: location.range + ' miles',
        categoryId
    });

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

        // Geo filter: Find venues within range
        const rangeMeters = location.range * 1609.34;
        const nearbyVenues = await venuesCollection.find({
            geolocation: {
                $nearSphere: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [location.lng, location.lat]
                    },
                    $maxDistance: rangeMeters
                }
            }
        }).toArray();
        const nearbyVenueIds = nearbyVenues.map(v => v._id);
        context.log(`VoiceAsk: Found ${nearbyVenueIds.length} venues within ${location.range} miles`);

        // Build event filter
        const startDate = new Date(dates.start + 'T00:00:00Z');
        const endDate = new Date(dates.end + 'T00:00:00Z');
        endDate.setUTCDate(endDate.getUTCDate() + 1);
        endDate.setUTCHours(5, 0, 0, 0);

        const baseFilter = {
            appId,
            isActive: true,
            $or: [
                { isCanceled: { $exists: false } },
                { isCanceled: false }
            ]
        };

        const andConditions = [];

        // Venue geo filter
        if (nearbyVenueIds.length > 0) {
            andConditions.push({
                $or: [
                    { venueID: { $in: nearbyVenueIds } },
                    { venueID: { $in: nearbyVenueIds.map(id => id.toString()) } }
                ]
            });
        }

        // Category filter
        if (categoryId) {
            const CATEGORY_SHORTCUTS = {
                'social': ['66c4d370a87a956db06c49ea', '66c4d370a87a956db06c49e9'],
                'classes': ['66c4d370a87a956db06c49eb', '66c4d370a87a956db06c49ed', '6700258c9bde2a0fb8166f87'],
                'practica': ['66c4d370a87a956db06c49ea'],
                'milonga': ['66c4d370a87a956db06c49e9'],
                'class': ['66c4d370a87a956db06c49eb']
            };

            const categoryIds = CATEGORY_SHORTCUTS[categoryId] || [categoryId];
            const categoryConditions = [];

            for (const catId of categoryIds) {
                try {
                    const categoryObjId = new ObjectId(catId);
                    categoryConditions.push(
                        { categoryFirstId: categoryObjId },
                        { categorySecondId: categoryObjId },
                        { categoryThirdId: categoryObjId },
                        { categoryFirstId: catId },
                        { categorySecondId: catId },
                        { categoryThirdId: catId }
                    );
                } catch (e) {
                    // Skip invalid ObjectId
                }
            }

            if (categoryConditions.length > 0) {
                andConditions.push({ $or: categoryConditions });
            }
        }

        // Date filter
        const dateConditions = [
            {
                startDate: { $gte: startDate, $lte: endDate },
                $or: [
                    { recurrenceRule: { $exists: false } },
                    { recurrenceRule: null },
                    { recurrenceRule: '' }
                ]
            },
            {
                recurrenceRule: { $exists: true, $nin: [null, ''] }
            }
        ];

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
            .toArray();

        // Get categories and venues for formatting
        const categories = await categoriesCollection.find({ appId }).toArray();
        const categoryMap = {};
        categories.forEach(cat => {
            categoryMap[cat._id.toString()] = cat.categoryName;
        });

        const venueMap = {};
        nearbyVenues.forEach(v => {
            venueMap[v._id.toString()] = v;
        });

        // Expand recurring events
        const expandRecurringEvent = (event, queryStart, queryEnd, venueTimezone) => {
            if (!event.recurrenceRule) return [event];

            try {
                const eventStart = new Date(event.startDate);
                const tz = venueTimezone || 'America/New_York';

                const localParts = eventStart.toLocaleString('en-CA', {
                    timeZone: tz,
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false
                });
                const localDateStr = localParts.replace(/[^\d]/g, '').substring(0, 14);
                const formattedLocal = localDateStr.substring(0, 8) + 'T' + localDateStr.substring(8);

                const rruleStr = `DTSTART;TZID=${tz}:${formattedLocal}\nRRULE:${event.recurrenceRule}`;
                const rule = RRule.fromString(rruleStr);

                const rangeEnd = new Date(queryEnd);
                rangeEnd.setDate(rangeEnd.getDate() + 1);

                const occurrences = rule.between(queryStart, rangeEnd, true);
                if (occurrences.length === 0) return [];

                const originalHours = eventStart.getUTCHours();
                const originalMinutes = eventStart.getUTCMinutes();

                return occurrences.map(occurrenceDate => {
                    const newDate = new Date(occurrenceDate);
                    newDate.setUTCHours(originalHours, originalMinutes, 0, 0);
                    return { ...event, startDate: newDate, _isExpandedOccurrence: true };
                });
            } catch (err) {
                return [event];
            }
        };

        const nonRecurringEvents = events.filter(e => !e.recurrenceRule || e.recurrenceRule === '');
        const recurringEvents = events.filter(e => e.recurrenceRule && e.recurrenceRule !== '');

        const expandedRecurring = recurringEvents.flatMap(e => {
            const venue = e.venueID ? venueMap[e.venueID.toString()] : null;
            const tz = venue?.timezone || 'America/New_York';
            return expandRecurringEvent(e, startDate, endDate, tz);
        });

        const allEvents = [...nonRecurringEvents, ...expandedRecurring]
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
            .slice(0, 20);

        // Format events for response
        const formattedEvents = allEvents.map(event => {
            const venue = event.venueID ? venueMap[event.venueID.toString()] : null;
            const categoryName = (event.categoryFirstId ? categoryMap[event.categoryFirstId.toString()] : null) || 'Event';
            const venueTimezone = venue?.timezone || 'America/New_York';

            const displayDate = new Date(event.startDate);
            const dateFormatted = displayDate.toLocaleDateString('en-US', {
                timeZone: venueTimezone,
                weekday: 'long',
                month: 'long',
                day: 'numeric'
            });

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
                venueCity: venue?.city || event.venueCityName || ''
            };
        });

        // Generate spoken response
        const spoken = formatSpokenResponse(formattedEvents, parsed, parsed.city);

        context.log(`VoiceAsk: Returning ${formattedEvents.length} events`);

        // If voice param is set, return audio instead of JSON
        let ttsError = null;
        if (voice) {
            try {
                const audioBuffer = await generateSpeechAudio(spoken, voice, context);
                if (audioBuffer && audioBuffer.length > 0) {
                    return {
                        status: 200,
                        headers: {
                            'Content-Type': 'audio/mpeg',
                            'Content-Length': audioBuffer.length.toString(),
                            'X-Spoken-Text': encodeURIComponent(spoken.substring(0, 200))
                        },
                        body: audioBuffer
                    };
                }
                ttsError = 'TTS returned empty or null buffer';
            } catch (ttsErr) {
                ttsError = ttsErr.message;
            }
            context.log('VoiceAsk: TTS failed:', ttsError);
        }

        const jsonResponse = {
            spoken,
            summary: `Found ${formattedEvents.length} events.`,
            parsed: {
                category: parsed.category,
                timeframe: parsed.timeframe,
                city: parsed.city || 'boston',
                startDate: dates.start,
                endDate: dates.end
            },
            count: formattedEvents.length,
            events: formattedEvents
        };

        // Include TTS error info if voice was requested but failed
        if (voice && ttsError) {
            jsonResponse.ttsError = ttsError;
            jsonResponse.ttsRequested = voice;
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonResponse)
        };

    } catch (error) {
        context.error('VoiceAsk error:', error);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                spoken: "I'm sorry, something went wrong. Please try again later.",
                error: 'INTERNAL_ERROR',
                message: error.message
            })
        };
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

app.http('Voice_Ask', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'voice/ask',
    handler: standardMiddleware(voiceAskHandler)
});

module.exports = { voiceAskHandler };
