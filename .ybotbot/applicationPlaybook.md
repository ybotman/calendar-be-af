# Application Playbook - Calendar Backend Azure Functions

**Project:** calendar-be-af
**Description:** Azure Functions migration of Master Calendar backend
**Applications:** TangoTiempo, HarmonyJunction
**Last Updated:** 2025-10-06

---

## Architecture Overview

### Technology Stack
- **Runtime:** Node.js 18+
- **Framework:** Azure Functions v4 (@azure/functions)
- **Database:** MongoDB (existing shared instance)
- **Observability:** Structured logging + in-memory metrics
- **API Documentation:** OpenAPI 3.0 (Swagger)

### Directory Structure
```
calendar-be-af/
├── src/
│   ├── app.js                 # Main entry point
│   ├── functions/             # Azure Function endpoints
│   │   ├── Health_Basic.js
│   │   ├── Metrics_Get.js
│   │   ├── Category_Get.js
│   │   ├── Role_List.js
│   │   ├── calendar-api.js
│   │   ├── calendar-events.js
│   │   ├── API_Docs.js        # Swagger UI
│   │   └── ...
│   ├── middleware/            # Reusable middleware
│   │   ├── index.js
│   │   ├── logger.js
│   │   ├── errorHandler.js
│   │   ├── metrics.js
│   │   └── ...
│   └── lib/                   # Shared utilities
├── public/
│   └── swagger.json           # OpenAPI specification
├── docs/                      # Documentation
├── tests/                     # Unit/integration tests
├── host.json                  # Azure Functions config
└── package.json
```

---

## API Documentation Standard (Swagger/OpenAPI)

### Purpose
All API endpoints MUST be documented in `public/swagger.json` using OpenAPI 3.0 specification.

### Access API Documentation
- **Local:** http://localhost:7071/api/docs
- **TEST:** https://calendarbe-test-bpg5caaqg5chbndu.eastus-01.azurewebsites.net/api/docs
- **PROD:** https://CalendarBEAF-PROD.azurewebsites.net/api/docs

### Swagger Endpoints
- `GET /api/docs` - Interactive Swagger UI
- `GET /api/swagger.json` - OpenAPI JSON specification

### When Creating New Functions

**1. Write the function code**

**2. Add JSDoc comment to function:**
```javascript
/**
 * Function: Category_List
 *
 * @description Lists all categories for an application
 * @route GET /api/categories
 * @auth anonymous (local) | function (production)
 *
 * @param {string} appId - Application ID (required)
 * @param {number} page - Page number (default: 0)
 * @param {number} limit - Items per page (default: 50, max: 100)
 * @param {boolean} activeOnly - Filter active only (default: false)
 *
 * @returns {CategoryListResponse} Paginated list of categories
 * @throws {400} ValidationError - Missing or invalid parameters
 * @throws {500} DatabaseError - Database connection failure
 *
 * @example
 * GET /api/categories?appId=TangoTiempo&page=0&limit=50
 *
 * Response:
 * {
 *   "categories": [...],
 *   "pagination": { "total": 234, "page": 0, "limit": 50, "pages": 5 }
 * }
 */
async function categoriesHandler(request, context) {
  // Implementation
}
```

**3. Update `public/swagger.json`:**

Add endpoint to `paths`:
```json
"/api/categories": {
  "get": {
    "summary": "List categories",
    "description": "Retrieve paginated list of event categories",
    "tags": ["Categories"],
    "operationId": "listCategories",
    "parameters": [
      {
        "name": "appId",
        "in": "query",
        "required": true,
        "schema": { "type": "string" }
      },
      {
        "name": "page",
        "in": "query",
        "schema": { "type": "integer", "default": 0 }
      }
    ],
    "responses": {
      "200": {
        "description": "Categories retrieved successfully",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/CategoriesResponse"
            }
          }
        }
      }
    }
  }
}
```

Add schema to `components/schemas` if needed:
```json
"CategoriesResponse": {
  "type": "object",
  "properties": {
    "categories": {
      "type": "array",
      "items": { "$ref": "#/components/schemas/Category" }
    },
    "pagination": {
      "$ref": "#/components/schemas/Pagination"
    }
  }
}
```

**4. Test in Swagger UI:**
```bash
# Start server
npm run dev

# Open browser
open http://localhost:7071/api/docs

# Test endpoint in Swagger UI
```

**5. Commit changes:**
```bash
git add public/swagger.json src/functions/YourFunction.js
git commit -m "feat: Add YourFunction endpoint with Swagger docs"
```

---

## Middleware Standards

### Available Middleware

**1. standardMiddleware** - Full observability stack
```javascript
const { standardMiddleware } = require('../middleware');

app.http('FunctionName', {
  handler: standardMiddleware(async (request, context) => {
    // Your logic
    return { status: 200, body: { data: 'result' } };
  })
});
```

**Includes:**
- ✅ Structured logging (JSON format)
- ✅ Error handling with custom error classes
- ✅ Metrics collection (request count, duration, errors)
- ✅ Correlation IDs for tracing

**2. lightweightMiddleware** - Minimal overhead for health checks
```javascript
const { lightweightMiddleware } = require('../middleware');

app.http('Health', {
  handler: lightweightMiddleware(async (request, context) => {
    return { status: 200, body: { status: 'healthy' } };
  })
});
```

**Includes:**
- ✅ Basic logging
- ✅ Error handling
- ❌ No metrics collection
- ❌ No correlation IDs

### When to Use Each

| Endpoint Type | Middleware | Reason |
|---------------|------------|--------|
| Business Logic | `standardMiddleware` | Full observability needed |
| Health Checks | `lightweightMiddleware` | Minimal overhead |
| Metrics Endpoint | `lightweightMiddleware` | Avoid circular metrics |
| Admin/Maintenance | `standardMiddleware` | Track all operations |

---

## Response Format Standards

### Success Response
```json
{
  "data": {
    // Actual response data
  },
  "meta": {
    // Optional metadata (pagination, counts, etc)
  }
}
```

### Error Response
```json
{
  "error": "ErrorType",
  "message": "Human-readable error message",
  "statusCode": 400,
  "timestamp": "2025-10-06T20:30:45.123Z"
}
```

### Pagination Format
```json
{
  "data": [...],
  "pagination": {
    "total": 234,
    "page": 0,
    "limit": 50,
    "pages": 5
  }
}
```

---

## Logging Standards

### Log Levels
- **error** - Failures, exceptions, critical issues
- **warn** - Deprecated usage, recoverable issues
- **info** - Normal operations, request tracking
- **debug** - Detailed diagnostic information (dev only)

### Structured Logging Format
```javascript
context.logger.info('Category list retrieved', {
  appId: 'TangoTiempo',
  count: 15,
  page: 0,
  duration: 245
});
```

**Output:**
```json
{
  "timestamp": "2025-10-06T20:30:45.123Z",
  "level": "info",
  "message": "Category list retrieved",
  "function": "Category_List",
  "correlationId": "req-abc-123",
  "metadata": {
    "appId": "TangoTiempo",
    "count": 15,
    "page": 0,
    "duration": 245
  }
}
```

---

## Testing Standards

### Unit Tests
**Location:** `src/functions/__tests__/FunctionName.test.js`

```javascript
const { describe, test, expect } = require('@jest/globals');

describe('Category_Get', () => {
  test('returns categories with valid appId', async () => {
    const request = mockRequest({ appId: 'TangoTiempo' });
    const context = mockContext();

    const response = await handler(request, context);

    expect(response.status).toBe(200);
    expect(response.body.categories).toBeInstanceOf(Array);
  });

  test('returns 400 without appId', async () => {
    const request = mockRequest({});
    const context = mockContext();

    const response = await handler(request, context);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });
});
```

### Integration Tests
```bash
# Start local functions
npm run dev

# Run integration tests
npm test
```

---

## Deployment Standards

### Environments

| Environment | URL | Branch | Auto-Deploy |
|-------------|-----|--------|-------------|
| **Local** | http://localhost:7071 | - | No |
| **TEST** | https://calendarbe-test-...net | DEVL | Yes (on push) |
| **PROD** | https://CalendarBEAF-PROD...net | main | Yes (on merge) |

### CI/CD Pipeline (GitHub Actions)

**On push to DEVL:**
1. Run tests
2. Build
3. Deploy to TEST environment
4. Run smoke tests

**On merge to main:**
1. Run tests
2. Build
3. Deploy to PROD environment
4. Run smoke tests
5. Create release tag

### Manual Deployment
```bash
# Login to Azure
az login

# Deploy to TEST
func azure functionapp publish CalendarBEAF-TEST

# Deploy to PROD
func azure functionapp publish CalendarBEAF-PROD
```

---

## Database Standards

### MongoDB Connection
- **Reuse connections** across invocations (connection pooling)
- **Timeout:** 5 seconds for server selection
- **Pool Size:** Max 10 connections per function

```javascript
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  const db = client.db(dbName);

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}
```

### Collection Naming
- **Format:** PascalCase (e.g., `Categories`, `Users`, `Roles`)
- **Shared:** Collections shared with Express backend
- **New:** Prefix with `AF_` for Azure Functions-only collections

---

## Security Standards

### Authentication
- **Local/Dev:** `authLevel: 'anonymous'`
- **Production:** `authLevel: 'function'` (requires API key)
- **Admin Endpoints:** `authLevel: 'function'` always

### Secrets Management
- **Never** commit secrets to git
- Use **Azure Key Vault** for production
- Use **environment variables** for local dev
- File: `.env.local` (gitignored)

### CORS Configuration
**File:** `host.json`
```json
{
  "extensions": {
    "http": {
      "customHeaders": {
        "Access-Control-Allow-Origin": "https://tangotiempo.com,https://harmonyjunction.org",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization"
      }
    }
  }
}
```

---

## Performance Standards

### Response Time Targets
- **Health Check:** < 100ms
- **Simple Queries:** < 500ms
- **Complex Queries:** < 2000ms
- **Mutations:** < 1000ms

### Optimization Techniques
1. **Connection Pooling:** Reuse MongoDB connections
2. **Indexes:** Ensure proper database indexes
3. **Pagination:** Always paginate large result sets
4. **Caching:** Cache frequently accessed data (Redis future)
5. **Async Operations:** Use Promise.all for parallel ops

---

## Monitoring & Observability

### Metrics Endpoint
**URL:** `GET /api/metrics`

**Returns:**
```json
{
  "summary": {
    "totalRequests": 1234,
    "totalErrors": 5,
    "errorRate": "0.41%",
    "avgResponseTime": 245.6
  },
  "byFunction": {
    "Category_List": 500,
    "Health_Basic": 734
  },
  "slowestEndpoints": [
    { "function": "Category_List", "avgDuration": 380 }
  ]
}
```

### Logs Query (Future - CALBEAF-38)
**URL:** `GET /api/logs`

**Parameters:**
- `appId` - Application ID (required)
- `startDate` - Filter from date
- `endDate` - Filter to date
- `level` - Log level (error, warn, info, debug)
- `function` - Function name
- `page` - Page number
- `pageSize` - Items per page

---

## Migration Strategy

### Phase 1: Foundation (Current - CALBEAF-38)
- ✅ Middleware infrastructure
- ✅ Swagger/OpenAPI documentation
- ⬜ Logs API endpoint
- ⬜ Complete observability

### Phase 2: Core Endpoints (CALBEAF-39+)
- Categories CRUD
- Roles management
- Venues management
- Events management

### Phase 3: A/B Testing (CALBEAF-40)
- Traffic routing Express vs Azure Functions
- Performance comparison
- Migration decision metrics

### Phase 4: Production Cutover
- Full traffic to Azure Functions
- Decommission Express backend
- Monitoring & optimization

---

## Quick Reference

### Common Commands
```bash
# Development
npm run dev                 # Start local Functions
npm test                    # Run tests
npm run lint                # Check code style

# Deployment
func azure functionapp publish CalendarBEAF-TEST
func azure functionapp publish CalendarBEAF-PROD

# Documentation
open http://localhost:7071/api/docs    # View Swagger UI
```

### Important Files
- `public/swagger.json` - API documentation
- `src/app.js` - Function registration
- `src/middleware/index.js` - Middleware exports
- `host.json` - Azure Functions config
- `.env.local` - Local environment variables

### Support
- **JIRA Epic:** CALBEAF-37 (Production Infrastructure)
- **Retrospective:** `.ybotbot/retrospectivePlaybook.md`
- **Design Docs:** `docs/` directory

---

**Last Updated:** 2025-10-06
**Maintained By:** AI-GUILD YBOTBOT
**Project Status:** In Development (CALBEAF-38 40% Complete)
