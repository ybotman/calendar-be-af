# Azure Function Subtask Template

## Title Format
`<Entity>_<Action> - <HTTP Method> <Path>`

## Description Template
```
Migrate the <HTTP METHOD> <PATH> endpoint to Azure Function.

Function Name: <Entity>_<Action>.js
HTTP Method: <METHOD>
Route: <PATH>
Authentication: <None|JWT Required|Admin Only>

Current Express Implementation:
- File: routes/server<Entity>.js
- Line: <line numbers>

Parameters:
- Query: <list query parameters>
- Path: <list path parameters>
- Body: <list body fields for POST/PUT>

Business Logic:
- <Brief description of what the endpoint does>
- <Any special validation or processing>
- <Database operations performed>

Dependencies:
- Models: <list required models>
- Middleware: <list required middleware>
- Utils: <list required utilities>

Response Format:
- Success: <HTTP code and response structure>
- Error: <HTTP codes and error formats>

Test Scenarios:
1. <Happy path test>
2. <Error case test>
3. <Edge case test>

Acceptance Criteria:
- [ ] Function responds to correct HTTP method and path
- [ ] Authentication works as expected
- [ ] All query/path/body parameters handled
- [ ] Response format matches Express version
- [ ] Error handling matches Express version
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Performance meets SLA
```

## Example Filled Template

### Event_List - GET /api/events

Migrate the GET /api/events endpoint to Azure Function.

Function Name: Event_List.js
HTTP Method: GET
Route: /api/events
Authentication: None (public endpoint)

Current Express Implementation:
- File: routes/serverEvents.js
- Line: 209-300

Parameters:
- Query: appId, start, end, page, limit, organizerId, masteredCityId, venueId, categoryId, lat, lng, radius, active, featured, search
- Path: None
- Body: None

Business Logic:
- Filters events by multiple criteria
- Supports date range filtering
- Geolocation search within radius
- Text search in title/description
- Pagination with default 400 items per page
- Population of related data (organizer, venue, category)

Dependencies:
- Models: events.js
- Middleware: rateLimiter.js
- Utils: logger.js, apiResponseFormatter.js

Response Format:
- Success: 200 - { events: [], totalCount: number, page: number, totalPages: number }
- Error: 400 - { message: "appId is required" }
- Error: 500 - { message: "Error fetching events" }

Test Scenarios:
1. Get events with date range filter
2. Get events with geolocation search
3. Handle missing appId parameter
4. Verify pagination works correctly

Acceptance Criteria:
- [ ] Function responds to GET /api/events
- [ ] No authentication required
- [ ] All 15 query parameters supported
- [ ] Response includes pagination metadata
- [ ] Geolocation search works within radius
- [ ] Date filtering works correctly
- [ ] Unit tests cover all filters
- [ ] Integration test with TEST database
- [ ] Response time < 500ms for typical query