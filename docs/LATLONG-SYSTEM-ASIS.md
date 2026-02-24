# Lat/Long & Map Center System - AS-IS State

**Generated**: 2026-02-16
**Updated**: 2026-02-16 (Session analysis with Fulton)
**Status**: GAPS IDENTIFIED & PARTIAL FIX APPLIED

---

## 🗄️ DATABASE ENVIRONMENTS

| Database Name | Environment | Purpose |
|---------------|-------------|---------|
| **TangoTiempoProd** | 🔴 **PRODUCTION** | Live user data |
| **TangoTiempo** | 🟡 **TEST** | Testing/staging |
| **TangoTiempoTest** | ⚪ INTEGRATION | Empty/stale - needs refresh |

**Connection**: `mongodb+srv://TangoTiempoBE:***@tangotiempoprimary.qisq8.mongodb.net/{DATABASE}`

**local.settings.json uses**: `TangoTiempo` (TEST) by default for local dev

---

## EXECUTIVE SUMMARY

### 🔴 PROD (TangoTiempoProd) - NEEDS FIXES

| Issue | Count | Status |
|-------|-------|--------|
| **Users without mapCenter** | **25 of 46 (54%)** | 🚨 NEEDS FIX |
| Events without masteredCityName | 5 | ⚠️ DQ |
| Events without venueID | 4 | ⚠️ DQ |
| Venues without masteredCityId | 127 | ⚠️ DQ |
| Duplicate user (toby.balsley@gmail.com) | 2 records | ⚠️ Minor |

### 🟡 TEST (TangoTiempo) - FIXED

| Issue | Count | Status |
|-------|-------|--------|
| Users without mapCenter | ~~37~~ → 0 | ✅ FIXED (Boston default) |

### Other Items

| Issue | Status | Owner |
|-------|--------|-------|
| FE: MapCenter onboarding | ✅ IN PROGRESS | TIEMPO-381 (Sarah) |
| Anonymous/visitor location | ✅ DECIDED | Session-based picker |
| Legacy `Users_MapCenter_Deprecated` | 🧹 CLEANUP | 3 orphaned (TEST only) |

**GOOD NEWS**: Events API does NOT filter on `isApproved` or `isValidVenueGeolocation`.
All 1652 active PROD events have valid geo data and are visible.

---

## 1. DATA MODEL - COLLECTIONS & ATTRIBUTES

### 1.1 Events Collection

| Attribute | Type | Source | Purpose |
|-----------|------|--------|---------|
| `venueID` | ObjectId | Set on create | Links to venue |
| `venueGeolocation` | GeoJSON `{type: "Point", coordinates: [lng, lat]}` | **Derived from venue** | Primary geo search field |
| `masteredCityId` | ObjectId | **Derived from venue** | City hierarchy link |
| `masteredCityName` | String | **Derived from venue** | City name for `/boston` routes |
| `masteredCityGeolocation` | GeoJSON | **Derived from masteredcities** | Alternative geo search (useCity=true) |
| `masteredDivisionId` | ObjectId | **Derived from venue** | Division link |
| `masteredRegionId` | ObjectId | **Derived from venue** | Region link |

**Counts (PROD)**:
- Total: 1,670
- Active: 1,652
- With `venueGeolocation`: 1,652 (100%)
- With `masteredCityGeolocation`: 1,645 (99.6%)
- Missing `masteredCityName`: 5
- Missing `venueID`: 4

### 1.2 Venues Collection

| Attribute | Type | Source | Purpose |
|-----------|------|--------|---------|
| `latitude` | Number | User input / Geocode API | Latitude |
| `longitude` | Number | User input / Geocode API | Longitude |
| `geolocation` | GeoJSON | **Computed from lat/lng** | 2dsphere indexed for $geoWithin |
| `isValidVenueGeolocation` | Boolean | Manual flag | **PROBLEM: Not auto-set** |
| `isApproved` | Boolean | Manual flag | **PROBLEM: Most are false** |
| `isActive` | Boolean | Manual flag | Venue visibility |
| `masteredCityId` | ObjectId | Nearest city lookup | City hierarchy |
| `address1`, `city`, `state`, `zip` | String | User input | Address |
| `timezone` | String | Auto-detected from address | Timezone |

**Counts (PROD)**:
- Total: 584
- Active: 540
- With `geolocation`: 584 (100%)
- With `masteredCityId`: 457 (78%)
- **Missing `masteredCityId`: 127** ⚠️
- `isApproved=true`: 42 (7%)
- `isApproved=false`: 523 (90%) — **not blocking, flag unused**
- `isValidVenueGeolocation=true`: 19 (3%) — **not blocking, flag unused**

### 1.3 Userlogins Collection

| Attribute | Type | Source | Purpose |
|-----------|------|--------|---------|
| `mapCenter` | Object | PUT /api/mapcenter | User's explicit search center |
| `mapCenter.lat` | Number | User sets | Latitude (-90 to 90) |
| `mapCenter.lng` | Number | User sets | Longitude (-180 to 180) |
| `mapCenter.radiusMiles` | Number | User sets | Search radius (default 50, TT max 200) |
| `mapCenter.zoom` | Number | User sets | Map zoom level |
| `mapCenter.updatedAt` | Date | Auto | Last update time |

**Counts (PROD - TangoTiempoProd)**:
- Total userlogins: 46
- With `mapCenter`: 21 (46%)
- **Without `mapCenter`: 25 (54%)** 🚨 NEEDS FIX
- Duplicate email: 1 (toby.balsley@gmail.com has 2 records)

**Counts (TEST - TangoTiempo)**:
- Total userlogins: 47
- With `mapCenter`: 47 (100%) ✅ Fixed 2026-02-16

### 1.4 UserLoginAnalytics Collection

| Attribute | Type | Source | Purpose |
|-----------|------|--------|---------|
| `lastKnownLocation` | Object | POST /api/user/login-track | Auto-detected location |
| `lastKnownLocation.latitude` | Number | 3-tier geolocation | Best available lat |
| `lastKnownLocation.longitude` | Number | 3-tier geolocation | Best available lng |
| `lastKnownLocation.city` | String | ipinfo.io | City name |
| `lastKnownLocation.source` | String | System | "GoogleBrowser", "GoogleGeolocation", "IPInfoIO" |
| `google_browser_lat/lng` | Number | Browser API | Tier 1 (most accurate) |
| `google_api_lat/lng` | Number | Google Geolocation API | Tier 2 |
| `ipinfo_lat/lng` | Number | ipinfo.io | Tier 3 (fallback) |

**Counts**:
- Total: 17
- With `lastKnownLocation`: 17 (100%)

### 1.5 Masteredcities Collection

| Attribute | Type | Source | Purpose |
|-----------|------|--------|---------|
| `location` | GeoJSON | Admin setup | City center coordinates |
| `cityName` | String | Admin | Display name |
| `masteredDivisionId` | ObjectId | Admin | Division link |
| `isActive` | Boolean | Admin | City visibility |

**Counts**:
- Total: 215
- With `location`: 212 (99%)
- Missing `location`: 3 ⚠️

---

## 2. API ENDPOINTS - GET/PUT/POST

### 2.1 Map Center (User Preference)

| Method | Endpoint | Collection | Read Fields | Write Fields |
|--------|----------|------------|-------------|--------------|
| GET | `/api/mapcenter` | userlogins | `mapCenter` | - |
| PUT | `/api/mapcenter` | userlogins | - | `mapCenter` |
| POST | `/api/user/mapcenter-track` | MapCenterHistory | - | Analytics only |

### 2.2 User Location (Auto-Detected)

| Method | Endpoint | Collection | Read Fields | Write Fields |
|--------|----------|------------|-------------|--------------|
| POST | `/api/user/login-track` | UserLoginAnalytics | - | `lastKnownLocation`, 3-tier geo |
| POST | `/api/visitor/track` | VisitorTrackingAnalytics | - | `lastKnownLocation`, 3-tier geo |

### 2.3 Venue Location

| Method | Endpoint | Collection | Read Fields | Write Fields |
|--------|----------|------------|-------------|--------------|
| GET | `/api/venues` | venues | `lat`, `lng`, `geolocation` | - |
| GET | `/api/venues?lat=X&lng=Y&radius=Z` | venues | $geoWithin on `geolocation` | - |
| POST | `/api/venues` | venues | - | `latitude`, `longitude`, `geolocation` |
| PUT | `/api/venues/{id}` | venues | - | `latitude`, `longitude`, `geolocation` |
| GET | `/api/venues/geocode?address=X` | masteredcities | `location` | - |
| GET | `/api/venues/check-proximity` | venues | $geoNear on `geolocation` | - |

### 2.4 Event Location (Derived)

| Method | Endpoint | Collection | Read Fields | Write Fields |
|--------|----------|------------|-------------|--------------|
| GET | `/api/events` | events | `masteredCityName` | - |
| GET | `/api/events?useGeoSearch=true&lat=X&lng=Y` | events | `venueGeolocation` | - |
| GET | `/api/events?masteredCityName=Boston` | events | String match | - |
| POST | `/api/events` | events, venues | venue's geo | `venueGeolocation` (derived) |

### 2.5 Geocoding Services

| Method | Endpoint | Provider | Purpose |
|--------|----------|----------|---------|
| GET | `/api/geo/geocode?address=X` | Google | Address → lat/lng |
| GET | `/api/geo/reverse?lat=X&lng=Y` | Google | lat/lng → address |
| GET | `/api/geo/timezone?lat=X&lng=Y` | Google | lat/lng → timezone |
| POST | `/api/geo/google-geolocate` | Google | WiFi/cell → lat/lng |
| GET | `/api/geo/ipapico/ip` | ipapi.co | IP → lat/lng |

---

## 3. DATA FLOW DIAGRAMS

### 3.1 Venue Creation → Event Inheritance

```
USER INPUT                    VENUE RECORD                    EVENT RECORD
───────────                   ────────────                    ────────────
address: "123 Main St"   →    latitude: 42.36
                              longitude: -71.06           →   venueGeolocation: {
                              geolocation: {                    type: "Point",
                                type: "Point",                  coordinates: [-71.06, 42.36]
                                coordinates: [-71.06, 42.36]  }
                              }
                              masteredCityId: XXX          →   masteredCityId: XXX
                              isApproved: false ⚠️             masteredCityName: "Boston"
                              isValidVenueGeolocation: false ⚠️
```

### 3.2 User Search Flow (UPDATED - International Site)

```
LOGGED-IN USER                SYSTEM                         RESULT
──────────────                ──────                         ──────
1. Has mapCenter?      →      GET /api/mapcenter
   YES: use it         →      lat: 42.36, lng: -71.06, radius: 75mi
   NO: BLOCK UI        →      Show MapCenterOnboardingModal (TIEMPO-381)
                              User MUST set location before proceeding
                              PUT /api/mapcenter → then continue

2. Search events       →      GET /api/events?useGeoSearch=true&lat=X&lng=Y&radius=Zmi
                              $geoWithin on venueGeolocation

3. City route          →      GET /api/events?masteredCityName=Boston
   /boston                    String match (NOT geo search)


ANONYMOUS/VISITOR             SYSTEM                         RESULT
─────────────────             ──────                         ──────
1. No auth token       →      No mapCenter lookup
2. FE uses ???         →      ⚠️ GAP: What location do visitors use?
                              Options: IP geo, browser geo, or force signup?
```

---

## 4. IDENTIFIED GAPS & MISMATCHES

### 4.1 LOW: Venue Flags Not Auto-Set (NOT BLOCKING)

**Problem**: When venues are created, `isApproved` and `isValidVenueGeolocation` default to `false`. These flags are never auto-set even when coordinates are valid.

| Metric | Value | Issue |
|--------|-------|-------|
| Venues with valid lat/lng | 398 | All have coordinates |
| `isValidVenueGeolocation=true` | 20 (5%) | Only 5% flagged valid |
| `isApproved=true` | 42 (11%) | Only 11% approved |

✅ **NOT A PROBLEM**: Events API does NOT filter on these flags. All events are visible regardless of venue flags.

These flags appear to be **dead logic** — defined but never used in queries.

### 4.2 ~~CRITICAL~~ NOT AN ISSUE: Events at Unflagged Venues

| Scenario | Event Count | Actual Impact |
|----------|-------------|---------------|
| Active events at `isApproved=false` venues | 376 | ✅ Still visible |
| Active events at `isValidVenueGeolocation=false` venues | 238 | ✅ Still visible |
| Active events at `isActive=false` venues | 49 | ⚠️ These DO show (venue flag, not event flag) |

**VERIFIED**: Events API only filters on `event.isActive`, not venue flags.

### 4.3 ✅ FIXED: Users Without Location

| Scenario | Before | After | Status |
|----------|--------|-------|--------|
| Users without `mapCenter` | 37 (79%) | 0 | ✅ Fixed 2026-02-16 |
| All users now have | - | Boston (42.36, -71.06) 75mi | Default applied |

**Fix applied**: Bulk update set Boston default for all 47 existing users.

**NEW USERS STILL NEED**: Frontend onboarding flow (see Section 5.4).

### 4.4 MINOR: Missing Data

| Issue | Count |
|-------|-------|
| Events without `venueID` | 11 (test data) |
| Masteredcities without `location` | 3 |

### 4.5 City Route vs Geo Search Discrepancy

**Problem**: `/boston` route uses string match, geo search uses coordinates.

| Search Type | Query | Boston Results |
|-------------|-------|----------------|
| City route `/boston` | `masteredCityName: "Boston"` | 955 events |
| Geo search (75mi) | `$geoWithin` on venueGeolocation | 968 events |
| In geo radius but NOT "Boston" city | - | 14 events |

**14 events** are within 75mi of Boston but have empty or different `masteredCityName`:
- CAPE COD TANGO & BEACH WEEKEND (4 instances) — empty city
- LA SOCIAL — empty city
- INT/ADV classes, TangoAffair — empty city
- Foundry Festival Milonga Demo — empty city
- Milonga NUEVA! (3 instances) — empty city
- 1 event — Providence

**Impact**: Users on `/boston` route miss 14 nearby events. Geo search shows them.

### 4.6 MODERATE: Duplicate Userlogin Records

**Problem**: Some emails have multiple userlogin documents with different `firebaseUserId` values.

| Email | Record Count | Issue |
|-------|--------------|-------|
| toby.balsley@gmail.com | 4+ records | Multiple Firebase accounts? |
| mia.dalglish@gmail.com | 3 records | Same |
| smgaller@gmail.com | 2 records | Same |
| tobybalsley@mac.com | 2 records | Same |

**Impact**:
- `mapCenter` may be set on one record but not others
- User may see different state depending on which Firebase account they use
- Data integrity issue

**Root Cause**: Likely Firebase account creation/linking issues, or multiple signups.

### 4.7 ✅ DECIDED: Anonymous/Visitor User Location

**Decision (Gotan 2026-02-16)**: Options 1 + 5

| User Type | Location Source | Persistence | Behavior |
|-----------|-----------------|-------------|----------|
| Logged-in | `userlogins.mapCenter` | Permanent (DB) | TIEMPO-381 onboarding |
| Anonymous/Visitor | Session-based picker | Session only | Must set location to browse |

**Visitor Flow**:
```
Visitor arrives
    ↓
Show location picker modal (same as logged-in onboarding)
    ↓
User sets lat/lng/radius
    ↓
Store in sessionStorage (NOT database)
    ↓
Can browse events with geo filter
    ↓
Prompt to sign up to SAVE location permanently
```

**Key Points**:
1. Visitors MUST set location before seeing events (no free browsing)
2. Location stored in sessionStorage (cleared on browser close)
3. Encourages signup: "Sign up to save your location"
4. Same UI component as logged-in onboarding (reuse MapCenterOnboardingModal)

**FE Ticket Needed**: Visitor location flow (session-based onboarding)

---

## 5. RECOMMENDATIONS

### 5.1 ~~Immediate Fixes~~ LOW PRIORITY (Dead Logic)

These venue flags are NOT used by Events API. Consider removing them entirely:

1. ~~**Auto-set `isValidVenueGeolocation=true`**~~ — Not needed, flag is never checked
2. ~~**Bulk fix existing venues**~~ — Not needed
3. **Review if these flags should be deleted** — They add confusion without function

**Alternative**: If these flags ARE used somewhere (Venues API? Admin?), document where.

### 5.2 ~~Frontend Fallback Chain~~ DEPRECATED

**DO NOT USE FALLBACK CHAINS** — This is an international site.

Users MUST explicitly set their location. No auto-detection or defaults.

### 5.3 API Consistency

✅ **VERIFIED**: Events API does NOT filter on venue flags:
- `/api/events` - Only filters on `isActive`, `appId`, date range, geo
- `isApproved` and `isValidVenueGeolocation` are NOT checked

### 5.4 🚨 CRITICAL: Frontend MapCenter Onboarding (International Site)

**Requirement**: Force new users to set their location before browsing events.

#### Backend API (already exists)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/mapcenter?appId=1` | Check if user has mapCenter |
| `PUT` | `/api/mapcenter` | Save user's mapCenter |

#### PUT Body Schema
```javascript
{
  "lat": number,        // Required: -90 to 90
  "lng": number,        // Required: -180 to 180
  "radiusMiles": number, // Optional: 5-200 (TT), 5-2500 (HJ), default 50
  "zoom": number,       // Optional: 1-20, default 10
  "appId": "1"          // Optional: "1" or "2"
}
```

#### Required FE Flow

```
User logs in
    ↓
GET /api/mapcenter
    ↓
┌─────────────────────────────────────┐
│ if (response.data === null) {       │
│   // NO mapCenter exists            │
│   BLOCK UI → Show location picker   │
│   User must set lat/lng/radius      │
│   PUT /api/mapcenter                │
│   THEN allow access to events       │
│ }                                   │
└─────────────────────────────────────┘
    ↓
mapCenter exists → normal flow
```

#### Key Points

1. **Block the app** until mapCenter is saved — don't let them browse events without location
2. **Show a map picker** — let user click or search for their city
3. **Save to correct endpoint**: `PUT /api/mapcenter` (NOT legacy localUserInfo)
4. **Don't use browser geolocation as auto-save** — only as a "use my location" button option
5. **No defaults** — user must explicitly choose (international site)

#### Legacy Data (DO NOT USE)

The following are deprecated and should be ignored:
- `userData.localUserInfo.userDefaults.defaultCenterLocation` — legacy FE path
- `Users_MapCenter_Deprecated` collection — orphaned data (3 records)
- `loadUserMapPreferences()` in GeoLocationContext — defined but never called

---

## 6. JIRA TICKETS NEEDED

### Backend (CALBEAF)

| Priority | Type | Summary | Status |
|----------|------|---------|--------|
| ~~HIGH~~ | ~~Bug~~ | ~~Users without mapCenter~~ | ✅ Fixed 2026-02-16 |
| LOW | Task | Drop `Users_MapCenter_Deprecated` collection (3 orphaned docs) | Open |
| LOW | Task | Fix 13-16 events with empty `masteredCityName` | Sent to DASH |
| LOW | Task | Investigate duplicate userlogin records (same email, multiple docs) | Open |
| LOW | Task | Audit `isApproved`/`isValidVenueGeolocation` — delete if unused | Open |

### Frontend (CALFE or TT)

| Priority | Type | Summary | Status |
|----------|------|---------|--------|
| ~~🚨 HIGH~~ | ~~Feature~~ | ~~MapCenter onboarding flow (logged-in)~~ | ✅ TIEMPO-381 (Sarah) |
| **HIGH** | **Feature** | **Visitor location flow — session-based onboarding** | **Open** |
| MEDIUM | Cleanup | Remove `loadUserMapPreferences()` — never called | Open |
| LOW | Cleanup | Remove legacy `localUserInfo.userDefaults` location code | Open |

### Visitor Location Flow Requirements (NEW)

- Reuse `MapCenterOnboardingModal` component from TIEMPO-381
- Store location in `sessionStorage` (not DB) for visitors
- Block event browsing until location is set
- Add "Sign up to save your location" prompt after setting
- Clear on browser close (session-based)

---

## 7. APPENDIX: Field Cross-Reference

### Where lat/lng lives:

| Collection | Lat Field | Lng Field | Format |
|------------|-----------|-----------|--------|
| venues | `latitude` | `longitude` | Numbers |
| venues | `geolocation.coordinates[1]` | `geolocation.coordinates[0]` | GeoJSON |
| events | `venueGeolocation.coordinates[1]` | `venueGeolocation.coordinates[0]` | GeoJSON (derived) |
| masteredcities | `location.coordinates[1]` | `location.coordinates[0]` | GeoJSON |
| userlogins | `mapCenter.lat` | `mapCenter.lng` | Numbers |
| UserLoginAnalytics | `lastKnownLocation.latitude` | `lastKnownLocation.longitude` | Numbers |

**Note**: GeoJSON uses `[lng, lat]` order (x, y), while most APIs use `lat, lng` order.
