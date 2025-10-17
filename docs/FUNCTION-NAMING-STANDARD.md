# Azure Functions - Naming Standard

**Version**: 2.0
**Last Updated**: 2025-10-17
**Status**: Active
**Approach**: Domain-Grouped Functions

---

## Purpose

This document defines the naming conventions for Azure Functions to ensure consistency, maintainability, and clarity across the codebase.

**Key Principle:** Group related CRUD operations by domain in a single file, sharing validation logic and helpers.

---

## File Organization Pattern

### Standard Format
```
{Domain}.js
```

One file per business domain, containing all related CRUD operations.

**Example:**
- `Events.js` - All event operations (Get, Create, Update, Delete)
- `Categories.js` - All category operations
- `Venues.js` - All venue operations

---

## Function Naming Pattern

### Format (inside domain files)
```
{Domain}_{HttpVerb}[_{Qualifier}]
```

- **Domain**: Plural noun representing the entity (e.g., `Events`, `Venues`, `Categories`)
- **HttpVerb**: REST verb (e.g., `Get`, `Create`, `Update`, `Delete`)
- **Qualifier**: Optional descriptor (e.g., `ById`, `Nearest`)

---

## Examples

### Domain-Grouped Files

#### Events.js
All event-related operations in one file:

| Function Name | HTTP Method | Route | Description |
|---------------|-------------|-------|-------------|
| `Events_Get` | GET | `/api/events` | List all events |
| `Events_GetById` | GET | `/api/events/{id}` | Get single event |
| `Events_Create` | POST | `/api/events` | Create new event |
| `Events_Update` | PUT | `/api/events/{id}` | Update event (checks auth in handler) |
| `Events_Delete` | DELETE | `/api/events/{id}` | Delete event (checks auth in handler) |

#### Categories.js
All category-related operations:

| Function Name | HTTP Method | Route | Description |
|---------------|-------------|-------|-------------|
| `Categories_Get` | GET | `/api/categories` | List categories |
| `Categories_Create` | POST | `/api/categories` | Create category (future) |
| `Categories_Update` | PUT | `/api/categories/{id}` | Update category (future) |

#### Venues.js
All venue-related operations:

| Function Name | HTTP Method | Route | Description |
|---------------|-------------|-------|-------------|
| `Venues_Get` | GET | `/api/venues` | List venues |
| `Venues_GetById` | GET | `/api/venues/{id}` | Get single venue |
| `Venues_GetNearest` | GET | `/api/venues/nearest` | Get nearest venue |
| `Venues_Create` | POST | `/api/venues` | Create venue (future) |

#### MapCenter.js
User preference operations:

| Function Name | HTTP Method | Route | Description |
|---------------|-------------|-------|-------------|
| `MapCenter_Get` | GET | `/api/mapcenter` | Get user's map center |
| `MapCenter_Update` | PUT | `/api/mapcenter` | Update map center |

---

## Special Patterns

### Health Checks
```
Health_{Resource}[_{Environment}]
```

Examples:
- `Health_Basic` → `/api/health`
- `Health_Version` → `/api/health/version`
- `Health_MongoDB` → `/api/health/mongodb`
- `Health_MongoDB_Test` → `/api/health/mongodb/test`
- `Health_MongoDB_Prod` → `/api/health/mongodb/prod`

### Tracking/Analytics
```
{Resource}Track
```

Examples:
- `UserLoginTrack` → `/api/user/login-track`
- `VisitorTrack` → `/api/visitor/track`

### Metrics
```
Metrics_{Qualifier}
```

Examples:
- `Metrics_Get` → `/api/metrics`
- `Metrics_Clear` → `/api/metrics/clear`

### Documentation
```
{Tool}{Type}
```

Examples:
- `SwaggerUI` → `/api/docs`
- `SwaggerJSON` → `/api/swagger.json`

---

## File Naming Conventions

### Pattern
```
{Domain}.js
```

One file per business domain containing all related CRUD operations.

### Examples
- `Events.js` - All event operations (Get, GetById, Create, Update, Delete)
- `Categories.js` - All category operations
- `Venues.js` - All venue operations
- `MapCenter.js` - User preference operations

### Special Cases
- `Health_Basic.js` - Separate health check operations
- `Health_MongoDB.js` - Database health checks
- `UserLoginTrack.js` - Analytics tracking
- `VisitorTrack.js` - Visitor analytics
- `API_Docs.js` - Swagger UI/JSON

### Why Domain Grouping?

✅ **Shared Logic**: Validation, formatting, helpers co-located
✅ **Maintainability**: All event logic in one place
✅ **Reduced Duplication**: Common code doesn't need importing
✅ **Easier Navigation**: Know exactly where to find code

---

## Function Registration Pattern

### Domain-Grouped Structure
```javascript
// src/functions/Events.js
const { app } = require('@azure/functions');
const { standardMiddleware } = require('../middleware');
const { MongoClient } = require('mongodb');

// ============================================
// SHARED HELPERS (used by all functions in this file)
// ============================================

function validateEventData(data) {
    // Shared validation logic
}

function formatEventResponse(event) {
    // Shared formatting logic
}

async function connectToDatabase() {
    // Shared database connection
}

// ============================================
// FUNCTION 1: GET /api/events
// ============================================

/**
 * GET /api/events
 * List all events with pagination
 */
async function eventsGetHandler(request, context) {
    const appId = request.query.get('appId');
    // Handler logic
}

app.http('Events_Get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'events',
    handler: standardMiddleware(eventsGetHandler)
});

// ============================================
// FUNCTION 2: GET /api/events/{id}
// ============================================

/**
 * GET /api/events/{id}
 * Get single event by ID
 */
async function eventsGetByIdHandler(request, context) {
    const eventId = request.params.id;
    // Handler logic
}

app.http('Events_GetById', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'events/{id}',
    handler: standardMiddleware(eventsGetByIdHandler)
});

// ============================================
// FUNCTION 3: POST /api/events
// ============================================

/**
 * POST /api/events
 * Create new event
 */
async function eventsCreateHandler(request, context) {
    const data = await request.json();
    validateEventData(data);  // Use shared helper
    // Handler logic
}

app.http('Events_Create', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'events',
    handler: standardMiddleware(eventsCreateHandler)
});

// ============================================
// FUNCTION 4: PUT /api/events/{id}
// ============================================

/**
 * PUT /api/events/{id}
 * Update event (auth checked in handler)
 */
async function eventsUpdateHandler(request, context) {
    const eventId = request.params.id;
    const user = request.user;  // From Firebase middleware

    // Authorization logic
    const event = await db.collection('Events').findOne({ _id: eventId });
    const canUpdate =
        user.role === 'admin' ||
        event.creatorId === user.id ||
        event.organizerId === user.id;

    if (!canUpdate) {
        return { status: 403, body: { error: 'Forbidden' } };
    }

    // Update logic
}

app.http('Events_Update', {
    methods: ['PUT'],
    authLevel: 'function',
    route: 'events/{id}',
    handler: standardMiddleware(eventsUpdateHandler)
});

// ============================================
// FUNCTION 5: DELETE /api/events/{id}
// ============================================

/**
 * DELETE /api/events/{id}
 * Delete event (auth checked in handler)
 */
async function eventsDeleteHandler(request, context) {
    const eventId = request.params.id;
    const user = request.user;

    // Authorization logic (similar to update)
    // Delete logic
}

app.http('Events_Delete', {
    methods: ['DELETE'],
    authLevel: 'function',
    route: 'events/{id}',
    handler: standardMiddleware(eventsDeleteHandler)
});
```

**Key Points:**
1. **One file, multiple functions**: All event operations in `Events.js`
2. **Shared helpers at top**: Validation, formatting, DB connection
3. **Function names**: `Events_Get`, `Events_Create`, etc.
4. **Handler names**: `eventsGetHandler`, `eventsCreateHandler`, etc. (camelCase)
5. **Routes**: `events`, `events/{id}` (lowercase)
6. **Authorization**: Checked in handler logic, not separate functions
7. **Middleware**: Always use `standardMiddleware`

---

## Route Conventions

### Pattern
```
/api/{resource}[/{id}][/{qualifier}]
```

### Examples
- `/api/events` → List events
- `/api/events/{id}` → Single event
- `/api/events/{id}/attendees` → Event attendees
- `/api/venues/nearest` → Nearest venue query
- `/api/health/mongodb/test` → Health check qualifier

### Multi-word Resources
Use `kebab-case`:
- `/api/user/login-track` ✅
- `/api/user/loginTrack` ❌
- `/api/user/login_track` ❌

---

## Authorization & Frontend Integration

### How Frontend Calls Functions

**Important:** Frontend calls **routes**, not function names.

Function names (`Events_Update`, `Events_Delete`) are internal to Azure Functions. The frontend only sees HTTP routes.

#### Single Route, Backend Checks Role (Recommended)

```javascript
// Backend: Events.js
app.http('Events_Update', {
    methods: ['PUT'],
    route: 'events/{id}',  // ← Frontend always calls this route
    handler: standardMiddleware(async (request, context) => {
        const user = request.user;  // From Firebase token

        // Backend checks user role and permissions
        if (user.role === 'admin') {
            // Admin can update any event
            return updateEvent(eventId, data);
        } else {
            // User can only update their own events
            if (event.creatorId !== user.id) {
                return { status: 403, body: { error: 'Forbidden' } };
            }
            return updateEvent(eventId, data);
        }
    })
});
```

**Frontend (same for all users):**
```javascript
// User or admin - same API call
PUT /api/events/123
Authorization: Bearer <firebase-token>

// Backend extracts role from token and enforces permissions
```

#### Why Not Multiple Functions?

❌ **Don't do this:**
```javascript
app.http('Events_Update', { route: 'events/{id}' });        // User route
app.http('Events_Update_Admin', { route: 'events/{id}/admin' });  // Admin route
```

Problems:
- Frontend needs to know about multiple routes
- Duplication of logic
- Harder to maintain
- FE must track user roles

✅ **Do this instead:**
- Single route for each operation
- Backend checks role from Firebase token
- Cleaner API, easier to maintain

---

## Migration Checklist

When creating or refactoring domain files:

- [ ] File name follows `{Domain}.js` pattern (e.g., `Events.js`)
- [ ] All related CRUD operations grouped in one file
- [ ] Function names follow `{Domain}_{HttpVerb}[_{Qualifier}]` pattern
- [ ] Shared helpers at top of file
- [ ] Handler functions use `camelCase` (e.g., `eventsGetHandler`)
- [ ] Routes use proper REST conventions (lowercase, kebab-case)
- [ ] Authorization checked in handler logic, not separate functions
- [ ] Uses `standardMiddleware` wrapper
- [ ] All functions documented in `swagger.json`
- [ ] Added to `AVAILABLE-ENDPOINTS.md`
- [ ] Updated JIRA ticket with changes

---

## Anti-Patterns (Avoid These)

❌ **Mixed casing in function names:**
```javascript
app.http('getEvents', ...)      // Wrong - should be Events_Get
app.http('createEvent', ...)    // Wrong - should be Events_Create
```

❌ **Singular resource names:**
```javascript
app.http('Category_Get', ...)   // Wrong - should be Categories_Get
app.http('Venue_Get', ...)      // Wrong - should be Venues_Get
```

❌ **Inconsistent file names:**
```javascript
// File: calendar-events.js
app.http('getEvents', ...)      // Wrong - file should be Events_Get.js
```

❌ **Multiple functions per file (except related health checks):**
```javascript
// calendar-events.js with 5 different functions  // Wrong - split into separate files
```

---

## Exception Cases

### When to deviate from standard:

1. **Multiple HTTP methods on same route:**
   - Example: `MapCenter` handles both GET and PUT on `/api/mapcenter`
   - Split into `MapCenter_Get.js` and `MapCenter_Update.js`

2. **Tracking/Analytics endpoints:**
   - Pattern: `{Resource}Track` (no underscore)
   - Example: `UserLoginTrack`, `VisitorTrack`

3. **Legacy compatibility (temporary):**
   - Document deviation in code comments
   - Create JIRA ticket for future refactor
   - Add to tech debt backlog

---

## Benefits

✅ **Predictability**: Easy to find function by name
✅ **Consistency**: All functions follow same pattern
✅ **Maintainability**: Clear relationship between file, function, and route
✅ **Discoverability**: New developers understand structure immediately
✅ **Tooling**: Scripts can parse and validate naming automatically

---

## Enforcement

1. **Code Review**: Check naming in all PRs
2. **CI/CD**: Future automation to validate names
3. **Documentation**: This document is source of truth
4. **Onboarding**: Include in new developer setup

---

## Questions?

**Contact:**
- JIRA Epic: CALBEAF-5 (BE to AF Migration)
- Tech Lead: Review in daily standups
- Documentation: `/docs/` directory

---

**Last Updated**: 2025-10-17
**Maintained By**: AI-GUILD YBOTBOT
