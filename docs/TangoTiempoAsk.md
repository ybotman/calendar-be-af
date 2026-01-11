# TangoTiempo Ask - Voice-First Tango Event Discovery

## Overview

**TangoTiempoAsk** is a voice-first API endpoint that enables natural language queries for tango events. Users can ask questions like "What practicas are happening this weekend in Boston?" and receive spoken responses suitable for Siri, Alexa, or any voice assistant.

## Core Requirement: VOICE IN → VOICE OUT

| Direction | Requirement |
|-----------|-------------|
| **VOICE IN** | User speaks query naturally (no typing) |
| **VOICE OUT** | Phone/device speaks response aloud (no reading) |

**This is non-negotiable.** The entire interaction must be hands-free and eyes-free.

**NOT acceptable:**
- ❌ Type query → hear response (not voice in)
- ❌ Speak query → read response on screen (not voice out)
- ❌ Any interaction requiring the user to look at or touch the device

## User Experience

### Example Interactions

```
User: "What practicas are this weekend in Boston?"
Response: "I found 3 practicas this weekend in Boston. Tuesday at 7:30 PM,
          Practica Chiquita at Ultimate Tango Studio in Malden. Tuesday at
          7:30 PM, Noche de Práctica at Dance Union in Somerville..."

User: "Any milongas tonight?"
Response: "I found 1 milonga tonight. Blue Milonga at Dance Union in
          Somerville at 8:30 PM."

User: "Tango events next week in Chicago"
Response: "I found 5 events next week in Chicago. 2 practicas, 2 classes,
          and 1 milonga..."
```

### Supported Query Patterns

| Pattern | Example |
|---------|---------|
| Category + Time + City | "What practicas are this weekend in Boston?" |
| Category + Time | "Any milongas tonight?" (uses default city) |
| Generic + Time + City | "Tango events next week in Chicago" |
| Time + Category | "This weekend's practicas" |
| Just Category | "Find me practicas" (uses defaults) |

---

## API Design

### Endpoints

**GET (Preferred for Siri Shortcuts):**
```
GET /api/voice/ask?query=practicas+this+weekend+boston&appId=1
```

**POST (Alternative):**
```
POST /api/voice/ask
Content-Type: application/json
```

### GET Request (Siri-friendly)

```
GET /api/voice/ask?query=What+practicas+are+this+weekend+in+Boston
```

Query parameters:
- `query` or `q`: Natural language query (required)
- `appId` or `app`: Application ID (optional, default: "1")

### POST Request

```json
{
  "query": "What practicas are this weekend in Boston?",
  "deviceId": "optional-for-user-settings",
  "appId": "1"
}
```

### Fuzzy Matching (Siri Speech Recognition)

The API automatically corrects common Siri mishears:

| Siri Hears | Converts To |
|------------|-------------|
| practical, practice, practicals | practica |
| melonga, my longa, millonga, malonga | milonga |
| tangle, tangle events | tango |
| tango class, tango classes | class |

### Response

```json
{
  "spoken": "I found 3 practicas this weekend in Boston. Tuesday at 7:30 PM, Practica Chiquita at Ultimate Tango Studio in Malden...",
  "summary": "Found 3 practicas.",
  "parsed": {
    "category": "practica",
    "timeframe": "this_weekend",
    "city": "boston",
    "startDate": "2026-01-10",
    "endDate": "2026-01-12"
  },
  "count": 3,
  "events": [
    {
      "title": "Practica Chiquita",
      "dateFormatted": "Tuesday, January 13",
      "timeFormatted": "7:30 PM",
      "venueName": "Ultimate Tango Studio",
      "venueCity": "Malden"
    }
  ]
}
```

### Error Response

```json
{
  "spoken": "I'm sorry, I couldn't understand that request. Try asking something like 'What practicas are this weekend in Boston?'",
  "error": "PARSE_ERROR",
  "message": "Could not parse query"
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         User Voice Input                                │
│              "What practicas are this weekend in Boston?"               │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Siri / Shortcuts / Alexa                           │
│                                                                         │
│  1. Dictate Text                                                        │
│  2. POST /api/voice/ask                                                 │
│  3. Speak response.spoken                                               │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    POST /api/voice/ask                                  │
│                    (VoiceAsk.js)                                        │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 1. PARSE - OpenAI gpt-4o-mini                                     │  │
│  │    Input:  "What practicas are this weekend in Boston?"           │  │
│  │    Output: { category: "practica", timeframe: "this_weekend",     │  │
│  │              city: "boston" }                                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                 │                                       │
│                                 ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 2. RESOLVE                                                        │  │
│  │    city: "boston" → lat: 42.3601, lng: -71.0589                   │  │
│  │    timeframe: "this_weekend" → start: 2026-01-10, end: 2026-01-12 │  │
│  │    category: "practica" → categoryId: "social" (shortcut)         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                 │                                       │
│                                 ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 3. QUERY - Call /api/voice/events internally                      │  │
│  │    GET /api/voice/events?appId=1&start=...&end=...&categoryId=... │  │
│  │         &lat=42.3601&lng=-71.0589&range=100                       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                 │                                       │
│                                 ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 4. FORMAT - Build spoken response                                 │  │
│  │    "I found 3 practicas this weekend in Boston. Tuesday at..."    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Response to User                                │
│     { spoken: "I found 3 practicas...", events: [...] }                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Natural Language Parsing

### OpenAI System Prompt

```
You are a tango event query parser. Extract structured data from natural language queries about tango events.

Return JSON only with these fields:
- category: "practica" | "milonga" | "class" | "social" | "all"
- timeframe: "tonight" | "tomorrow" | "this_weekend" | "this_week" | "next_week" | "this_month" | "six_weeks"
- city: lowercase city name or null if not specified

Rules:
- "social dancing" or "dancing" = "social" (practica + milonga)
- "lessons" or "learning" = "class"
- If no category specified, use "all"
- If no timeframe specified, use "this_week"
- If no city specified, return null (will use default)

Examples:
"What practicas are this weekend in Boston?" → {"category":"practica","timeframe":"this_weekend","city":"boston"}
"Any milongas tonight?" → {"category":"milonga","timeframe":"tonight","city":null}
"Tango events in Chicago" → {"category":"all","timeframe":"this_week","city":"chicago"}
```

---

## City Mapping

### Supported Cities (Phase 1)

| City | Latitude | Longitude | Default Range |
|------|----------|-----------|---------------|
| boston | 42.3601 | -71.0589 | 100 miles |
| chicago | 41.8781 | -87.6298 | 100 miles |
| new york / nyc | 40.7128 | -74.0060 | 50 miles |
| san francisco / sf | 37.7749 | -122.4194 | 75 miles |
| los angeles / la | 34.0522 | -118.2437 | 75 miles |
| seattle | 47.6062 | -122.3321 | 100 miles |
| miami | 25.7617 | -80.1918 | 100 miles |
| denver | 39.7392 | -104.9903 | 100 miles |
| austin | 30.2672 | -97.7431 | 100 miles |
| portland | 45.5155 | -122.6789 | 100 miles |

### City Aliases

```javascript
const CITY_ALIASES = {
  'new york city': 'new york',
  'nyc': 'new york',
  'sf': 'san francisco',
  'la': 'los angeles',
  'philly': 'philadelphia',
  'dc': 'washington dc'
};
```

---

## Timeframe Mapping

| Timeframe | Start | End |
|-----------|-------|-----|
| tonight | today | today |
| tomorrow | tomorrow | tomorrow |
| this_weekend | friday | sunday |
| this_week | today | +7 days |
| next_week | next monday | next sunday |
| this_month | today | +30 days |
| six_weeks | today | +42 days |

### Implementation

```javascript
function resolveTimeframe(timeframe) {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday

  switch(timeframe) {
    case 'tonight':
      return { start: today, end: today };

    case 'tomorrow':
      return { start: addDays(today, 1), end: addDays(today, 1) };

    case 'this_weekend':
      const friday = addDays(today, (5 - dayOfWeek + 7) % 7 || 7);
      const sunday = addDays(friday, 2);
      return { start: dayOfWeek >= 5 ? today : friday, end: sunday };

    case 'this_week':
      return { start: today, end: addDays(today, 7) };

    case 'next_week':
      const nextMonday = addDays(today, (8 - dayOfWeek) % 7 || 7);
      return { start: nextMonday, end: addDays(nextMonday, 6) };

    case 'this_month':
      return { start: today, end: addDays(today, 30) };

    case 'six_weeks':
    default:
      return { start: today, end: addDays(today, 42) };
  }
}
```

---

## Category Mapping

| Parsed Category | categoryId Parameter |
|-----------------|---------------------|
| practica | practica (shortcut) |
| milonga | milonga (shortcut) |
| class | classes (shortcut) |
| social | social (shortcut) |
| all | (empty - no filter) |

---

## Response Formatting

### Spoken Response Template

```javascript
function formatSpokenResponse(events, parsed) {
  if (events.length === 0) {
    return `I didn't find any ${parsed.category === 'all' ? 'tango events' : parsed.category + 's'} ${formatTimeframeSpoken(parsed.timeframe)}${parsed.city ? ' in ' + titleCase(parsed.city) : ''}.`;
  }

  // Group by category for summary
  const categoryCount = groupByCategory(events);
  const summaryParts = Object.entries(categoryCount)
    .map(([cat, count]) => `${count} ${cat.toLowerCase()}${count > 1 ? 's' : ''}`);

  let spoken = `I found ${summaryParts.join(', ')} ${formatTimeframeSpoken(parsed.timeframe)}${parsed.city ? ' in ' + titleCase(parsed.city) : ''}. `;

  // Add first 3-5 events with details
  const maxEvents = Math.min(5, events.length);
  for (let i = 0; i < maxEvents; i++) {
    const e = events[i];
    spoken += `${e.dateFormatted} at ${e.timeFormatted}, ${e.title} at ${e.venueName} in ${e.venueCity}. `;
  }

  if (events.length > maxEvents) {
    spoken += `And ${events.length - maxEvents} more.`;
  }

  return spoken;
}
```

### Timeframe Spoken Phrases

| Timeframe | Spoken |
|-----------|--------|
| tonight | "tonight" |
| tomorrow | "tomorrow" |
| this_weekend | "this weekend" |
| this_week | "this week" |
| next_week | "next week" |
| this_month | "this month" |
| six_weeks | "in the next six weeks" |

---

## Siri Shortcut Setup

### Simple Version (Shareable)

```
1. Dictate Text
   └─ Stop Listening: After Short Pause

2. URL
   └─ https://calendarbeaf-prod.azurewebsites.net/api/voice/ask

3. Get Contents of URL
   └─ Method: POST
   └─ Headers: Content-Type: application/json
   └─ Request Body (JSON):
      {
        "query": [Dictated Text],
        "appId": "1"
      }

4. Get Dictionary Value
   └─ Key: spoken

5. Speak Text
   └─ [Dictionary Value]
```

### iCloud Share Link

Once created, share via: `https://www.icloud.com/shortcuts/[ID]`

---

## Environment Variables

```
OPENAI_API_KEY=sk-...   # For natural language parsing
MONGODB_URI=...         # Existing
```

---

## Cost Analysis

### OpenAI Usage (gpt-4o-mini)

| Component | Tokens | Cost |
|-----------|--------|------|
| System prompt | ~200 | - |
| User query | ~20 | - |
| Response | ~50 | - |
| **Per request** | ~270 | **$0.00004** |
| **1,000 requests** | 270,000 | **$0.04** |
| **10,000 requests** | 2.7M | **$0.40** |

Essentially free for personal/community use.

### Rate Limiting (Optional)

```javascript
// Simple in-memory rate limit
const requestCounts = {};
const RATE_LIMIT = 60; // requests per minute per IP

function checkRateLimit(ip) {
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const key = `${ip}:${minute}`;

  requestCounts[key] = (requestCounts[key] || 0) + 1;
  return requestCounts[key] <= RATE_LIMIT;
}
```

---

## Future Enhancements

### Phase 2: User Settings

```
POST /api/voice/settings
{
  "deviceId": "unique-device-id",
  "defaultCity": "boston",
  "defaultRange": 100,
  "preferredCategories": ["practica", "milonga"]
}
```

User can say: "Set my city to Chicago" → stores preference

### Phase 3: Follow-up Questions

```
User: "What practicas are this weekend?"
Response: "I found 3 practicas..."

User: "What about milongas?"
Response: "I found 2 milongas this weekend..." (remembers context)
```

### Phase 4: Organizer Filter

```
User: "What events does Ultimate Tango have this week?"
Response: "Ultimate Tango has 5 events this week..."
```

---

## File Structure

```
src/functions/
├── VoiceEvents.js      # Existing - GET /api/voice/events
├── VoiceAsk.js         # NEW - POST /api/voice/ask
└── VoiceSettings.js    # FUTURE - User preferences
```

---

## Implementation Checklist

- [ ] Create VoiceAsk.js endpoint
- [ ] Add OPENAI_API_KEY to Azure Function App settings
- [ ] Implement parseQuery() with OpenAI
- [ ] Implement resolveCity() mapping
- [ ] Implement resolveTimeframe() mapping
- [ ] Implement formatSpokenResponse()
- [ ] Add rate limiting
- [ ] Test with various query patterns
- [ ] Create shareable Siri Shortcut
- [ ] Document iCloud share link

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | TBD | Initial implementation |
