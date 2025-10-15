# Azure Functions - Available Endpoints

**Last Updated**: 2025-10-13
**Base URL (Local)**: `http://localhost:7071`
**Base URL (TEST)**: `https://calbeaf-test.azurewebsites.net`

---

## ✅ Currently Available Endpoints

### Health Checks (No Auth Required)
- `GET /api/health` - Basic health check
- `GET /api/health/version` - Version information
- `GET /api/health/mongodb` - MongoDB connection test
- `GET /api/health/mongodb/test` - TEST database health
- `GET /api/health/mongodb/prod` - PROD database health

### Metrics (No Auth Required)
- `GET /api/metrics` - Service metrics

### Categories (No Auth Required)
- `GET /api/categories` - List all categories

### Events
- `GET /api/events` - List events
- `POST /api/events` - Create event
- `GET /api/events/{eventId}` - Get event by ID
- `PUT /api/events/{eventId}` - Update event
- `DELETE /api/events/{eventId}` - Delete event
- `GET /api/events/id/{id}` - Get event by ID (for social sharing)

### MapCenter API (Requires Firebase Auth) ✅
- `GET /api/mapcenter` - Get user's saved map center
- `PUT /api/mapcenter` - Save user's map center
- **Documented in Swagger:** Yes (as of 2025-10-15)

### Documentation
- `GET /api/docs` - Swagger UI
- `GET /api/swagger.json` - OpenAPI spec

---

## ❌ NOT YET Implemented (Will Return 404)

These are planned but not yet built:

### Venues (CALBEAF-8, CALBEAF-27-32, CALBEAF-42)
- ❌ `GET /api/venues` - List venues
- ❌ `POST /api/venues` - Create venue
- ❌ `GET /api/venues/:id` - Get venue by ID
- ❌ `PUT /api/venues/:id` - Update venue
- ❌ `DELETE /api/venues/:id` - Delete venue
- ❌ `GET /api/venues/nearest-city` - Get nearest city

### User Logins (CALBEAF-9)
- ❌ All user login endpoints

### Organizers (CALBEAF-10)
- ❌ All organizer endpoints

### Firebase Integration (CALBEAF-12)
- ❌ All Firebase integration endpoints

### Roles (CALBEAF-13)
- ❌ All role management endpoints

---

## 🔄 Frontend Health Check Update Required

**Current Issue**: Frontend is checking `/api/venues?appId=1&limit=1` which doesn't exist yet.

**Recommended Fix**: Update frontend health check to use available endpoints:

```javascript
// useServiceHealth.js
async function checkAzureFunctions() {
  try {
    // Use /api/health instead of /api/venues
    const response = await fetch(`${AZURE_FUNCTIONS_URL}/api/health`);

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      status: 'healthy',
      service: data.service,
      version: data.version,
      timestamp: data.timestamp
    };

  } catch (error) {
    console.error('Azure Functions health check failed:', error);
    return { status: 'unhealthy', error: error.message };
  }
}
```

**Alternative**: Check multiple endpoints to verify full functionality:

```javascript
async function checkAzureFunctions() {
  const checks = [
    { name: 'health', url: '/api/health' },
    { name: 'categories', url: '/api/categories' },
    { name: 'events', url: '/api/events' }
  ];

  const results = await Promise.allSettled(
    checks.map(check =>
      fetch(`${AZURE_FUNCTIONS_URL}${check.url}`)
        .then(r => ({ ...check, ok: r.ok }))
    )
  );

  const allHealthy = results.every(r =>
    r.status === 'fulfilled' && r.value.ok
  );

  return { status: allHealthy ? 'healthy' : 'degraded', checks: results };
}
```

---

## 📊 Migration Status by Domain

| Domain | JIRA | Status | Endpoints Available |
|--------|------|--------|---------------------|
| Health Checks | CALBEAF-14 | ✅ Complete | 5/5 |
| Categories | CALBEAF-6, CALBEAF-16 | ✅ Complete | 1/1 |
| Events | CALBEAF-7, CALBEAF-17-26, CALBEAF-43 | 🟡 Partial | 6/10 |
| MapCenter | CALBEAF-48 | ✅ Complete | 2/2 |
| Venues | CALBEAF-8, CALBEAF-27-32, CALBEAF-42 | ❌ Not Started | 0/6 |
| User Logins | CALBEAF-9 | ❌ Not Started | 0/18 |
| Organizers | CALBEAF-10 | ❌ Not Started | 0/? |
| Firebase | CALBEAF-12 | ❌ Not Started | 0/3 |
| Roles | CALBEAF-13 | ❌ Not Started | 0/? |

---

## 🚦 Frontend Integration Priority

1. **Immediate** (Ready Now):
   - Update health checks to use `/api/health`
   - Integrate MapCenter API for TIEMPO-312

2. **Next** (Requires Implementation):
   - Venues API (CALBEAF-42)
   - User Login API (CALBEAF-9)
   - Firebase Integration (CALBEAF-12)

---

## 🔍 Testing Available Endpoints

### Quick Test Script

```bash
# Base URL
BASE="http://localhost:7071"

# Health check
curl $BASE/api/health

# Categories
curl $BASE/api/categories

# Events list
curl $BASE/api/events

# MapCenter (requires Firebase token)
TOKEN="your-firebase-id-token"
curl -H "Authorization: Bearer $TOKEN" $BASE/api/mapcenter
```

### Test with Postman/Insomnia

Import this collection to test all available endpoints:
- Collection available at: `./docs/postman-collection.json` (to be created)

---

## 📝 Notes

- All endpoints use JSON request/response format
- Authentication uses Firebase Bearer tokens where required
- CORS is configured for `https://tangotiempo.com`
- Rate limiting: TBD
- API versioning: TBD

---

## 🆘 Troubleshooting

**404 Not Found**
- Endpoint not implemented yet
- Check this document for available endpoints
- Verify URL spelling and method (GET/POST/PUT/DELETE)

**401 Unauthorized**
- Missing Authorization header
- Invalid Firebase token
- Token expired (get new token from Firebase)

**500 Internal Server Error**
- Check Azure Functions logs
- Verify MongoDB connection
- Check Application Insights

---

## Contact

**Questions?** Reference:
- JIRA Epic: CALBEAF-5 (BE to AF Migration)
- Documentation: `/docs/MAPCENTER-API.md`
