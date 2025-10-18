# BE to AF Migration - Technical Approach

## Migration Process Per Domain

### 1. Pre-Migration Analysis (Scout Phase)
For each domain:
- Map all Express routes to Azure Function names
- Identify shared dependencies (models, middleware, utils)
- Document authentication requirements
- Note any special integrations (Azure Storage, Firebase, etc.)
- Create detailed API inventory with parameters

### 2. Function Development (Builder Phase)
For each endpoint:
1. Create function file: `src/functions/<Entity>_<Action>.js`
2. Port Express route logic to Azure Function format
3. Adapt middleware to Azure Function context
4. Implement error handling and logging
5. Add input validation and sanitization
6. Configure function bindings and settings

### 3. Testing Protocol
Each function must pass:
1. **Local Testing**: `func start` with all scenarios
2. **Unit Tests**: Jest with mocked dependencies
3. **Integration Tests**: Against TEST database
4. **Load Tests**: Verify performance and scaling
5. **Security Tests**: Authentication and authorization
6. **API Contract Tests**: Ensure backward compatibility

### 4. Deployment Strategy

#### Environment Progression
```
Local Development
    ↓
DEVL Branch + Local Azure Functions
    ↓
TEST Branch + Azure Functions TEST
    ↓
PROD Branch + Azure Functions PROD
```

#### Routing Control
Use `appId` parameter for gradual rollout:
- `appId=1` → Express (default)
- `appId=test-af` → Azure Functions (testing)
- Feature flag in frontend for easy switching

### 5. Migration Order (Priority-Based)

#### High Priority - Core User Features
1. **Categories** (In Progress)
   - Simple CRUD, good pilot
   - Already WIP as Category_Get.js

2. **Events** 
   - Critical user-facing feature
   - Complex with geolocation, date filtering
   - Multiple query patterns

3. **UserLogins**
   - Authentication foundation
   - Required for secured endpoints
   - Complex with Firebase integration

4. **Venues**
   - Core data for events
   - Geolocation features
   - Replaces deprecated Locations

#### Medium Priority - Supporting Features
5. **Organizers**
   - Event ownership
   - Image upload integration
   - User connection features

6. **MasteredLocations**
   - Geographic hierarchy
   - Reference data
   - Nearest city calculations

#### Low Priority - Administrative
7. **Roles & Permissions**
   - Simple lookup
   - Rarely changes

8. **Firebase Integration**
   - Proxy services
   - User sync features

9. **Health Checks**
   - System monitoring
   - Can run parallel

10. **Regions (Legacy)**
    - Deprecated API
    - Migrate last or skip

## Code Migration Patterns

### Express to Azure Function Pattern

#### Express Route (Before):
```javascript
// routes/serverEvents.js
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { appId, start, end, page = 1, limit = 400 } = req.query;
    
    const query = { appId };
    if (start || end) {
      query.date = {};
      if (start) query.date.$gte = new Date(start);
      if (end) query.date.$lte = new Date(end);
    }
    
    const events = await Events.find(query)
      .limit(limit)
      .skip((page - 1) * limit);
      
    res.json({ events, page, limit });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

#### Azure Function (After):
```javascript
// src/functions/Event_List.js
const { app } = require('@azure/functions');
const Events = require('../../models/events');
const { authenticateToken } = require('../../middleware/auth');
const { connectDB } = require('../../utils/database');

app.http('Event_List', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      // Database connection
      await connectDB();
      
      // Authentication
      const authResult = await authenticateToken(request);
      if (!authResult.valid) {
        return { status: 401, body: 'Unauthorized' };
      }
      
      // Query parameters
      const appId = request.query.get('appId') || '1';
      const start = request.query.get('start');
      const end = request.query.get('end');
      const page = parseInt(request.query.get('page') || '1');
      const limit = parseInt(request.query.get('limit') || '400');
      
      // Build query
      const query = { appId };
      if (start || end) {
        query.date = {};
        if (start) query.date.$gte = new Date(start);
        if (end) query.date.$lte = new Date(end);
      }
      
      // Execute query
      const events = await Events.find(query)
        .limit(limit)
        .skip((page - 1) * limit);
        
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events, page, limit })
      };
    } catch (error) {
      context.log.error('Event_List error:', error);
      return {
        status: 500,
        body: JSON.stringify({ error: error.message })
      };
    }
  }
});
```

### Shared Code Structure
```
/calendar-be-af
├── src/
│   ├── functions/
│   │   ├── Category_Get.js
│   │   ├── Event_List.js
│   │   └── ...
│   ├── middleware/
│   │   ├── auth.js (adapted for AF)
│   │   └── validation.js
│   ├── models/
│   │   └── (reuse existing Mongoose models)
│   └── utils/
│       ├── database.js (connection pooling)
│       ├── logger.js (Azure-compatible)
│       └── responseFormatter.js
```

## Testing Strategy Details

### 1. Local Development Testing
```bash
# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Start local runtime
func start

# Test endpoints
curl http://localhost:7071/api/events?appId=1
```

### 2. Unit Test Example
```javascript
// __tests__/Event_List.test.js
const { Event_List } = require('../src/functions/Event_List');

describe('Event_List Function', () => {
  it('should return events for valid appId', async () => {
    const request = {
      query: new Map([['appId', '1']]),
      headers: { authorization: 'Bearer valid-token' }
    };
    
    const response = await Event_List(request, mockContext);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toHaveProperty('events');
  });
});
```

### 3. Integration Test Collections
- Postman collections per domain
- Environment variables for TEST/PROD
- Automated test runs in CI/CD

## Rollback Procedures

### Function-Level Rollback
1. Route traffic back to Express via appId
2. Disable function in Azure Portal
3. Fix issues in DEVL branch
4. Re-deploy after testing

### Domain-Level Rollback
1. Update frontend feature flag
2. Document issues in JIRA
3. Keep Express endpoint active
4. Plan remediation sprint

## Monitoring & Validation

### Key Metrics to Track
1. **Response Times**: AF vs Express comparison
2. **Error Rates**: 4xx and 5xx responses
3. **Throughput**: Requests per second
4. **Cold Start**: Function initialization time
5. **Cost**: Per-function execution costs

### Validation Checklist Per Function
- [ ] API contract matches Express exactly
- [ ] Authentication works correctly
- [ ] Error responses match format
- [ ] Performance meets SLA
- [ ] Logging captures key events
- [ ] Monitoring alerts configured

## Communication Plan

### Stakeholder Updates
1. Weekly migration status reports
2. Domain completion announcements
3. Testing window notifications
4. Cutover scheduling
5. Post-migration reviews

### Documentation Updates
1. API documentation (Swagger)
2. Deployment guides
3. Troubleshooting guides
4. Architecture diagrams
5. Runbooks for operations