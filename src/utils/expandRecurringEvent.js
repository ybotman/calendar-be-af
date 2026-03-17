// src/utils/expandRecurringEvent.js
// Shared utility: Expand a recurring event into individual occurrences within a date range
// Extracted from VoiceEvents.js / VoiceAsk.js to eliminate duplication.
// TIEMPO-362: Added instance override support

const { RRule } = require('rrule');

/**
 * Expand a recurring event into individual occurrences within a date range.
 * Applies instance overrides (modify/cancel) from event.instanceOverrides array.
 *
 * @param {Object}  event          - The event document (must have .startDate, .recurrenceRule)
 * @param {Date}    queryStart     - Start of the query range (Date object)
 * @param {Date}    queryEnd       - End of the query range (Date object)
 * @param {string}  venueTimezone  - IANA timezone of the venue (e.g. 'America/New_York')
 * @param {Object}  [options]      - Optional settings
 * @param {boolean} [options.includeCanceled=false] - Include canceled occurrences (with _isCanceled=true)
 * @param {Object}  [options.logger=console] - Logger with a .log() method (Azure context or console)
 * @returns {Array} Array of event objects, one per occurrence (or the original if not recurring)
 */
function expandRecurringEvent(event, queryStart, queryEnd, venueTimezone, options = {}) {
    // Support legacy signature: (event, queryStart, queryEnd, venueTimezone, logger)
    let logger = options;
    let includeCanceled = false;

    if (options && typeof options === 'object' && !options.log) {
        logger = options.logger || console;
        includeCanceled = options.includeCanceled || false;
    } else if (!options || typeof options.log !== 'function') {
        logger = console;
    }

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

        // Build lookup map for instance overrides (TIEMPO-362)
        // Key: ISO string of instanceKey (venue local time)
        const overridesMap = new Map();
        if (event.instanceOverrides && Array.isArray(event.instanceOverrides)) {
            for (const override of event.instanceOverrides) {
                if (override.instanceKey) {
                    // Store by ISO string for easy lookup
                    const keyDate = new Date(override.instanceKey);
                    overridesMap.set(keyDate.toISOString(), override);
                }
            }
        }

        // Build set of excluded dates (RRULE EXDATE equivalent)
        // These dates are completely removed from the series
        const excludedDatesSet = new Set();
        if (event.excludedDates && Array.isArray(event.excludedDates)) {
            for (const exDate of event.excludedDates) {
                // Normalize to date-only string (YYYY-MM-DD) for comparison
                const dateStr = typeof exDate === 'string' ? exDate : new Date(exDate).toISOString();
                const dateOnly = dateStr.split('T')[0];
                excludedDatesSet.add(dateOnly);
            }
        }

        // Create expanded event for each occurrence
        // Preserve original time-of-day from event.startDate
        const originalHours = eventStart.getUTCHours();
        const originalMinutes = eventStart.getUTCMinutes();

        const expandedEvents = [];

        for (const occurrenceDate of occurrences) {
            // rrule returns dates - set the original time
            const newDate = new Date(occurrenceDate);
            newDate.setUTCHours(originalHours, originalMinutes, 0, 0);

            // Check if this date is excluded (RRULE EXDATE)
            const occurrenceDateOnly = newDate.toISOString().split('T')[0];
            if (excludedDatesSet.has(occurrenceDateOnly)) {
                // Skip excluded dates entirely
                continue;
            }

            // Build base expanded occurrence
            let expandedEvent = {
                ...event,
                _originalStartDate: event.startDate,
                startDate: newDate,
                _isExpandedOccurrence: true,
                _instanceKey: newDate.toISOString()
            };

            // Check for override (TIEMPO-362)
            // Match by comparing the occurrence date to instanceKey
            const override = overridesMap.get(newDate.toISOString());

            if (override) {
                expandedEvent._hasOverride = true;
                expandedEvent._overrideType = override.overrideType;

                if (override.overrideType === 'cancel') {
                    // Mark as canceled
                    expandedEvent._isCanceled = true;
                    expandedEvent.isCanceled = true;

                    // Skip canceled occurrences unless includeCanceled is true
                    if (!includeCanceled) {
                        continue;
                    }
                } else if (override.overrideType === 'modify' && override.patch) {
                    // Merge patch fields into occurrence
                    expandedEvent = {
                        ...expandedEvent,
                        ...override.patch
                    };
                    // Preserve override metadata
                    expandedEvent._hasOverride = true;
                    expandedEvent._overrideType = 'modify';
                }
                // 'restore' type: no changes needed (occurrence returns to normal)
            }

            expandedEvents.push(expandedEvent);
        }

        return expandedEvents;
    } catch (err) {
        // If RRULE parsing fails, return original event
        logger.log(`RRULE parse error for event ${event._id}: ${err.message}`);
        return [event];
    }
}

module.exports = { expandRecurringEvent };
