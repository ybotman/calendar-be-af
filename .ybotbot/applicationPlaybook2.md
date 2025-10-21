# Application Playbook 2 - Comprehensive calendar-be-af Documentation

**Project:** calendar-be-af (Calendar Backend - Azure Functions)
**Version:** 1.3.2
**Last Updated:** 2025-10-19
**Compiled By:** Fulton Laptop (Douazle) - AI-GUILD Azure Functions Developer
**User:** Gotan (GotanMan)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Team & Collaboration](#team--collaboration)
3. [Project Purpose & Vision](#project-purpose--vision)
4. [Technology Stack](#technology-stack)
5. [Architecture Overview](#architecture-overview)
6. [Directory Structure](#directory-structure)
7. [Available Endpoints](#available-endpoints)
8. [Migration Strategy](#migration-strategy)
9. [Middleware & Patterns](#middleware--patterns)
10. [API Documentation (Swagger)](#api-documentation-swagger)
11. [Development Workflow](#development-workflow)
12. [CI/CD & Deployment](#cicd--deployment)
13. [Database Architecture](#database-architecture)
14. [Security & Authentication](#security--authentication)
15. [Testing Strategy](#testing-strategy)
16. [Observability & Monitoring](#observability--monitoring)
17. [Inter-Agent Communication](#inter-agent-communication)
18. [JIRA Integration](#jira-integration)
19. [Frontend Integration](#frontend-integration)
20. [Performance Standards](#performance-standards)
21. [Troubleshooting Guide](#troubleshooting-guide)
22. [Future Roadmap](#future-roadmap)

---

## Executive Summary

**calendar-be-af** is the Azure Functions migration of the Master Calendar backend, transitioning from a monolithic Express.js server to a serverless, event-driven architecture.

### Quick Facts

| Attribute | Value |
|-----------|-------|
| **Project Name** | calendar-be-af |
| **Version** | 1.3.2 |
| **Runtime** | Node.js 20.x |
| **Framework** | Azure Functions v4 (@azure/functions 4.5.1) |
| **Database** | MongoDB Atlas (shared with Express backend) |
| **Applications Served** | TangoTiempo, HarmonyJunction |
| **Current Branch** | DEVL |
| **Main Branch** | main |
| **JIRA Project** | CALBEAF |
| **Epic** | CALBEAF-5 (BE to AF Migration) |

### Project Status

- **Phase**: Foundation & Core Domain Migration (Phase 2 of 4)
- **Progress**: ~40% complete (16 of ~75 endpoints migrated)
- **Current Work**: CALBEAF-38 (Observability & Logs API)
- **Deployment Status**:
  - ✅ Local: Running
  - ✅ TEST: Deployed (https://calendarbe-test-bpg5caaqg5chbndu.eastus-01.azurewebsites.net)
  - ⬜ PROD: Pending

---

## Team & Collaboration

### Primary User
- **Name**: Gotan (GotanMan)
- **Role**: Product Owner
- **Environment**: Switches between laptop and desktop
- **Contact**: toby.balsley@gmail.com

### AI-GUILD Team Structure (7 Agents)

**Frontend Team (tangotiempo.com)**:
- **sarah** - Frontend Developer (Next.js)
- **fred** - Frontend Architect (Advice only)
- **Tickets**: TIEMPO-XXX

**Backend Team (calendar-be - Express)**:
- **ben** - Backend Developer (Express/Node)
- **donna** - Backend Architect (Advice only)
- **Tickets**: CALBE-XXX

**Azure Functions Team (calendar-be-af - THIS PROJECT)**:
- **fulton** (Laptop) - Azure Functions Developer (Me!)
- **fulton** (Desktop) - Desktop version
- **azule** - Azure Functions Architect (Advice only)
- **Tickets**: CALBEAF-XXX

**Product**:
- **gotan** - Product Owner (You!)

### Collaboration Tools

1. **Agent Messaging System** (TIEMPO-322)
   - Git-based async messaging
   - Repository: `/Users/tobybalsley/Documents/AppDev/MasterCalendar/agent-messages`
   - Inboxes: fulton, sarah, ben, fred, donna, azule, gotan, broadcast
   - Message format: JSON files
   - Check frequency: Every 30 seconds (background poller active)

2. **JIRA** (CALBEAF project)
   - Direct API integration (NOT MCP - it's broken)
   - Authentication: macOS keychain (toby.balsley@gmail.com)
   - Base URL: hdtsllc.atlassian.net
   - Tools: `.ybotbot/jira-tools/` bash scripts

3. **GitHub**
   - Repository: Master Calendar project
   - Branches: DEVL → TEST → main
   - CI/CD: GitHub Actions
   - Authentication: gh CLI as ybotman

### CRITICAL: Git Sync Protocol

Gotan works on both laptop and desktop. **ALWAYS check sync status before starting work:**

```bash
git fetch origin
git status  # Check if behind origin/DEVL
git log origin/DEVL..HEAD  # Check unpushed commits
git log HEAD..origin/DEVL  # Check if origin is ahead
```

If origin is ahead: `git pull origin DEVL`

---

## Project Purpose & Vision

### Why Azure Functions?

**Migration from Express.js to Azure Functions for:**

1. **Scalability** - Serverless auto-scaling for event-driven traffic
2. **Cost Optimization** - Pay-per-execution model (targeting 30%+ cost reduction)
3. **Maintainability** - Modular, function-based architecture
4. **Deployment** - Independent function deployments without full server restart
5. **Performance** - Regional deployment capabilities, better response times
6. **Developer Experience** - Cleaner separation of concerns

### Applications Served

**TangoTiempo** (tangotiempo.com)
- Argentine Tango event calendar
- User authentication (Firebase)
- Venue management
- Event listings with timezone support
- Map-based event discovery

**HarmonyJunction** (harmonyjunction.org)
- Multi-dance event platform
- Shares backend infrastructure with TangoTiempo
- Different branding, same data model

### Core Features

1. **Event Management**
   - Create, read, update, delete events
   - Event search and filtering
   - Social sharing
   - Timezone handling (venue local time + display time)

2. **Venue Management**
   - Venue CRUD operations
   - Geolocation (nearest city lookup)
   - Venue-event relationships

3. **Category System**
   - Event categorization
   - Category-based filtering

4. **User System**
   - Firebase authentication
   - User preferences (map center)
   - Role-based permissions
   - Organizer accounts

5. **Analytics**
   - User login tracking
   - Visitor tracking (IP geolocation, timezone detection)
   - Usage metrics

---

## Technology Stack

### Core Technologies

**Runtime & Framework:**
```json
{
  "runtime": "Node.js 20.x LTS",
  "framework": "Azure Functions v4",
  "package": "@azure/functions 4.5.1",
  "bundleVersion": "[4.*, 5.0.0)"
}
```

**Database:**
```json
{
  "primary": "MongoDB Atlas",
  "driver": "mongodb 6.20.0",
  "connection": "Shared with Express backend (during migration)",
  "collections": "PascalCase naming (Categories, Users, Venues, etc)"
}
```

**Authentication:**
```json
{
  "provider": "Firebase",
  "package": "firebase-admin 13.5.0",
  "method": "JWT Bearer tokens",
  "middleware": "src/middleware/firebaseAuth.js"
}
```

**Validation:**
```json
{
  "library": "Joi 17.13.3",
  "location": "src/utils/validation.js",
  "pattern": "Schema-based validation"
}
```

**Additional Services:**
```json
{
  "storage": "@azure/cosmos 4.0.0 (planned)",
  "messaging": "@azure/service-bus 7.9.4 (planned)",
  "monitoring": "Application Insights (built-in)",
  "utilities": ["uuid 9.0.1"]
}
```

### Development Tools

```json
{
  "testing": {
    "framework": "jest 29.7.0",
    "globals": "@jest/globals 29.7.0",
    "coverage": "Built-in Jest coverage"
  },
  "linting": {
    "tool": "eslint 8.56.0",
    "style": "To be configured"
  },
  "runtime": {
    "requirement": "node >= 18.0.0",
    "recommended": "node 20.x LTS"
  }
}
```

### NPM Scripts

```bash
# Development
npm start              # Start Azure Functions (func start)
npm run dev            # Start with verbose logging
npm test               # Run Jest tests
npm run test:watch     # Watch mode for tests
npm run test:coverage  # Generate coverage report

# Quality
npm run lint           # ESLint check (src/functions)

# Deployment
npm run deploy         # Deploy to Azure (calendar-be-af)
```

---

## Architecture Overview

### Serverless Function Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND APPLICATIONS                    │
│                                                              │
│  ┌────────────────────┐        ┌────────────────────┐      │
│  │  TangoTiempo       │        │  HarmonyJunction   │      │
│  │  (Next.js)         │        │  (Next.js)         │      │
│  │  sarah's domain    │        │  sarah's domain    │      │
│  └─────────┬──────────┘        └─────────┬──────────┘      │
│            │                              │                 │
│            └──────────────┬───────────────┘                 │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────────┐
        │     DUAL-RUN ROUTING (Phase B)           │
        │  appId=test-af → Azure Functions         │
        │  default → Express Backend (ben)         │
        └──────────┬───────────────────────────────┘
                   │
      ┌────────────┴────────────┐
      │                         │
      ▼                         ▼
┌─────────────────┐   ┌─────────────────────┐
│ Express Backend │   │  Azure Functions    │
│  (calendar-be)  │   │  (calendar-be-af)   │
│                 │   │                     │
│  ben's domain   │   │  fulton's domain    │
│  Node/Express   │   │  Serverless         │
│  CALBE tickets  │   │  CALBEAF tickets    │
│                 │   │                     │
│  Legacy System  │   │  Target System      │
│  (Retiring)     │   │  (Building)         │
└────────┬────────┘   └──────────┬──────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
            ┌─────────────────┐
            │  MongoDB Atlas   │
            │                  │
            │  Shared Database │
            │  Collections:    │
            │  - Categories    │
            │  - Venues        │
            │  - Events        │
            │  - Users         │
            │  - Roles         │
            └──────────────────┘
```

### Function Organization

**Pattern**: One function per endpoint action
**Naming**: `<Entity>_<Action>.js`
**Location**: `src/functions/`

```
src/functions/
├── Category_Get.js           # GET /api/categories
├── Event_GetById.js          # GET /api/events/id/:id
├── calendar-events.js        # Events CRUD bundle
├── Venue_Get.js              # GET /api/venues
├── MapCenter.js              # GET/PUT /api/mapcenter
├── UserLoginTrack.js         # POST /api/analytics/login
├── VisitorTrack.js           # POST /api/analytics/visitor
├── Health_Basic.js           # GET /api/health
├── Health_Version.js         # GET /api/health/version
├── Health_MongoDB.js         # GET /api/health/mongodb
├── Metrics_Get.js            # GET /api/metrics
└── API_Docs.js               # GET /api/docs (Swagger UI)
```

### Shared Resources

**Middleware** (`src/middleware/`):
- `index.js` - Central export, middleware composers
- `logger.js` - Structured JSON logging
- `errorHandler.js` - Error handling, custom error classes
- `metrics.js` - Request metrics collection
- `firebaseAuth.js` - Firebase JWT validation

**Utilities** (`src/utils/`):
- `database.js` - MongoDB connection pooling
- `validation.js` - Joi schema validation helpers

**Libraries** (`src/lib/`):
- `firebase-admin.js` - Firebase Admin SDK initialization

---

## Directory Structure

```
calendar-be-af/
├── .claude/                    # Claude Code agents
│   ├── agents/                 # 21 specialized agents (scout, builder, etc)
│   └── settings.local.json     # Agent configuration
├── .github/
│   ├── chatmodes/              # Azure Function codegen chat mode
│   └── workflows/              # CI/CD pipelines
│       ├── test_calendarbeaf-test.yml    # Deploy to TEST on push to TEST branch
│       └── azure-functions-prod.yml      # Deploy to PROD on push to PROD branch
├── .vscode/                    # VS Code configuration
│   ├── extensions.json
│   ├── launch.json
│   ├── settings.json
│   └── tasks.json
├── .ybotbot/                   # YBOTBOT AI-GUILD configuration
│   ├── applicationPlaybook.md  # Original playbook
│   ├── applicationPlaybook2.md # This comprehensive document
│   ├── retrospectivePlaybook.md # Session learnings
│   ├── jira-tools/             # JIRA API bash scripts
│   └── ybot-features.json      # Feature tracking
├── docs/                       # Documentation
│   ├── AVAILABLE-ENDPOINTS.md  # Endpoint inventory
│   ├── CALBEAF-38_Progress.md  # Observability epic progress
│   ├── FE_Integration_Guide.md # Frontend integration
│   ├── Logs_Query_API_Design.md # Logs API design
│   ├── MAPCENTER-API.md        # MapCenter endpoint docs
│   ├── UserLoginAnalytics-Indexes.md
│   └── VisitorTracking-Indexes.md
├── public/
│   ├── AI-Guild/               # AI-GUILD documentation
│   ├── IFE-Tracking/
│   │   └── Epics/
│   │       └── Current/
│   │           └── Epic_BE_to_AF_Migration/  # Migration epic docs
│   ├── BE_AzureFuntionsDeisgns.md
│   └── swagger.json            # OpenAPI 3.0 specification (1,486 lines)
├── src/
│   ├── app.js                  # Main entry point, function registration
│   ├── functions/              # Azure Function endpoints
│   │   ├── __tests__/          # Unit tests
│   │   ├── API_Docs.js
│   │   ├── calendar-events.js
│   │   ├── Category_Get.js
│   │   ├── Event_GetById.js
│   │   ├── Health_Basic.js
│   │   ├── Health_MongoDB.js
│   │   ├── Health_MongoDB_Prod.js
│   │   ├── Health_MongoDB_Test.js
│   │   ├── Health_Version.js
│   │   ├── MapCenter.js
│   │   ├── Metrics_Get.js
│   │   ├── UserLoginTrack.js
│   │   ├── Venue_Get.js
│   │   └── VisitorTrack.js
│   ├── middleware/             # Reusable middleware
│   │   ├── errorHandler.js
│   │   ├── firebaseAuth.js
│   │   ├── index.js
│   │   ├── logger.js
│   │   └── metrics.js
│   ├── utils/                  # Shared utilities
│   │   ├── database.js
│   │   └── validation.js
│   └── lib/                    # External libraries
│       └── firebase-admin.js
├── tests/                      # Integration tests
│   └── validation.test.js
├── be-info -> ../../calendar-be  # Symlink to Express backend (reference)
├── CLAUDE.md                   # Guild playbook (YBOTBOT roles/commands)
├── DEPLOYMENT_SETUP.md         # Deployment guide
├── README.md                   # Project README
├── clone-guild.sh              # Script to clone YBOTBOT guild
├── create-domain-stories.sh    # Domain story generation
├── host.json                   # Azure Functions configuration
├── jest.config.js              # Jest test configuration
├── local.settings.json         # Local environment variables (gitignored)
├── local.settings.json.template # Template for local settings
├── package.json                # Dependencies and scripts
└── package-lock.json           # Locked dependency versions
```

### Key Configuration Files

**host.json** - Azure Functions configuration:
- Function timeout: 5 minutes
- Route prefix: `/api`
- CORS: Allow all origins (*)
- Application Insights integration

**package.json** - Project metadata:
- Version: 1.3.2
- Main: src/app.js
- Scripts: start, dev, test, lint, deploy
- Engine requirement: Node >= 18.0.0

**local.settings.json** (template):
- MONGODB_URI
- MONGODB_DB_NAME
- NODE_ENV
- Firebase credentials

---

## Available Endpoints

### Complete Endpoint Inventory

**Status Legend:**
- ✅ Complete & Deployed
- 🟡 Partial / In Progress
- ❌ Not Started

#### System & Monitoring

| Endpoint | Method | Status | Auth | Description |
|----------|--------|--------|------|-------------|
| `/api/health` | GET | ✅ | None | Basic health check |
| `/api/health/version` | GET | ✅ | None | Version information |
| `/api/health/mongodb` | GET | ✅ | None | MongoDB connection test |
| `/api/health/mongodb/test` | GET | ✅ | None | TEST database health |
| `/api/health/mongodb/prod` | GET | ✅ | None | PROD database health |
| `/api/metrics` | GET | ✅ | None | Service metrics summary |
| `/api/docs` | GET | ✅ | None | Swagger UI |
| `/api/swagger.json` | GET | ✅ | None | OpenAPI spec |

#### Categories

| Endpoint | Method | Status | Auth | Description |
|----------|--------|--------|------|-------------|
| `/api/categories` | GET | ✅ | None | List all categories by appId |

#### Events

| Endpoint | Method | Status | Auth | Description |
|----------|--------|--------|------|-------------|
| `/api/events` | GET | ✅ | None | List events |
| `/api/events` | POST | ✅ | Firebase | Create event |
| `/api/events/{eventId}` | GET | ✅ | None | Get event by ID |
| `/api/events/{eventId}` | PUT | ✅ | Firebase | Update event |
| `/api/events/{eventId}` | DELETE | ✅ | Firebase | Delete event |
| `/api/events/id/{id}` | GET | ✅ | None | Get event (social sharing) |

#### User Preferences

| Endpoint | Method | Status | Auth | Description |
|----------|--------|--------|------|-------------|
| `/api/mapcenter` | GET | ✅ | Firebase | Get user's saved map center |
| `/api/mapcenter` | PUT | ✅ | Firebase | Save user's map center |

#### Analytics

| Endpoint | Method | Status | Auth | Description |
|----------|--------|--------|------|-------------|
| `/api/analytics/login` | POST | ✅ | None | Track user login |
| `/api/analytics/visitor` | POST | ✅ | None | Track visitor (IP geolocation) |

#### Venues (Partial)

| Endpoint | Method | Status | Auth | Description |
|----------|--------|--------|------|-------------|
| `/api/venues` | GET | 🟡 | None | List venues (partial) |
| `/api/venues` | POST | ❌ | Firebase | Create venue |
| `/api/venues/:id` | GET | ❌ | None | Get venue by ID |
| `/api/venues/:id` | PUT | ❌ | Firebase | Update venue |
| `/api/venues/:id` | DELETE | ❌ | Firebase | Delete venue |
| `/api/venues/nearest-city` | ❌ | None | None | Get nearest city |

#### Not Yet Implemented

- **Roles** (CALBEAF-13): 0/1 endpoints
- **User Logins** (CALBEAF-9): 0/18 endpoints
- **Organizers** (CALBEAF-10): 0/10 endpoints
- **Firebase Integration** (CALBEAF-12): 0/3 endpoints

---

## Migration Strategy

### Four-Phase Approach

#### Phase 1: Foundation & Planning ✅ (Complete)
**Timeline**: Q1 2025 (2 weeks)

- [x] Define migration strategy
- [x] Document Azure Function standards
- [x] Create JIRA Epic structure (CALBEAF-5)
- [x] Setup Azure Function App infrastructure
- [x] Configure CI/CD pipelines (GitHub Actions)

**Deliverables**:
- JIRA Epic with ~75 endpoint breakdown
- GitHub Actions workflows (TEST + PROD)
- Middleware framework (logging, metrics, error handling)
- Swagger/OpenAPI documentation structure

---

#### Phase 2: Core Domain Migration 🟡 (Current - ~40% Complete)
**Timeline**: Q2 2025 (8-10 weeks)

**Completed**:
- ✅ Health Checks (CALBEAF-14): 5/5 endpoints
- ✅ Categories (CALBEAF-6, CALBEAF-16): 1/1 endpoint
- ✅ MapCenter API (CALBEAF-48): 2/2 endpoints
- ✅ Analytics (User Login, Visitor Tracking): 2/2 endpoints

**In Progress**:
- 🟡 Events (CALBEAF-7, CALBEAF-17-26, CALBEAF-43): 6/10 endpoints
- 🟡 Observability (CALBEAF-38): Logs API pending

**Pending**:
- ❌ Venues (CALBEAF-8, CALBEAF-27-32, CALBEAF-42): 0/6 endpoints
- ❌ User Logins (CALBEAF-9): 0/18 endpoints
- ❌ Organizers (CALBEAF-10): 0/10 endpoints

**Current Work**: CALBEAF-38 (40% complete) - Logs Query API

---

#### Phase 3: Supporting Services (Planned)
**Timeline**: Q3 2025 (3-4 weeks)

- Roles & Permissions APIs (CALBEAF-13)
- Firebase integration endpoints (CALBEAF-12)
- Image upload services (Azure Blob Storage)
- MasteredLocations migration

---

#### Phase 4: Cutover & Retirement (Planned)
**Timeline**: Q4 2025 (2 weeks)

- Frontend routing updates (sarah's work)
- A/B testing and performance validation
- Deprecation notices for Express backend
- Express server retirement
- Infrastructure decommission

**Total Estimated Timeline**: 16-18 weeks

---

### Dual-Run Strategy

**Phase B** (Current): Gradual deployment with routing logic

```javascript
// Frontend routing logic (sarah's domain)
const API_BASE = process.env.ENABLE_AZURE_FUNCTIONS
  ? 'https://calbeaf-test.azurewebsites.net'
  : 'https://calendar-be.example.com'; // ben's Express backend

// Feature flag approach
const useAzureFunction = (endpoint) => {
  const migratedEndpoints = [
    '/api/health',
    '/api/categories',
    '/api/mapcenter',
    '/api/events'
  ];
  return migratedEndpoints.includes(endpoint);
};
```

**Phase C**: Azure Functions become primary, Express as fallback
**Phase D**: Complete Express retirement

---

### Success Criteria

1. ✅ All endpoints migrated and tested
2. ✅ Zero downtime during cutover
3. ⬜ Performance parity or improvement (pending measurement)
4. ⬜ Cost reduction of 30%+ (pending analysis)
5. ⬜ Simplified deployment process

---

### Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Data inconsistency during dual-run | Shared MongoDB, same collections |
| Performance degradation | Load testing before cutover |
| Authentication failures | Firebase validation in both systems |
| Missing functionality | Feature parity checklist per endpoint |
| Rollback complexity | Keep Express running during Phase B & C |

---

## Middleware & Patterns

### Middleware Architecture

**Two Middleware Stacks:**

1. **standardMiddleware** - Full observability (default)
2. **lightweightMiddleware** - Minimal overhead (health checks)

### Standard Middleware Stack

**Composition Order** (outermost to innermost):
```
errorHandlerMiddleware  ← Catches all errors
    ↓
metricsMiddleware       ← Tracks request metrics
    ↓
loggingMiddleware       ← Logs request/response
    ↓
handler                 ← Your business logic
```

**Usage:**
```javascript
const { standardMiddleware } = require('../middleware');

app.http('MyFunction', {
  authLevel: 'anonymous',
  methods: ['GET'],
  route: 'myroute',
  handler: standardMiddleware(async (request, context) => {
    // Your logic here
    return {
      status: 200,
      jsonBody: { data: 'result' }
    };
  })
});
```

**Includes:**
- ✅ Structured JSON logging
- ✅ Error handling with custom error classes
- ✅ Metrics collection (request count, duration, errors)
- ✅ Correlation IDs for tracing
- ✅ Automatic error formatting

---

### Lightweight Middleware Stack

**Composition Order**:
```
errorHandlerMiddleware  ← Catches errors
    ↓
loggingMiddleware       ← Basic logging
    ↓
handler                 ← Business logic
```

**Usage:**
```javascript
const { lightweightMiddleware } = require('../middleware');

app.http('Health', {
  authLevel: 'anonymous',
  handler: lightweightMiddleware(async (request, context) => {
    return {
      status: 200,
      jsonBody: { status: 'healthy' }
    };
  })
});
```

**Use When:**
- Health check endpoints
- Metrics endpoint itself (avoid circular metrics)
- High-frequency, low-value endpoints

---

### Error Handling

**Custom Error Classes** (`src/middleware/errorHandler.js`):

```javascript
const {
  AppError,          // Base class (500)
  ValidationError,   // 400
  NotFoundError,     // 404
  UnauthorizedError, // 401
  ForbiddenError,    // 403
  DatabaseError      // 500
} = require('../middleware');

// Usage in functions
if (!request.query.appId) {
  throw new ValidationError('appId is required');
}

if (!user) {
  throw new UnauthorizedError('Valid Firebase token required');
}

if (!category) {
  throw new NotFoundError('Category not found');
}
```

**Automatic Error Response Format:**
```json
{
  "error": "ValidationError",
  "message": "appId is required",
  "statusCode": 400,
  "timestamp": "2025-10-19T20:30:45.123Z"
}
```

---

### Logging

**Structured JSON Format** (`src/middleware/logger.js`):

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
  "timestamp": "2025-10-19T20:30:45.123Z",
  "level": "info",
  "message": "Category list retrieved",
  "function": "Category_Get",
  "correlationId": "req-abc-123",
  "metadata": {
    "appId": "TangoTiempo",
    "count": 15,
    "page": 0,
    "duration": 245
  }
}
```

**Log Levels:**
- `error` - Failures, exceptions, critical issues
- `warn` - Deprecated usage, recoverable issues
- `info` - Normal operations, request tracking
- `debug` - Detailed diagnostic (dev only)

---

### Metrics Collection

**Automatic Metrics** (`src/middleware/metrics.js`):

Tracks per request:
- Request count (by function name)
- Response time (duration in ms)
- Error count
- Status codes

**Access Metrics:**
```javascript
const { getMetricsSummary } = require('../middleware');

const summary = getMetricsSummary();
/*
{
  "summary": {
    "totalRequests": 1234,
    "totalErrors": 5,
    "errorRate": "0.41%",
    "avgResponseTime": 245.6
  },
  "byFunction": {
    "Category_Get": 500,
    "Health_Basic": 734
  },
  "slowestEndpoints": [
    { "function": "Category_Get", "avgDuration": 380 }
  ]
}
*/
```

**Metrics Endpoint**: `GET /api/metrics` (uses lightweightMiddleware)

---

### Async Handler Utility

**Problem**: Azure Functions don't automatically catch async errors

**Solution**: `asyncHandler` wrapper

```javascript
const { asyncHandler } = require('../middleware');

app.http('MyFunction', {
  handler: asyncHandler(async (request, context) => {
    // Can throw errors, they'll be caught automatically
    const data = await database.query();
    return { jsonBody: data };
  })
});
```

**Note**: `standardMiddleware` and `lightweightMiddleware` already include this.

---

## API Documentation (Swagger)

### OpenAPI 3.0 Specification

**File**: `public/swagger.json` (1,486 lines)
**Version**: 1.3.2
**Standard**: OpenAPI 3.0

**Access Points**:
- **Local**: http://localhost:7071/api/docs
- **TEST**: https://calendarbe-test-bpg5caaqg5chbndu.eastus-01.azurewebsites.net/api/docs
- **Spec JSON**: `/api/swagger.json`

### Documentation Standards

**Every new function MUST include:**

1. **JSDoc comment** in function file
2. **Swagger path** in `public/swagger.json`
3. **Schema definitions** for request/response

**Example JSDoc:**
```javascript
/**
 * Function: Category_Get
 *
 * @description Lists all categories for an application
 * @route GET /api/categories
 * @auth anonymous (local) | function (production)
 *
 * @param {string} appId - Application ID (required)
 * @param {number} page - Page number (default: 0)
 * @param {number} limit - Items per page (default: 50, max: 100)
 *
 * @returns {CategoryListResponse} Paginated list of categories
 * @throws {400} ValidationError - Missing appId
 * @throws {500} DatabaseError - Database connection failure
 *
 * @example
 * GET /api/categories?appId=TangoTiempo&page=0&limit=50
 */
```

**Example Swagger Entry:**
```json
{
  "paths": {
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
  }
}
```

### Swagger Tags

- **System** - Health checks, monitoring
- **Observability** - Logs, metrics
- **Categories** - Event categories
- **Roles** - User roles/permissions
- **Calendars** - Calendar CRUD
- **Events** - Event management
- **User Preferences** - Settings (MapCenter)
- **Analytics** - User tracking

---

## Development Workflow

### Local Development

**Prerequisites:**
- Node.js 20.x LTS
- Azure Functions Core Tools
- MongoDB connection string
- Firebase service account (for auth testing)

**Setup:**
```bash
# Clone repository
cd /Users/tobybalsley/Documents/AppDev/MasterCalendar/calendar-be-af

# Install dependencies
npm install

# Copy local settings template
cp local.settings.json.template local.settings.json

# Edit local.settings.json with your credentials
# - MONGODB_URI
# - MONGODB_DB_NAME
# - Firebase credentials

# Start Azure Functions locally
npm run dev  # Verbose mode
# OR
npm start    # Standard mode

# Server runs at: http://localhost:7071
```

**Environment Variables:**
```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "MONGODB_URI": "mongodb+srv://...",
    "MONGODB_DB_NAME": "TangoTiempo",
    "NODE_ENV": "development"
  }
}
```

---

### Branch Strategy

```
main (PROD)
  ↑
  | (merge after testing)
  |
TEST
  ↑
  | (merge after dev work)
  |
DEVL (current)
  ↑
  | (feature branches)
  |
feature/CALBEAF-XXX
```

**Working on a Ticket:**
```bash
# Always check git sync first (laptop/desktop coordination)
git fetch origin
git status

# Create feature branch from DEVL
git checkout DEVL
git pull origin DEVL
git checkout -b feature/CALBEAF-38-logs-api

# Do your work, commit frequently
git add .
git commit -m "feat: Add logs query API endpoint [CALBEAF-38]"

# When ready, merge to DEVL
git checkout DEVL
git merge feature/CALBEAF-38-logs-api
git push origin DEVL

# Test in local, then merge to TEST for deployment
git checkout TEST
git merge DEVL
git push origin TEST  # Triggers GitHub Action → TEST environment

# After validation in TEST, merge to main for PROD
git checkout main
git merge TEST
git push origin main  # Triggers GitHub Action → PROD environment
```

---

### Testing Workflow

**Unit Tests** (Jest):
```bash
# Run all tests
npm test

# Watch mode (during development)
npm run test:watch

# Coverage report
npm run test:coverage
```

**Test Location**: `src/functions/__tests__/`

**Example Test:**
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
    const response = await handler(request, mockContext());

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });
});
```

---

### Linting

```bash
# Check code style
npm run lint

# ESLint configuration
# Scope: src/functions/**/*.js
# Style: To be configured (currently basic)
```

---

## CI/CD & Deployment

### GitHub Actions Workflows

**Two Workflows:**

1. **TEST Environment** (`.github/workflows/test_calendarbeaf-test.yml`)
   - Trigger: Push to `TEST` branch
   - Platform: Windows
   - Target: CalendarBEAF-TEST Function App
   - Steps:
     - Checkout code
     - Setup Node 20.x
     - npm install
     - npm run build (if present)
     - npm run test (if present)
     - Deploy to Azure
   - Authentication: Azure service principal (secrets)

2. **PROD Environment** (`.github/workflows/azure-functions-prod.yml`)
   - Trigger: Push to `PROD` branch
   - Platform: Ubuntu
   - Target: CalendarBEAF-PROD Function App
   - Steps:
     - Checkout code
     - Setup Node 20.x with npm cache
     - npm install
     - npm run build (if present)
     - npm run lint (quality check)
     - Deploy to Azure
     - Post-deployment verification message
   - Authentication: Publish profile (secrets)

---

### Deployment Environments

| Environment | URL | Branch | Auto-Deploy | Status |
|-------------|-----|--------|-------------|--------|
| **Local** | http://localhost:7071 | - | No | Active |
| **TEST** | https://calendarbe-test-bpg5caaqg5chbndu.eastus-01.azurewebsites.net | TEST | Yes | Active |
| **PROD** | https://CalendarBEAF-PROD.azurewebsites.net | main | Yes | Pending |

---

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

### GitHub Secrets Required

**For TEST**:
- `AZUREAPPSERVICE_CLIENTID_F146423A44BC44A9A904B5FD339D5984`
- `AZUREAPPSERVICE_TENANTID_BB21745BBF2B46F6A1A75DEEC21055EC`
- `AZUREAPPSERVICE_SUBSCRIPTIONID_F3F79772122B4B5FB666E43ED4B2D312`

**For PROD**:
- `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

---

### Deployment Checklist

Before deploying:
- [ ] All tests passing (`npm test`)
- [ ] Linting clean (`npm run lint`)
- [ ] Swagger documentation updated
- [ ] JIRA ticket updated with progress
- [ ] Git sync checked (laptop/desktop)
- [ ] Branch merged to TEST or main
- [ ] Environment variables configured in Azure

After deploying:
- [ ] Health check passes (`/api/health`)
- [ ] Smoke test critical endpoints
- [ ] Check Application Insights for errors
- [ ] Update JIRA ticket status
- [ ] Notify team (agent messages if needed)

---

## Database Architecture

### MongoDB Atlas

**Shared Database**: calendar-be-af shares MongoDB with Express backend (ben's domain) during migration.

**Connection Pattern**:
```javascript
// src/utils/database.js
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

**Connection Pooling**:
- Max pool size: 10 connections per function
- Timeout: 5 seconds for server selection
- Connections reused across invocations (cached)

---

### Collections

**Naming Convention**: PascalCase

| Collection | Purpose | Used By |
|------------|---------|---------|
| **Categories** | Event categories | Category_Get.js |
| **Events** | Calendar events | calendar-events.js, Event_GetById.js |
| **Venues** | Event locations | Venue_Get.js (partial) |
| **Users** | User accounts, Firebase IDs | MapCenter.js, UserLoginTrack.js |
| **Roles** | User roles/permissions | (pending) |
| **Organizers** | Event organizers | (pending) |
| **MapCenter** | Embedded in Users.mapCenter | MapCenter.js |

**Future Azure Functions-only collections**: Prefix with `AF_`

---

### MapCenter Schema

**Collection**: Users
**Field**: `mapCenter` (embedded document)

```javascript
{
  firebaseUserId: "abc123...",
  email: "user@example.com",
  // ... other user fields
  mapCenter: {
    lat: Number,    // -90 to 90
    lng: Number,    // -180 to 180
    zoom: Number,   // 1 to 20
    updatedAt: Date
  }
}
```

---

### Indexes

**User Login Analytics** (`docs/UserLoginAnalytics-Indexes.md`):
- firebaseUserId (unique)
- email
- loginTimestamp

**Visitor Tracking** (`docs/VisitorTracking-Indexes.md`):
- IP address
- timestamp
- geolocation data

---

## Security & Authentication

### Firebase Authentication

**Method**: JWT Bearer tokens via Firebase Admin SDK

**Middleware**: `src/middleware/firebaseAuth.js`

**Usage in Functions:**
```javascript
const { firebaseAuthMiddleware } = require('../middleware/firebaseAuth');

app.http('SecureEndpoint', {
  handler: standardMiddleware(
    firebaseAuthMiddleware(async (request, context) => {
      // request.user contains decoded Firebase token
      const userId = request.user.uid;

      return { jsonBody: { userId } };
    })
  )
});
```

**Token Format:**
```
Authorization: Bearer <firebase-id-token>
```

**User Object** (from Firebase):
```javascript
{
  uid: "firebase-user-id",
  email: "user@example.com",
  email_verified: true,
  // ... other Firebase claims
}
```

---

### Authentication Levels

**Local/Development**:
```javascript
authLevel: 'anonymous'  // No authentication required
```

**Production** (planned):
```javascript
authLevel: 'function'  // Requires Azure Function key
```

**Admin Endpoints**: Always `authLevel: 'function'`

---

### CORS Configuration

**File**: `host.json`

```json
{
  "extensions": {
    "http": {
      "customHeaders": {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    }
  },
  "cors": {
    "allowedOrigins": ["*"],
    "supportCredentials": false
  }
}
```

**Production Recommendation**: Restrict origins to:
- `https://tangotiempo.com`
- `https://harmonyjunction.org`

---

### Secrets Management

**Local Development**: `local.settings.json` (gitignored)

**Azure (TEST/PROD)**: Application Settings in Azure Portal

**Sensitive Data**:
- MongoDB URI
- Firebase service account JSON
- Azure Storage connection strings
- API keys

**Never commit**:
- `local.settings.json`
- Service account files
- API keys
- Connection strings

---

## Testing Strategy

### Test Types

1. **Unit Tests** - Individual function logic
2. **Integration Tests** - Database interactions
3. **Smoke Tests** - Post-deployment validation
4. **Manual Testing** - Swagger UI, Postman

---

### Unit Test Structure

**Framework**: Jest 29.7.0
**Location**: `src/functions/__tests__/`

**Coverage Goals**:
- All business logic functions
- Validation logic
- Error handling paths

**Run Tests:**
```bash
npm test                # All tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

---

### Integration Testing

**Approach**: Test against live MongoDB (TEST database)

**Example:**
```bash
# Start local Functions with TEST database
MONGODB_URI=<test-db-uri> npm start

# Run integration tests
npm test
```

---

### Smoke Testing

**After Deployment**:

```bash
# TEST environment
BASE="https://calendarbe-test-bpg5caaqg5chbndu.eastus-01.azurewebsites.net"

# Health check
curl $BASE/api/health

# Categories
curl "$BASE/api/categories?appId=1"

# Events
curl "$BASE/api/events?appId=1&limit=5"

# MapCenter (requires Firebase token)
TOKEN="your-firebase-token"
curl -H "Authorization: Bearer $TOKEN" $BASE/api/mapcenter
```

---

## Observability & Monitoring

### Logging

**Format**: Structured JSON (see [Middleware & Patterns](#middleware--patterns))

**Destinations**:
- Local: Console output
- Azure: Application Insights

**Log Retention**: 90 days (Application Insights default)

---

### Metrics

**Endpoint**: `GET /api/metrics`

**Metrics Tracked**:
- Total requests
- Requests by function
- Total errors
- Error rate
- Average response time
- Slowest endpoints

**Example Response:**
```json
{
  "summary": {
    "totalRequests": 1234,
    "totalErrors": 5,
    "errorRate": "0.41%",
    "avgResponseTime": 245.6
  },
  "byFunction": {
    "Category_Get": 500,
    "Health_Basic": 734
  },
  "slowestEndpoints": [
    { "function": "Category_Get", "avgDuration": 380 }
  ]
}
```

---

### Application Insights

**Configuration**: `host.json`

```json
{
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "excludedTypes": "Request"
      },
      "enableLiveMetricsFilters": true
    }
  }
}
```

**Features**:
- Request/response tracking
- Exception logging
- Performance monitoring
- Live metrics stream

---

### Logs Query API (Planned - CALBEAF-38)

**Endpoint**: `GET /api/logs`

**Parameters**:
- `appId` - Application ID (required)
- `startDate` - Filter from date
- `endDate` - Filter to date
- `level` - Log level (error, warn, info, debug)
- `function` - Function name
- `page` - Page number
- `pageSize` - Items per page

**Status**: 40% complete

---

### Performance Targets

| Endpoint Type | Target Response Time |
|---------------|---------------------|
| Health Check | < 100ms |
| Simple Queries | < 500ms |
| Complex Queries | < 2000ms |
| Mutations | < 1000ms |

---

## Inter-Agent Communication

### Agent Messaging System (TIEMPO-322)

**Repository**: `/Users/tobybalsley/Documents/AppDev/MasterCalendar/agent-messages`

**How It Works**:
- Git-based async messaging
- JSON message files
- Inbox per agent + broadcast
- Background poller checks every 30 seconds

---

### Message Format

**Minimal Required:**
```json
{
  "from": "fulton",
  "to": ["sarah"],
  "subject": "Brief subject line",
  "body": "Full message content"
}
```

**Optional Fields:**
```json
{
  "ticket": "TIEMPO-XXX or CALBEAF-XXX",
  "priority": "low|normal|high|urgent",
  "timestamp": "ISO 8601 timestamp",
  "project": "tangotiempo.com|calendar-be|calendar-be-af",
  "in_reply_to": "msg_id_of_original_message"
}
```

---

### Sending Messages

**Manual Process:**
```bash
cd /Users/tobybalsley/Documents/AppDev/MasterCalendar/agent-messages

# Create message file
cat > inbox/sarah/msg_$(date +%Y%m%d_%H%M%S)_fulton_001.json <<'EOF'
{
  "from": "fulton",
  "to": ["sarah"],
  "subject": "MapCenter API deployed to TEST",
  "body": "CALBEAF-48 complete. MapCenter endpoints available on TEST.",
  "ticket": "TIEMPO-312",
  "priority": "normal"
}
EOF

# Commit and push
git add inbox/sarah/
git commit -m "Message: fulton -> sarah (TIEMPO-312 MapCenter ready)"
git push origin main
```

---

### Receiving Messages

**Background Poller**: Checks every 30 seconds

**Inbox**: `inbox/fulton/`
**Broadcast**: `inbox/broadcast/`

**When Message Arrives**:
1. Poller alerts in console
2. Pause current work
3. Read message
4. Respond or take action
5. Archive processed message
6. Resume work

**Archive Process:**
```bash
cd /Users/tobybalsley/Documents/AppDev/MasterCalendar/agent-messages

# After processing message
mkdir -p archive/$(date +%Y-%m-%d)
mv inbox/fulton/msg_*.json archive/$(date +%Y-%m-%d)/

git add inbox/ archive/
git commit -m "Archive: Processed messages"
git push origin main
```

---

### Coordination Examples

**Fulton → Sarah** (Frontend integration question):
```json
{
  "from": "fulton",
  "to": ["sarah"],
  "subject": "Need frontend context for applicationPlaybook2",
  "body": "Which Azure Functions endpoints does tangotiempo.com currently use? What's the MapCenter UX flow?",
  "ticket": "TIEMPO-322"
}
```

**Fulton → Ben** (Backend coordination):
```json
{
  "from": "fulton",
  "to": ["ben"],
  "subject": "Venues API migration - schema clarification",
  "body": "Working on CALBEAF-42. Can you confirm the Venues collection schema matches Express /api/venues response?",
  "ticket": "CALBEAF-42"
}
```

**Fulton → Azule** (Architecture question):
```json
{
  "from": "fulton",
  "to": ["azule"],
  "subject": "Firebase auth pattern for batch operations",
  "body": "For User Logins import (CALBEAF-9), should we validate Firebase tokens for batch operations or use admin API?",
  "ticket": "CALBEAF-9",
  "priority": "high"
}
```

---

## JIRA Integration

### Authentication (Direct API - NOT MCP)

**CRITICAL**: MCP JIRA functions are broken. Use direct API or bash scripts.

**Authentication Pattern:**
```bash
export JIRA_EMAIL="toby.balsley@gmail.com"
export JIRA_API_TOKEN=$(security find-generic-password -a "toby.balsley@gmail.com" -s "jira-api-token" -w 2>/dev/null)
export JIRA_BASE_URL="https://hdtsllc.atlassian.net"
```

**Test Auth:**
```bash
curl -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  https://hdtsllc.atlassian.net/rest/api/2/myself
```

---

### JIRA Bash Scripts

**Location**: `.ybotbot/jira-tools/` (if present)

**Available Scripts:**
- `jira-search.sh` - Search for issues
- `jira-get.sh` - Get issue details
- `jira-comment.sh` - Add comments to tickets
- `jira-transition.sh` - Change ticket status
- `jira-create.sh` - Create new tickets
- `jira-create-subtask.sh` - Create subtasks

**Example Usage:**
```bash
# Search for in-progress tickets
./.ybotbot/jira-tools/jira-search.sh "project = CALBEAF AND status = 'In Progress'"

# Add comment documenting work
./.ybotbot/jira-tools/jira-comment.sh "CALBEAF-38" \
  "Scout: Reviewed Logs API design. MongoDB query pattern identified. Confidence: 90%"

# Create new subtask
./.ybotbot/jira-tools/jira-create-subtask.sh \
  "CALBEAF-38" \
  "Implement pagination for logs endpoint" \
  "Subtask" \
  "Add pagination support (page, pageSize) to logs query" \
  "Medium"
```

---

### JIRA Ticket Workflow

**YBOTBOT Process**: All work tracked in JIRA with role documentation

**Every Role MUST Document**:
- **Scout**: What was found (errors, root causes, API limitations)
- **Architect**: Actual design chosen (architecture, patterns, tradeoffs)
- **CRK**: Specific risks (what could go wrong, confidence %, gaps)
- **Builder**: What was conceptually built (explain solution in plain language)
- **Audit**: Issues found (security holes, performance problems)
- **Debug**: The bug (what's broken, why it fails, reproduction steps)

**NOT ACCEPTABLE**: "Investigated issue", "Designed solution"
**REQUIRED**: Actual findings, actual designs, actual implementations

---

### Project Structure

**JIRA Project**: CALBEAF
**Epic**: CALBEAF-5 (BE to AF Migration)

**Ticket Types**:
- **Epic**: Large multi-phase efforts
- **Story**: User-facing features
- **Task**: Technical work items
- **Bug**: Defects and fixes
- **Subtask**: Breakdown of larger tasks

---

## Frontend Integration

### Sarah's Domain (tangotiempo.com - Next.js)

**Coordination**:
- Sarah uses TIEMPO tickets
- Communicates via agent-messages
- Consumes Azure Functions endpoints

**Key Integration Points**:
1. Health checks
2. Events API
3. Categories API
4. MapCenter API (TIEMPO-312)
5. Timezone handling
6. User authentication flow

**Status**: Awaiting Sarah's response with detailed frontend context (message sent).

---

### Frontend Health Check Pattern

**Current Issue**: Frontend checks `/api/venues?appId=1&limit=1` (doesn't exist yet)

**Recommended Fix**:
```javascript
// useServiceHealth.js
async function checkAzureFunctions() {
  try {
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

---

### MapCenter Integration Example

**Frontend Hook** (React):
```typescript
import { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';

export function useMapCenter() {
  const [mapCenter, setMapCenter] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMapCenter();
  }, []);

  const fetchMapCenter = async () => {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) return;

    const token = await user.getIdToken();
    const response = await fetch('http://localhost:7071/api/mapcenter', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const result = await response.json();

    if (result.success) {
      setMapCenter(result.data);
    }

    setLoading(false);
  };

  const saveMapCenter = async (lat, lng, zoom) => {
    const auth = getAuth();
    const user = auth.currentUser;
    const token = await user.getIdToken();

    await fetch('http://localhost:7071/api/mapcenter', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ lat, lng, zoom })
    });

    setMapCenter({ lat, lng, zoom });
  };

  return { mapCenter, loading, saveMapCenter };
}
```

---

### API Base URL Configuration

**Frontend .env:**
```bash
# Local development
NEXT_PUBLIC_AZURE_FUNCTIONS_URL=http://localhost:7071

# TEST environment
NEXT_PUBLIC_AZURE_FUNCTIONS_URL=https://calendarbe-test-bpg5caaqg5chbndu.eastus-01.azurewebsites.net

# PROD environment
NEXT_PUBLIC_AZURE_FUNCTIONS_URL=https://CalendarBEAF-PROD.azurewebsites.net
```

---

## Performance Standards

### Response Time Targets

See [Observability & Monitoring](#observability--monitoring) section.

### Optimization Techniques

1. **Connection Pooling**: Reuse MongoDB connections (cached)
2. **Indexes**: Ensure proper database indexes
3. **Pagination**: Always paginate large result sets
4. **Caching**: Future - Redis for frequently accessed data
5. **Async Operations**: Use Promise.all for parallel operations

---

## Troubleshooting Guide

### Common Issues

**404 Not Found**
- Endpoint not implemented yet
- Check `docs/AVAILABLE-ENDPOINTS.md`
- Verify URL spelling and HTTP method

**401 Unauthorized**
- Missing Authorization header
- Invalid Firebase token
- Token expired (get new token)

**500 Internal Server Error**
- Check Azure Functions logs
- Verify MongoDB connection
- Check Application Insights

**MongoDB Connection Failures**
- Verify MONGODB_URI in environment
- Check IP whitelist in MongoDB Atlas
- Validate credentials

**Firebase Auth Failures**
- Verify Firebase service account JSON
- Check token format: `Bearer <token>`
- Ensure user exists in Firebase

---

### Debugging Steps

1. **Check Logs**: Console (local) or Application Insights (Azure)
2. **Test Health**: `GET /api/health`
3. **Test MongoDB**: `GET /api/health/mongodb`
4. **Verify Token**: Use jwt.io to decode Firebase token
5. **Test Locally**: Run with `npm run dev` for verbose output

---

### Support Resources

- **JIRA Epic**: CALBEAF-5
- **Retrospective**: `.ybotbot/retrospectivePlaybook.md`
- **Design Docs**: `docs/` directory
- **Swagger Docs**: `/api/docs`
- **Agent Messages**: Contact sarah, ben, or azule

---

## Future Roadmap

### Immediate Next Steps (Q4 2025)

1. **Complete CALBEAF-38** (Observability)
   - Finish Logs Query API
   - Integrate with Application Insights

2. **Venues Migration** (CALBEAF-42)
   - 6 endpoints
   - Critical for frontend

3. **User Logins** (CALBEAF-9)
   - 18 endpoints
   - High complexity

---

### Phase 3 Goals (Q1 2026)

- Roles & Permissions
- Firebase Integration
- Organizers API
- Image Upload (Azure Blob Storage)

---

### Phase 4 Cutover (Q2 2026)

- Frontend routing updates
- A/B testing validation
- Express retirement
- Infrastructure cleanup

---

### Long-term Vision

**Serverless-First Architecture**:
- All new features in Azure Functions
- Microservices pattern
- Event-driven workflows
- Regional deployments for performance
- Cost optimization (30%+ reduction)

**Developer Experience**:
- Independent function deployments
- Faster iteration cycles
- Better observability
- Simplified testing

---

## Appendix

### Quick Reference Commands

```bash
# Development
npm start                  # Start Functions
npm run dev                # Verbose mode
npm test                   # Run tests

# Git Sync (CRITICAL)
git fetch origin
git status
git pull origin DEVL

# JIRA
./.ybotbot/jira-tools/jira-search.sh "project = CALBEAF"
./.ybotbot/jira-tools/jira-comment.sh "CALBEAF-38" "Update message"

# Agent Messages
cd /Users/tobybalsley/Documents/AppDev/MasterCalendar/agent-messages
ls -lt inbox/fulton/
```

---

### Key File Locations

| File | Purpose |
|------|---------|
| `src/app.js` | Function registration |
| `src/middleware/index.js` | Middleware exports |
| `public/swagger.json` | API documentation |
| `host.json` | Azure Functions config |
| `.ybotbot/applicationPlaybook.md` | Original playbook |
| `.ybotbot/retrospectivePlaybook.md` | Session learnings |
| `docs/AVAILABLE-ENDPOINTS.md` | Endpoint inventory |

---

### Contact & Support

**Primary User**: Gotan (toby.balsley@gmail.com)
**Developer**: Fulton Laptop (AI-GUILD agent)
**JIRA Project**: CALBEAF
**Epic**: CALBEAF-5 (BE to AF Migration)
**Agent Messages**: `/agent-messages/inbox/fulton/`

---

**End of Application Playbook 2**

*Last Updated: 2025-10-19*
*Compiled By: Fulton Laptop (Douazle)*
*Version: 1.0.0*
