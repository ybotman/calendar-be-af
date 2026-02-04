// src/utils/expandRecurringEvent.js
// Shared utility: Expand a recurring event into individual occurrences within a date range
// Extracted from VoiceEvents.js / VoiceAsk.js to eliminate duplication.

const { RRule } = require('rrule');

/**
 * Expand a recurring event into individual occurrences within a date range.
 *
 * @param {Object}  event          - The event document (must have .startDate, .recurrenceRule)
 * @param {Date}    queryStart     - Start of the query range (Date object)
 * @param {Date}    queryEnd       - End of the query range (Date object)
 * @param {string}  venueTimezone  - IANA timezone of the venue (e.g. 'America/New_York')
 * @param {Object}  [logger=console] - Logger with a .log() method (Azure context or console)
 * @returns {Array} Array of event objects, one per occurrence (or the original if not recurring)
 */
function expandRecurringEvent(event, queryStart, queryEnd, venueTimezone, logger) {
    if (!logger) logger = console;

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
        logger.log(`RRULE parse error for event ${event._id}: ${err.message}`);
        return [event];
    }
}

module.exports = { expandRecurringEvent };
