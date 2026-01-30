# Azure Functions - Available Endpoints

**Last Updated**: 2026-01-30
**Version**: 1.19.0
**Base URL (Local)**: `http://localhost:7071`
**Base URL (TEST)**: `https://calendarbeaf-test.azurewebsites.net`
**Total HTTP Endpoints**: 73
**Total Timer Functions**: 1
**Source Files**: 35 (`src/functions/*.js`)

---

## Endpoint Inventory

### Health (5 endpoints)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/health` | Health_Basic | anonymous | Health_Basic.js |
| GET | `/api/health/version` | Health_Version | anonymous | Health_Version.js |
| GET | `/api/health/mongodb` | Health_MongoDB | anonymous | Health_MongoDB.js |
| GET | `/api/health/mongodb/prod` | Health_MongoDB_Prod | anonymous | Health_MongoDB_Prod.js |
| GET | `/api/health/mongodb/test` | Health_MongoDB_Test | anonymous | Health_MongoDB_Test.js |

### Events (10 endpoints)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/events` | Events_Get | anonymous | Events.js |
| GET | `/api/events/id/{eventId}` | Events_GetById | anonymous | Events.js |
| POST | `/api/events` | Events_Create | **function** | Events.js |
| PUT | `/api/events/{eventId}` | Events_Update | **function** | Events.js |
| DELETE | `/api/events/{eventId}` | Events_Delete | **function** | Events.js |
| GET | `/api/events/summary` | EventsSummary_Get | anonymous | EventsSummary.js |
| POST,OPTIONS | `/api/events/upload-image` | Events_UploadImage | anonymous | EventsImageUpload.js |
| POST | `/api/events/ra/create` | EventsRA_Create | anonymous | EventsRA.js |
| PUT | `/api/events/ra/{eventId}` | EventsRA_Update | anonymous | EventsRA.js |
| DELETE | `/api/events/ra/{eventId}` | EventsRA_Delete | anonymous | EventsRA.js |

**Note**: Event creation route is `POST /api/events` (NOT `/api/events/post` as in old BE).
RegionalOrganizer (RO) uses standard CRUD. RegionalAdmin (RA) uses `/events/ra/*`.

### Venues (8 endpoints + 1 timer)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/venues` | Venues_Get | anonymous | Venues.js |
| GET | `/api/venues/{id}` | Venues_GetById | anonymous | Venues.js |
| POST | `/api/venues` | Venues_Create | anonymous | Venues.js |
| PUT | `/api/venues/{id}` | Venues_Update | anonymous | Venues.js |
| DELETE | `/api/venues/{id}` | Venues_Delete | anonymous | Venues.js |
| GET | `/api/venues/geocode` | Venues_Geocode | anonymous | VenuesGeocode.js |
| GET | `/api/venues/check-proximity` | Venues_CheckProximity | anonymous | VenuesGeocode.js |
| POST | `/api/venues/admin` | Venue_AdminAdd | anonymous | Venue_AdminAdd.js |
| Timer | Sunday 3AM UTC | Venue_AgeOut_Timer_App1 | - | Venue_AgeOut_Timer.js |

### Organizers (10 endpoints)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/organizers` | Organizers_Get | anonymous | Organizers.js |
| GET | `/api/organizers/{id}` | Organizers_GetById | anonymous | Organizers.js |
| GET | `/api/organizers/firebase/{firebaseUserId}` | Organizers_GetByFirebaseId | anonymous | Organizers.js |
| POST | `/api/organizers` | Organizers_Create | anonymous | Organizers.js |
| PUT | `/api/organizers/{id}` | Organizers_Update | anonymous | Organizers.js |
| DELETE | `/api/organizers/{id}` | Organizers_Delete | anonymous | Organizers.js |
| PATCH | `/api/organizers/{id}/connect-user` | Organizers_ConnectUser | anonymous | Organizers.js |
| PATCH | `/api/organizers/{id}/disconnect-user` | Organizers_DisconnectUser | anonymous | Organizers.js |
| GET | `/api/organizers-debug` | Organizers_Debug | anonymous | Organizers.js |
| POST,OPTIONS | `/api/organizers/generate-sas-token` | Organizers_GenerateSASToken | anonymous | OrganizersSASToken.js |

### User Logins (6 endpoints)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/userlogins/firebase/{firebaseId}` | UserLogins_GetByFirebaseId | anonymous | UserLogins.js |
| GET | `/api/userlogins/all` | UserLogins_GetAll | anonymous | UserLogins.js |
| POST,OPTIONS | `/api/userlogins` | UserLogins_Create | anonymous | UserLogins.js |
| PUT,OPTIONS | `/api/userlogins/updateUserInfo` | UserLogins_UpdateUserInfo | anonymous | UserLogins.js |
| PUT,OPTIONS | `/api/userlogins/{firebaseUserId}/roles` | UserLogins_UpdateRoles | anonymous | UserLogins.js |
| POST,OPTIONS | `/api/userlogins/activate-organizer` | UserLogins_ActivateOrganizer | anonymous | UserLogins.js |

### User Services (4 endpoints)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| POST,OPTIONS | `/api/user/fcm-token` | User_FCMToken | anonymous | User_FCMToken.js |
| GET,OPTIONS | `/api/user/onboarding-status` | User_OnboardingStatus | anonymous | User_OnboardingStatus.js |
| POST,OPTIONS | `/api/user/mapcenter-track` | MapCenterTrack | anonymous | MapCenterTrack.js |
| POST,OPTIONS | `/api/user/login-track` | UserLoginTrack | anonymous | UserLoginTrack.js |

### Map Center (1 endpoint)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET,PUT,OPTIONS | `/api/mapcenter` | MapCenter | anonymous | MapCenter.js |

### Categories (1 endpoint)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/categories` | Categories_Get | anonymous | Categories.js |

### Roles (1 endpoint)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/roles` | Roles_Get | anonymous | Roles.js |

### Geolocation (9 endpoints)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET,OPTIONS | `/api/geo/reverse` | Geo_Reverse | anonymous | Geo.js |
| GET,OPTIONS | `/api/geo/geocode` | Geo_Geocode | anonymous | Geo.js |
| GET,OPTIONS | `/api/geo/timezone` | Geo_Timezone | anonymous | Geo.js |
| GET,OPTIONS | `/api/geo/ipapico/ip` | Geo_IpapiCo_Get | anonymous | Geo.js |
| GET,OPTIONS | `/api/geo/bigdatacloud/ip` | Geo_BigDataCloud_Get | anonymous | Geo.js |
| GET,OPTIONS | `/api/geo/abstract/ip` | Geo_Abstract_Get | anonymous | Geo.js |
| POST,OPTIONS | `/api/geo/mapbox/reverse` | Geo_Mapbox_Reverse | anonymous | Geo.js |
| POST,OPTIONS | `/api/geo/google-geolocate` | Geo_GoogleGeolocate | anonymous | Geo_GoogleGeolocate.js |
| GET | `/api/geo/event-density` | Geo_EventDensity | anonymous | Geo_EventDensity.js |

### Mastered Locations (6 endpoints)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/masteredLocations/countries` | MasteredLocations_Countries | anonymous | MasteredLocations.js |
| GET | `/api/masteredLocations/regions` | MasteredLocations_Regions | anonymous | MasteredLocations.js |
| GET | `/api/masteredLocations/divisions` | MasteredLocations_Divisions | anonymous | MasteredLocations.js |
| GET | `/api/masteredLocations/cities` | MasteredLocations_Cities | anonymous | MasteredLocations.js |
| GET | `/api/masteredLocations/nearestMastered` | MasteredLocations_NearestMastered | anonymous | MasteredLocations.js |
| GET | `/api/regions/activeRegions` | Regions_ActiveRegions | anonymous | MasteredLocations.js |

**Note**: Sarah confirmed FE has disconnected all masteredLocations UI paths. These exist but are not actively called by TangoTiempo FE.

### Frontend Logs (2 endpoints)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| POST,OPTIONS | `/api/frontend-logs` | FrontendLogs_Create | anonymous | FrontendLogs.js |
| POST,OPTIONS | `/api/frontend-logs/batch` | FrontendLogs_Batch | anonymous | FrontendLogs.js |

### Analytics (1 endpoint)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/analytics/visitor-heatmap` | Analytics_VisitorHeatmap | anonymous | Analytics_VisitorHeatmap.js |

### Visitor Tracking (1 endpoint)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| POST,OPTIONS | `/api/visitor/track` | VisitorTrack | anonymous | VisitorTrack.js |

### Voice (2 endpoints)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/voice/events` | Voice_Events | anonymous | VoiceEvents.js |
| GET,POST | `/api/voice/ask` | Voice_Ask | anonymous | VoiceAsk.js |

### Cloudflare (1 endpoint)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/cloudflare/info` | Cloudflare_Info | anonymous | Cloudflare.js |

### Metrics (1 endpoint)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/metrics` | Metrics_Get | anonymous | Metrics_Get.js |

### Documentation (2 endpoints)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/docs` | SwaggerUI | anonymous | API_Docs.js |
| GET | `/api/swagger.json` | SwaggerJSON | anonymous | API_Docs.js |

### Debug (2 endpoints)

| Method | Route | Function | Auth | File |
|--------|-------|----------|------|------|
| GET | `/api/events-debug` | Events_Debug | anonymous | Events.js |
| GET | `/api/db-info` | DB_Info | anonymous | Events.js |

---

## Summary by Domain

| Domain | Endpoints | Status |
|--------|-----------|--------|
| Health | 5 | Complete |
| Events (standard) | 7 | Complete |
| Events (RA) | 3 | Complete |
| Events (summary/image) | 2 | Complete |
| Venues | 8 (+1 timer) | Complete |
| Organizers | 10 | Complete |
| User Logins | 6 | Complete |
| User Services | 4 | Complete |
| Map Center | 1 | Complete |
| Categories | 1 | Complete |
| Roles | 1 | Complete |
| Geo | 9 | Complete |
| Mastered Locations | 6 | Complete (FE disconnected) |
| Frontend Logs | 2 | Complete (FE disabled) |
| Analytics | 1 | Complete |
| Visitor Tracking | 1 | Complete |
| Voice | 2 | Complete |
| Cloudflare | 1 | Complete |
| Metrics | 1 | Complete |
| Docs | 2 | Complete |
| Debug | 2 | Complete |
| **TOTAL** | **73 HTTP + 1 timer** | |

---

## Known Route Differences (BE vs AF)

| BE Route | AF Route | Notes |
|----------|----------|-------|
| `POST /api/events/post` | `POST /api/events` | FE must update call path |
| `GET /api/events/count` | Not implemented | FE uses in useMigratedOrganizers.js |
| `POST /api/venues/check-proximity` | Not registered (GET only) | FE uses POST variant |

---

## TT Migration Gap Status (2026-01-30)

Based on Sarah's corrected audit (msg_002, Jan 29):

**Tier 1 (Originally "Missing")**: ALL 4 now EXIST in AF
- Events_UploadImage, Organizers_GenerateSASToken, FrontendLogs (x2)

**Tier 2 (Verify sub-routes)**: ALL 13 EXIST in AF
- EventsSummary, VenuesGeocode, Organizers CRUD, UserLogins CRUD

**Remaining Gaps**:
1. `GET /api/events/count` - Not implemented
2. `POST /api/venues/check-proximity` (POST variant) - GET exists, POST does not
3. Route mapping: FE calls `/api/events/post`, AF expects `POST /api/events`

**Open Tickets**:
- CALBEAF-70: RO granted/alternate events visibility
- CALBEAF-68: MasteredLocations (dropped per Sarah - FE disconnected)

---

*Updated by Fulton, 2026-01-30*
