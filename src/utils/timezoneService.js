/**
 * Timezone conversion service for Azure Functions backend
 * Ported from calendar-be TimezoneService (CALBE-44/46)
 *
 * Key principles:
 * - UTC is always the source of truth (stored in database)
 * - Local times are computed on-demand, never stored
 * - DST transitions are handled explicitly
 * - All display times are venue-local, not browser-local
 */
const { DateTime, IANAZone } = require('luxon');

// Simple in-memory cache (no separate cache module needed for AF)
const cache = new Map();
const CACHE_MAX = 5000;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function getCacheKey(date, timezone) {
    const rounded = new Date(date);
    rounded.setSeconds(0, 0);
    return `${rounded.getTime()}_${timezone}`;
}

function cacheGet(date, timezone) {
    const key = getCacheKey(date, timezone);
    const entry = cache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) {
        return entry.value;
    }
    if (entry) cache.delete(key);
    return null;
}

function cacheSet(date, timezone, value) {
    if (cache.size >= CACHE_MAX) {
        // Evict oldest 10%
        const keys = [...cache.keys()].slice(0, Math.floor(CACHE_MAX * 0.1));
        keys.forEach(k => cache.delete(k));
    }
    cache.set(getCacheKey(date, timezone), { value, ts: Date.now() });
}

/**
 * Convert UTC date to venue local time with timezone metadata
 * @param {Date} utcDate - JavaScript Date object in UTC
 * @param {string} timezone - IANA timezone identifier
 * @returns {Object} Display time object with local time and metadata
 */
function calculateDisplayTime(utcDate, timezone) {
    if (!utcDate || !timezone) return null;

    if (!IANAZone.isValidZone(timezone)) return null;

    const cached = cacheGet(utcDate, timezone);
    if (cached) return cached;

    const dt = DateTime.fromJSDate(utcDate, { zone: 'utc' });
    const local = dt.setZone(timezone);

    if (!local.isValid) {
        // DST gap — advance to next valid time
        const adjusted = local.plus({ hours: 1 });
        const result = {
            localTime: adjusted.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
            timezone: timezone,
            timezoneAbbr: adjusted.offsetNameShort,
            utcOffset: adjusted.offset,
            isDST: true,
            disambiguation: 'gap-adjusted'
        };
        cacheSet(utcDate, timezone, result);
        return result;
    }

    const result = {
        localTime: local.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
        timezone: timezone,
        timezoneAbbr: local.offsetNameShort,
        utcOffset: local.offset,
        isDST: local.isInDST,
        disambiguation: null
    };

    cacheSet(utcDate, timezone, result);
    return result;
}

/**
 * Enrich an array of events with timezone display fields
 * Matches Express serverEvents.js lines 827-877 output exactly
 * @param {Array} events - Raw MongoDB event documents
 * @returns {Array} Events with computed timezone display fields
 */
function enrichEventsWithTimezone(events) {
    return events.map(event => {
        if (event.venueTimezone && event.startDate) {
            const startDisplay = calculateDisplayTime(
                new Date(event.startDate),
                event.venueTimezone
            );
            const endDisplay = event.endDate
                ? calculateDisplayTime(new Date(event.endDate), event.venueTimezone)
                : null;

            if (startDisplay) {
                // OLD field names (backward compatibility with Express)
                event.displayStartTime = startDisplay.localTime;
                event.displayEndTime = endDisplay ? endDisplay.localTime : null;
                event.timezoneAbbr = startDisplay.timezoneAbbr;
                event.utcOffset = startDisplay.utcOffset;
                event.isDST = startDisplay.isDST;
                event.hasTimezoneData = true;

                // NEW field names (CALBE-52 parity)
                event.venueStartDisplay = startDisplay.localTime;
                event.venueEndDisplay = endDisplay ? endDisplay.localTime : null;
                event.venueAbbr = startDisplay.timezoneAbbr;
                event.venueTZ = event.venueTimezone;

                // Nested display object
                event.display = {
                    startTime: startDisplay.localTime,
                    endTime: endDisplay ? endDisplay.localTime : null,
                    timezone: startDisplay.timezone,
                    timezoneAbbr: startDisplay.timezoneAbbr,
                    utcOffset: startDisplay.utcOffset,
                    isDST: startDisplay.isDST
                };
            } else {
                event.hasTimezoneData = false;
            }
        } else {
            event.hasTimezoneData = false;
        }
        return event;
    });
}

module.exports = {
    calculateDisplayTime,
    enrichEventsWithTimezone
};
