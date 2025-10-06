# Logs Query API - Design Document

**Epic:** CALBEAF-37 - Production Infrastructure & Readiness
**Story:** CALBEAF-38 - Observability Infrastructure
**Created:** 2025-10-06

---

## Overview

Design for a new Azure Function endpoint `Logs_Query` that enables the calops admin dashboard to query and retrieve application logs for monitoring, debugging, and usage analytics.

### Purpose
- Provide logs to calops dashboard `/dashboard/logs` page
- Enable filtering, searching, and pagination of logs
- Support real-time monitoring and historical analysis
- Track Azure Functions usage for migration planning

---

## API Specification

### Endpoint
```
GET /api/logs
```

### Authentication
- **authLevel:** `function` (requires API key in production)
- **Local Dev:** `anonymous` for testing

### Request Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| appId | string | Yes | Application ID (TangoTiempo/HarmonyJunction) | "tt-app-123" |
| page | number | No | Page number (0-indexed) | 0 |
| pageSize | number | No | Results per page (default: 50, max: 100) | 50 |
| startDate | ISO string | No | Filter logs from this date | "2025-10-06T00:00:00Z" |
| endDate | ISO string | No | Filter logs until this date | "2025-10-06T23:59:59Z" |
| levels | array | No | Log levels to include | ["error", "warn"] |
| actions | array | No | Specific actions/operations | ["Category_List", "Health_Get"] |
| resources | array | No | Resource types | ["category", "venue"] |
| statuses | array | No | HTTP status codes | ["200", "500"] |
| searchText | string | No | Free-text search in message | "database" |
| userEmail | string | No | Filter by user email | "user@example.com" |
| userId | string | No | Filter by user ID | "user-123" |
| orgId | string | No | Filter by organization ID | "org-456" |
| httpStatus | string | No | Specific HTTP status code | "404" |
| minDuration | number | No | Min request duration (ms) | 1000 |
| maxDuration | number | No | Max request duration (ms) | 5000 |
| endpoint | string | No | Specific API endpoint | "/api/categories" |
| ipAddress | string | No | Client IP address | "192.168.1.1" |

### Response

```json
{
  "logs": [
    {
      "_id": "log-id-123",
      "timestamp": "2025-10-06T14:30:45.123Z",
      "level": "info",
      "message": "Category list retrieved successfully",
      "function": "Category_List",
      "correlationId": "req-abc-123",
      "duration": 245,
      "httpStatus": 200,
      "endpoint": "/api/categories",
      "method": "GET",
      "userId": "user-123",
      "userEmail": "user@example.com",
      "orgId": "org-456",
      "ipAddress": "192.168.1.100",
      "metadata": {
        "itemsReturned": 15,
        "cacheHit": false,
        "dbQueryTime": 180
      }
    }
  ],
  "pagination": {
    "page": 0,
    "pageSize": 50,
    "total": 1234,
    "totalPages": 25,
    "hasNext": true,
    "hasPrevious": false
  },
  "filters": {
    "applied": ["appId", "startDate", "levels"],
    "startDate": "2025-10-06T00:00:00Z",
    "endDate": "2025-10-06T23:59:59Z",
    "levels": ["error", "warn"]
  }
}
```

---

## Data Storage Options

### Option 1: MongoDB Collection (RECOMMENDED for MVP)

**Collection:** `logs`

**Schema:**
```javascript
{
  _id: ObjectId,
  timestamp: Date,
  level: String,  // 'error', 'warn', 'info', 'debug'
  message: String,
  function: String,  // Azure Function name
  correlationId: String,
  duration: Number,  // ms
  httpStatus: Number,
  endpoint: String,
  method: String,  // GET, POST, etc
  userId: String,
  userEmail: String,
  orgId: String,
  ipAddress: String,
  metadata: Object,  // Flexible additional data
  appId: String,
  createdAt: Date
}
```

**Indexes:**
```javascript
db.logs.createIndex({ timestamp: -1 });
db.logs.createIndex({ appId: 1, timestamp: -1 });
db.logs.createIndex({ level: 1, timestamp: -1 });
db.logs.createIndex({ function: 1, timestamp: -1 });
db.logs.createIndex({ correlationId: 1 });
db.logs.createIndex({ userId: 1 });
db.logs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // 30-day TTL
```

**Pros:**
- Already using MongoDB
- Flexible schema
- Good query performance with indexes
- Easy to implement
- Low cost

**Cons:**
- Not Azure-native
- Manual index management
- Need to implement TTL cleanup

### Option 2: Azure Application Insights

**Query via REST API:**
```
GET https://api.applicationinsights.io/v1/apps/{appId}/query?query={KQLQuery}
```

**Pros:**
- Azure-native integration
- Powerful KQL query language
- Built-in retention policies
- Automatic alerting
- No extra storage costs (included with Functions)

**Cons:**
- Query latency (3-5 seconds)
- Complex KQL learning curve
- Requires Application Insights setup
- API rate limits

### Recommendation: **MongoDB for MVP, migrate to App Insights for production**

---

## Implementation Plan

### Phase 1: Basic Logs API (MongoDB)

**File:** `src/functions/Logs_Query.js`

```javascript
const { app } = require('@azure/functions');
const { standardMiddleware } = require('../middleware');
const { connectToMongoDB } = require('../lib/mongodb');

async function logsQueryHandler(request, context) {
  const { searchParams } = new URL(request.url);

  // Extract and validate query parameters
  const filters = {
    appId: searchParams.get('appId'),
    page: parseInt(searchParams.get('page') || '0'),
    pageSize: Math.min(parseInt(searchParams.get('pageSize') || '50'), 100),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    levels: searchParams.get('levels')?.split(',').filter(Boolean),
    functions: searchParams.get('actions')?.split(',').filter(Boolean),
    searchText: searchParams.get('searchText'),
    httpStatus: searchParams.get('httpStatus'),
    userEmail: searchParams.get('userEmail'),
    userId: searchParams.get('userId'),
    minDuration: parseFloat(searchParams.get('minDuration')),
    maxDuration: parseFloat(searchParams.get('maxDuration'))
  };

  // Validate required fields
  if (!filters.appId) {
    return {
      status: 400,
      body: { error: 'appId is required' }
    };
  }

  // Build MongoDB query
  const query = { appId: filters.appId };

  if (filters.startDate || filters.endDate) {
    query.timestamp = {};
    if (filters.startDate) query.timestamp.$gte = new Date(filters.startDate);
    if (filters.endDate) query.timestamp.$lte = new Date(filters.endDate);
  }

  if (filters.levels?.length > 0) query.level = { $in: filters.levels };
  if (filters.functions?.length > 0) query.function = { $in: filters.functions };
  if (filters.searchText) query.message = { $regex: filters.searchText, $options: 'i' };
  if (filters.httpStatus) query.httpStatus = parseInt(filters.httpStatus);
  if (filters.userEmail) query.userEmail = filters.userEmail;
  if (filters.userId) query.userId = filters.userId;

  if (filters.minDuration || filters.maxDuration) {
    query.duration = {};
    if (filters.minDuration) query.duration.$gte = filters.minDuration;
    if (filters.maxDuration) query.duration.$lte = filters.maxDuration;
  }

  // Connect to MongoDB
  const db = await connectToMongoDB();
  const logsCollection = db.collection('logs');

  // Get total count for pagination
  const total = await logsCollection.countDocuments(query);

  // Fetch logs with pagination
  const logs = await logsCollection
    .find(query)
    .sort({ timestamp: -1 })
    .skip(filters.page * filters.pageSize)
    .limit(filters.pageSize)
    .toArray();

  // Build response
  const totalPages = Math.ceil(total / filters.pageSize);

  return {
    status: 200,
    body: {
      logs,
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages,
        hasNext: filters.page < totalPages - 1,
        hasPrevious: filters.page > 0
      },
      filters: {
        applied: Object.keys(filters).filter(k => filters[k] !== null && filters[k] !== undefined),
        ...filters
      }
    }
  };
}

// Register function
app.http('Logs_Query', {
  methods: ['GET'],
  authLevel: 'anonymous', // Change to 'function' for production
  route: 'logs',
  handler: standardMiddleware(logsQueryHandler)
});
```

### Phase 2: Logging Integration

Update `src/middleware/logger.js` to write logs to MongoDB:

```javascript
async saveToDB(logEntry) {
  try {
    const db = await connectToMongoDB();
    await db.collection('logs').insertOne(logEntry);
  } catch (error) {
    console.error('Failed to save log to MongoDB:', error);
  }
}
```

### Phase 3: Calops Integration

Update `calops/src/lib/api-client/logs.js`:

```javascript
import { apiGet } from './utils';

export default {
  async getLogs(filters) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value != null) {
        if (Array.isArray(value)) {
          params.append(key, value.join(','));
        } else {
          params.append(key, value.toString());
        }
      }
    });

    return apiGet(`/logs?${params.toString()}`);
  },

  async exportLogs(filters, format = 'csv') {
    // Implementation for CSV export
    const response = await this.getLogs({ ...filters, pageSize: 10000 });
    // Convert to CSV and trigger download
    return response;
  }
};
```

---

## Testing Plan

### Unit Tests

```javascript
describe('Logs_Query', () => {
  test('returns logs with valid appId', async () => {
    const request = mockRequest({ appId: 'test-app' });
    const response = await logsQueryHandler(request, mockContext);
    expect(response.status).toBe(200);
    expect(response.body.logs).toBeInstanceOf(Array);
  });

  test('returns 400 without appId', async () => {
    const request = mockRequest({});
    const response = await logsQueryHandler(request, mockContext);
    expect(response.status).toBe(400);
  });

  test('filters by date range', async () => {
    const request = mockRequest({
      appId: 'test-app',
      startDate: '2025-10-01T00:00:00Z',
      endDate: '2025-10-06T23:59:59Z'
    });
    const response = await logsQueryHandler(request, mockContext);
    // Assert logs are within date range
  });
});
```

### Integration Tests

1. Start local Functions runtime
2. Seed MongoDB with test logs
3. Call `/api/logs` with various filters
4. Verify pagination works correctly
5. Test calops dashboard integration

---

## Migration Path

### MVP (Now)
- MongoDB storage
- Basic filtering
- Pagination
- Calops integration

### Phase 2 (Production)
- Application Insights integration
- Advanced KQL queries
- Real-time log streaming
- Alerting rules

### Phase 3 (Advanced)
- Log aggregation and analytics
- Anomaly detection
- Performance insights dashboard
- Export to external systems (Splunk, DataDog)

---

## Performance Considerations

- **MongoDB Indexes:** Ensure proper indexes for common query patterns
- **Pagination Limits:** Max 100 logs per page to prevent timeout
- **TTL:** 30-day retention in MongoDB (configurable)
- **Caching:** Consider Redis for frequently accessed logs
- **Query Optimization:** Avoid full collection scans

---

## Security

- **Authentication:** Require API key (function authLevel)
- **Authorization:** Check user has access to requested appId
- **Data Privacy:** Sanitize sensitive data before logging
- **Rate Limiting:** Prevent abuse via Azure API Management
- **CORS:** Configure allowed origins for calops domain

---

## Next Steps

1. Create `src/functions/Logs_Query.js`
2. Update middleware to write to MongoDB logs collection
3. Create MongoDB indexes
4. Add unit tests
5. Test with calops dashboard
6. Deploy to Azure TEST environment
7. Monitor and optimize query performance

---

**Status:** Design Complete
**Ready for Implementation:** Yes
**Estimated Effort:** 4-6 hours
