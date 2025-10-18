# BE to AF Migration - Subtask Planning

## Subtask Naming Convention
`<STORY>-<##>: <Entity>_<Action> - <HTTP Method> <Path>`

Example: `CALBEAF-7-01: Event_List - GET /api/events`

## Subtask Structure by Story

### CALBEAF-6: Categories API Migration
1. `Category_Get - GET /api/categories` (WIP)

### CALBEAF-7: Events API Migration (10 subtasks)
1. `Event_List - GET /api/events`
2. `Event_All - GET /api/events/all` (deprecated)
3. `Event_ByLocation - GET /api/events/byMasteredLocations`
4. `Event_ByRegionCategory - GET /api/events/byRegionAndCategory`
5. `Event_GetById - GET /api/events/id/:id`
6. `Event_GetByOwner - GET /api/events/owner/:ownerId`
7. `Event_Create - POST /api/events/post`
8. `Event_Update - PUT /api/events/:eventId`
9. `Event_Delete - DELETE /api/events/:eventId`
10. `Event_UploadImage - POST /api/events/upload-image`

### CALBEAF-8: Venues API Migration (6 subtasks)
1. `Venue_List - GET /api/venues`
2. `Venue_Create - POST /api/venues`
3. `Venue_NearestCity - GET /api/venues/nearest-city`
4. `Venue_GetById - GET /api/venues/:id`
5. `Venue_Update - PUT /api/venues/:id`
6. `Venue_Delete - DELETE /api/venues/:id`

### CALBEAF-9: UserLogins API Migration (16 subtasks)
1. `UserLogin_GetAll - GET /api/userlogins/all`
2. `UserLogin_GetActive - GET /api/userlogins/active`
3. `UserLogin_GetByFirebase - GET /api/userlogins/firebase/:firebaseId`
4. `UserLogin_UpdateByFirebase - PUT /api/userlogins/firebase/:firebaseId`
5. `UserLogin_Create - POST /api/userlogins`
6. `UserLogin_UpdateInfo - PUT /api/userlogins/updateUserInfo`
7. `UserLogin_UpdateRoles - PUT /api/userlogins/:firebaseId/roles`
8. `UserLogin_UpdateAlternateIds - PUT /api/userlogins/:firebaseId/alternate-ids`
9. `UserLogin_FindByAnyId - GET /api/userlogins/find-by-any-id/:firebaseId`
10. `UserLogin_DebugInfo - GET /api/userlogins/debug/userInfo`
11. `UserLogin_ActivateOrganizer - POST /api/userlogins/activate-organizer`
12. `UserLogin_FixRegionalOrganizer - POST /api/userlogins/fix/regional-organizer`
13. `UserLogin_ImportFirebase - POST /api/userlogins/import-firebase`
14. `UserLogin_FixUserById - POST /api/userlogins/fix/user-by-id`
15. `UserLogin_FixOversized - POST /api/userlogins/fix/oversized-documents`
16. `UserLogin_EnsureDefaultRole - POST /api/userlogins/ensure-default-role`

### CALBEAF-10: Organizers API Migration (10 subtasks)
1. `Organizer_List - GET /api/organizers`
2. `Organizer_GetAll - GET /api/organizers/all`
3. `Organizer_GetById - GET /api/organizers/:id`
4. `Organizer_Create - POST /api/organizers`
5. `Organizer_Update - PUT /api/organizers/:id`
6. `Organizer_Delete - DELETE /api/organizers/:id`
7. `Organizer_AddImage - PUT /api/organizers/:id/add-image`
8. `Organizer_ConnectUser - PATCH /api/organizers/:id/connect-user`
9. `Organizer_DisconnectUser - PATCH /api/organizers/:id/disconnect-user`
10. `Organizer_GenerateSAS - POST /api/organizers/generate-sas-token`

### CALBEAF-11: MasteredLocations API Migration (6 subtasks)
1. `MasteredLocation_NearestCity - GET /api/mastered-locations/nearestMastered`
2. `MasteredLocation_Countries - GET /api/mastered-locations/countries`
3. `MasteredLocation_Regions - GET /api/mastered-locations/regions`
4. `MasteredLocation_Divisions - GET /api/mastered-locations/divisions`
5. `MasteredLocation_Cities - GET /api/mastered-locations/cities`
6. `MasteredLocation_All - GET /api/mastered-locations/all`

### CALBEAF-12: Firebase Integration Migration (3 subtasks)
1. `Firebase_FetchAndStore - POST /api/firebase/fetchAndStoreUser`
2. `Firebase_GeoIP - GET /api/firebase/geo/ip`
3. `Firebase_ListUsers - GET /api/firebase/users`

### CALBEAF-13: Roles API Migration (1 subtask)
1. `Role_List - GET /api/roles`

### CALBEAF-14: Health Check API Migration (5 subtasks)
1. `Health_Basic - GET /api/health`
2. `Health_Detailed - GET /api/health/detailed`
3. `Health_Version - GET /api/health/version`
4. `Health_StorageTest - GET /api/health/storage-test`
5. `Health_Versions - GET /api/health/versions`

### CALBEAF-15: Legacy Regions API Migration (7 subtasks)
1. `Region_GetAll - GET /api/regions`
2. `Region_GetActive - GET /api/regions/activeRegions`
3. `Region_GetActiveDivisions - GET /api/regions/activeDivisions`
4. `Region_GetActiveCities - GET /api/regions/activeCities`
5. `Region_UpdateActive - PUT /api/regions/region/:regionId/active`
6. `Region_UpdateDivisionActive - PUT /api/regions/region/:regionId/division/:divisionId/active`
7. `Region_UpdateCityActive - PUT /api/regions/region/:regionId/division/:divisionId/city/:cityId/active`

## Total Subtasks: 67

## Priority Order for Implementation

### Phase 1 - Foundation (Weeks 1-2)
1. Complete Category_Get (already WIP)
2. Health_Basic and Health_Version (simple, good for testing)
3. Role_List (simple lookup)

### Phase 2 - Core User Features (Weeks 3-10)
1. Event_List, Event_GetById (read operations first)
2. Venue_List, Venue_GetById
3. UserLogin_GetByFirebase, UserLogin_GetActive
4. MasteredLocation_Cities, MasteredLocation_NearestCity

### Phase 3 - Write Operations (Weeks 11-14)
1. Event_Create, Event_Update
2. Venue_Create, Venue_Update
3. Organizer_Create, Organizer_Update
4. UserLogin_Create, UserLogin_UpdateRoles

### Phase 4 - Advanced Features (Weeks 15-16)
1. Event_UploadImage, Organizer_AddImage
2. Firebase integration endpoints
3. Admin/fix endpoints
4. Legacy regions (if needed)

## Subtask Template

Each subtask should include:
1. Azure Function name
2. HTTP method and route
3. Authentication requirements
4. Input parameters
5. Expected output format
6. Dependencies (models, utils)
7. Test scenarios
8. Acceptance criteria