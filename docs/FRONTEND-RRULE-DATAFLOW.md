# Frontend Event Data Flow & RRULE Expansion

**Created**: 2026-02-17
**Purpose**: Understanding how recurring events flow from backend to frontend calendar display

---

## 1. Event Fetching (useEvents.js)

```
useEvents hook
    ↓
GET /api/events?lat=X&lng=Y&radiusMiles=Z&startDate=...&endDate=...
    ↓
Returns raw events from MongoDB (recurring events have isRepeating=true + recurrenceRule)
```

**KEY**: The API returns **one record per recurring event** — NOT expanded occurrences.

---

## 2. Event Transformation (transformEvents.js)

```javascript
// For recurring events (lines 119-203):
if (event.recurrenceRule && event.isRepeating) {
  return {
    ...baseEvent,
    rrule: {
      dtstart: venueStartDisplay,  // "2026-02-17T20:00:00" (venue local, no Z)
      freq: 'weekly',
      byweekday: ['mo', 'we'],
      until: '2026-06-01T00:00:00'
    },
    duration: '03:00',  // calculated from start/end
    exdate: ['2026-03-02T20:00:00', ...]  // excluded dates
  };
}

// For single events:
return {
  ...baseEvent,
  start: venueStartDisplay,  // "2026-02-17T20:00:00"
  end: venueEndDisplay       // "2026-02-17T23:00:00"
};
```

---

## 3. RRULE Expansion (FullCalendar + rrule.js)

The frontend does **NOT** expand RRULEs manually. FullCalendar's rrulePlugin does it automatically:

```javascript
// boston/page.js line 8
import rrulePlugin from '@fullcalendar/rrule';

// line 793
<FullCalendar
  plugins={[dayGridPlugin, listPlugin, interactionPlugin, rrulePlugin]}
  events={coloredFilteredEvents}  // includes rrule objects
  ...
/>
```

FullCalendar internally calls rrule.js to expand occurrences within the visible date range.

---

## 4. Key Data Structure Expected by Frontend

From Azure Functions API response:

```json
{
  "_id": "abc123",
  "title": "Monday Milonga",
  "startDate": "2026-02-17T01:00:00.000Z",      // UTC
  "endDate": "2026-02-17T04:00:00.000Z",        // UTC
  "venueTimezone": "America/New_York",

  // Backend MUST compute these (timezoneService.js):
  "venueStartDisplay": "2026-02-16T20:00:00",   // Venue local (NO Z!)
  "venueEndDisplay": "2026-02-16T23:00:00",     // Venue local (NO Z!)
  "venueAbbr": "EST",

  // For recurring events:
  "isRepeating": true,
  "recurrenceRule": "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260601T040000Z",
  "excludedDates": ["2026-03-02T01:00:00.000Z"]
}
```

---

## 5. Critical: Timezone Handling

Backend **MUST** provide `venueStartDisplay` / `venueEndDisplay` — these are used as `dtstart` for RRULE expansion:

```javascript
// transformEvents.js line 146
const startForRRule = useVenueTime ? displayTimes.startTime : event.startDate;

// parseRRuleToObject line 252
dtstart: startForRRule  // MUST be venue-local time without Z suffix
```

**WARNING**: If `venueStartDisplay` is missing, the frontend falls back to `startDate` (UTC), which can cause DST issues.

---

## 6. Flow Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│  AZURE FUNCTIONS (Events.js + timezoneService.js)                  │
│                                                                     │
│  1. Query MongoDB for events in date range                         │
│  2. enrichEventsWithTimezone() adds:                               │
│     - venueStartDisplay (venue-local time)                         │
│     - venueEndDisplay                                               │
│     - venueAbbr (EST/EDT/PST/etc)                                  │
│  3. Return JSON array                                               │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (useEvents.js → transformEvents.js)                      │
│                                                                     │
│  1. Fetch from /api/events                                         │
│  2. transformEvents() converts to FullCalendar format:             │
│     - Single events: { start, end, extendedProps }                 │
│     - Recurring: { rrule: {dtstart, freq, ...}, duration, exdate } │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  FULLCALENDAR + RRULE PLUGIN                                       │
│                                                                     │
│  1. rrule.js expands recurring events into occurrences             │
│  2. Only expands for visible date range (efficient)                │
│  3. Applies exdate exclusions                                       │
│  4. Renders on calendar                                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. What Backend Must Return

| Field | Required | Format | Example |
|-------|----------|--------|---------|
| `startDate` | Yes | UTC ISO | `2026-02-17T01:00:00.000Z` |
| `endDate` | Yes | UTC ISO | `2026-02-17T04:00:00.000Z` |
| `venueTimezone` | Yes | IANA | `America/New_York` |
| `venueStartDisplay` | **Critical** | Local (no Z) | `2026-02-16T20:00:00` |
| `venueEndDisplay` | **Critical** | Local (no Z) | `2026-02-16T23:00:00` |
| `venueAbbr` | Yes | TZ abbr | `EST` |
| `isRepeating` | If recurring | Boolean | `true` |
| `recurrenceRule` | If recurring | RRULE string | `FREQ=WEEKLY;BYDAY=MO` |
| `excludedDates` | If any | UTC ISO array | `["2026-03-02T01:00:00.000Z"]` |

---

## 8. Implications for Reconciliation

### Why "Milonga Sal Azul" shows as many individual events in BKP-0131:

The **old system** pre-expanded recurring events into individual MongoDB documents:
- One document per Thursday occurrence
- Each with unique `_id`
- `startDate` set to that specific Thursday

### Current system stores ONE document with RRULE:

```json
{
  "_id": "single-id",
  "title": "Milonga Sal Azul",
  "startDate": "2025-05-01T00:00:00.000Z",  // First occurrence
  "isRepeating": true,
  "recurrenceRule": "FREQ=WEEKLY;BYDAY=TH;UNTIL=20260601"
}
```

### Reconciliation Impact:

| Scenario | What Happened |
|----------|---------------|
| 35 "Milonga Sal Azul" in BKP-0131 | Old pre-expanded individual events |
| 0 in LIVE/PROD | Replaced with single RRULE event OR deleted |
| "Sal Azul Milonga" added by Alex | New monthly event (different naming) |

### Action Required:

When reconciling, check if "deleted" events were actually **converted to RRULE format**:

```javascript
// Check if a replacement RRULE event exists
db.events.find({
  title: /Sal Azul/i,
  isRepeating: true
})
```

---

## 9. RRULE Event Detection Query

To find all RRULE events in a collection:

```javascript
db.events.find({
  $or: [
    { isRepeating: true },
    { recurrenceRule: { $exists: true, $ne: null } },
    { rrule: { $exists: true, $ne: null } }
  ]
})
```

---

## Related Files

- **Backend**: `src/functions/Events.js`, `src/services/timezoneService.js`
- **Frontend**: `useEvents.js`, `transformEvents.js`, `boston/page.js`
- **FullCalendar**: Uses `@fullcalendar/rrule` plugin
