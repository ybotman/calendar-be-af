# EPIC: Backend to Azure Functions Migration

> **IFE Epic Document**  
> Complete migration of TangoTiempo/MasterCalendar backend from Express.js to Azure Functions

## 🗂️ KANBAN (Required)
**Last updated:** 2025-06-16

### Phase 1: Foundation & Planning
- [x] Define migration strategy and phases
- [x] Document Azure Function standards
- [x] Create JIRA Epic structure
- [ ] Setup Azure Function App infrastructure (TEST/PROD)
- [ ] Configure CI/CD pipelines

### Phase 2: Core Domain Migration
- [ ] Categories API migration
- [ ] Events API migration
- [ ] Venues API migration
- [ ] Organizers API migration
- [ ] UserLogins API migration
- [ ] MasteredLocations API migration

### Phase 3: Supporting Services
- [ ] Roles & Permissions APIs
- [ ] Firebase integration endpoints
- [ ] Health Check endpoints
- [ ] Image upload services (Azure Blob)

### Phase 4: Cutover & Retirement
- [ ] Frontend routing updates
- [ ] Deprecation notices
- [ ] Express server retirement
- [ ] Infrastructure decommission

## 🧭 SCOUT (Required)
**Last updated:** 2025-06-16

### Current State Analysis
- **Backend Type**: Express.js monolithic server
- **Database**: MongoDB Atlas
- **Authentication**: Firebase JWT tokens
- **File Storage**: Azure Blob Storage (partially implemented)
- **Domains**: 11 major API domains identified
- **Endpoints**: ~75 individual API endpoints
- **Current AF Progress**: Only Category_Get.js is WIP

### Key Findings
1. Most endpoints lack proper authentication
2. Pagination is inconsistent across domains
3. Rate limiting is applied globally
4. Azure Storage integration exists but underutilized
5. Locations API is deprecated (migrated to Venues)

## 🏛️ ARCHITECT (Required)
**Last updated:** 2025-06-16

### Migration Architecture

#### Phased Approach
1. **Phase A - Legacy**: All traffic via Express (current state)
2. **Phase B - Dual Run**: Gradual function deployment with `appId=test-af` routing
3. **Phase C - Cutover**: Azure Functions become primary, Express as fallback
4. **Phase D - Retire**: Complete Express retirement

#### Technical Architecture
```
┌─────────────────┐     ┌─────────────────┐
│   Frontend      │     │   Frontend      │
│  (React/Next)   │     │  (React/Next)   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │ Phase A-B             │ Phase C-D
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  Express Server │     │ Azure Functions │
│   (Retiring)    │     │   (Primary)     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
            ┌─────────────────┐
            │   MongoDB Atlas  │
            └─────────────────┘
```

#### Function Naming Convention
- Pattern: `<Entity>_<Action>.js`
- Location: `src/functions/`
- Examples:
  - `Event_Get.js`, `Event_List.js`, `Event_Create.js`
  - `Venue_Get.js`, `Venue_Update.js`, `Venue_Delete.js`

#### Shared Resources Strategy
- Database models: Reuse existing Mongoose schemas
- Middleware: Port authentication, validation, rate limiting
- Utils: Share loggers, formatters, helpers
- Config: Centralized environment management

## 🛠️ BUILDER (Required)
**Last updated:** 2025-06-16

- Design document created
- JIRA structure planned
- Migration phases defined

---

## Summary
Complete migration of ~75 API endpoints across 11 domains from Express.js monolithic backend to Azure Functions serverless architecture, maintaining backward compatibility during transition.

## Motivation
- **Scalability**: Serverless auto-scaling for event-driven load
- **Cost Optimization**: Pay-per-execution model
- **Maintainability**: Modular function-based architecture
- **Deployment**: Independent function deployments
- **Performance**: Regional deployment capabilities

## Scope
### In-Scope
- All REST API endpoints from Express server
- Authentication/authorization middleware
- Database connections and models
- Rate limiting and security
- Image upload functionality
- Health checks and monitoring

### Out-of-Scope
- Frontend application changes (except routing updates)
- Database schema modifications
- Business logic changes
- New features during migration

## Epic Structure

### Story Breakdown by Domain

1. **Categories Domain** (5 endpoints)
   - GET /api/categories
   
2. **Events Domain** (10 endpoints)
   - GET /api/events
   - GET /api/events/all
   - GET /api/events/byMasteredLocations
   - GET /api/events/byRegionAndCategory
   - GET /api/events/id/:id
   - GET /api/events/owner/:ownerId
   - POST /api/events/post
   - PUT /api/events/:eventId
   - DELETE /api/events/:eventId
   - POST /api/events/upload-image

3. **Venues Domain** (6 endpoints)
   - GET /api/venues
   - POST /api/venues
   - GET /api/venues/nearest-city
   - GET /api/venues/:id
   - PUT /api/venues/:id
   - DELETE /api/venues/:id

4. **Organizers Domain** (10 endpoints)
   - GET /api/organizers
   - GET /api/organizers/all
   - GET /api/organizers/:id
   - POST /api/organizers
   - PUT /api/organizers/:id
   - DELETE /api/organizers/:id
   - PUT /api/organizers/:id/add-image
   - PATCH /api/organizers/:id/connect-user
   - PATCH /api/organizers/:id/disconnect-user
   - POST /api/organizers/generate-sas-token

5. **UserLogins Domain** (18 endpoints)
   - GET /api/userlogins/all
   - GET /api/userlogins/active
   - GET /api/userlogins/firebase/:firebaseId
   - PUT /api/userlogins/firebase/:firebaseId
   - POST /api/userlogins
   - PUT /api/userlogins/updateUserInfo
   - PUT /api/userlogins/:firebaseId/roles
   - PUT /api/userlogins/:firebaseId/alternate-ids
   - GET /api/userlogins/find-by-any-id/:firebaseId
   - GET /api/userlogins/debug/userInfo
   - POST /api/userlogins/activate-organizer
   - POST /api/userlogins/fix/regional-organizer
   - POST /api/userlogins/import-firebase
   - POST /api/userlogins/fix/user-by-id
   - POST /api/userlogins/fix/oversized-documents
   - POST /api/userlogins/ensure-default-role

6. **MasteredLocations Domain** (6 endpoints)
   - GET /api/mastered-locations/nearestMastered
   - GET /api/mastered-locations/countries
   - GET /api/mastered-locations/regions
   - GET /api/mastered-locations/divisions
   - GET /api/mastered-locations/cities
   - GET /api/mastered-locations/all

7. **Firebase Integration** (3 endpoints)
   - POST /api/firebase/fetchAndStoreUser
   - GET /api/firebase/geo/ip
   - GET /api/firebase/users

8. **Roles Domain** (1 endpoint)
   - GET /api/roles

9. **Health Check Domain** (5 endpoints)
   - GET /api/health
   - GET /api/health/detailed
   - GET /api/health/version
   - GET /api/health/storage-test
   - GET /api/health/versions

10. **Legacy Regions API** (7 endpoints) - Lower Priority
    - GET /api/regions
    - GET /api/regions/activeRegions
    - GET /api/regions/activeDivisions
    - GET /api/regions/activeCities
    - PUT /api/regions/region/:regionId/active
    - PUT /api/regions/region/:regionId/division/:divisionId/active
    - PUT /api/regions/region/:regionId/division/:divisionId/city/:cityId/active

## Technical Requirements

### Azure Functions Configuration
- Runtime: Azure Functions v4
- Node.js: v20 LTS
- Trigger Type: HTTP
- Authentication: Function-level keys + JWT validation
- Hosting Plan: Consumption (Y1)

### Development Standards
- ESLint configuration (Airbnb style)
- Unit test coverage (Jest)
- Integration tests (Postman collections)
- API documentation (OpenAPI/Swagger)

### Environment Management
- local.settings.json (development)
- Azure App Settings (TEST/PROD)
- Key Vault for sensitive data

## Success Criteria
1. All endpoints migrated and tested
2. Zero downtime during cutover
3. Performance parity or improvement
4. Cost reduction of 30%+
5. Simplified deployment process

## Risk Mitigation
1. **Dual-run period**: Both systems active during transition
2. **Feature flags**: Route control via appId parameter
3. **Rollback plan**: Express server remains available
4. **Incremental migration**: One domain at a time
5. **Comprehensive testing**: Each function validated independently

## Dependencies
- Azure subscription and Function Apps
- GitHub Actions for CI/CD
- MongoDB connection strings
- Firebase service account
- Azure Storage account

## Timeline Estimates
- **Phase 1**: 2 weeks (Foundation)
- **Phase 2**: 8-10 weeks (Core domains)
- **Phase 3**: 3-4 weeks (Supporting services)  
- **Phase 4**: 2 weeks (Cutover)
- **Total**: ~16-18 weeks

## Owner
@tobybalsley

## Linked Documentation
- `/public/BE-AzureFunctionStandard.md`
- `/public/BE_AzureFuntionsDeisgns.md`
- `/public/Playbook/calendar-be-af/af-current-state.md`
- `/public/Playbook/calendar-be-af/af-standards.md`

---

## Migration Tracking

### Domain Status
| Domain | Story Count | Endpoints | Status | Priority |
|--------|-------------|-----------|---------|----------|
| Categories | 1 | 1 | WIP | High |
| Events | 1 | 10 | Planned | High |
| Venues | 1 | 6 | Planned | High |
| Organizers | 1 | 10 | Planned | Medium |
| UserLogins | 1 | 18 | Planned | High |
| MasteredLocations | 1 | 6 | Planned | Medium |
| Firebase | 1 | 3 | Planned | Low |
| Roles | 1 | 1 | Planned | Low |
| Health | 1 | 5 | Planned | Low |
| Regions (Legacy) | 1 | 7 | Deferred | Low |

### Phase Timeline
```
2025 Q1: Phase 1 - Foundation ✓
2025 Q2: Phase 2 - Core Domains (Current)
2025 Q3: Phase 3 - Supporting Services
2025 Q4: Phase 4 - Cutover & Retirement
```