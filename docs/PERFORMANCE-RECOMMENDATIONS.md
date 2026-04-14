# Performance & Database Recommendations

**Date**: 2026-04-02
**Author**: Fulton (calendar-be-af)
**Status**: Recommendations for review

---

## Executive Summary

Audit of PROD MongoDB and query patterns revealed several optimization opportunities. With 3,500+ events and growing (discovered events pipeline active), these recommendations will help maintain performance.

---

## Current State

### Collection Sizes (PROD)
| Collection | Documents |
|------------|-----------|
| events | 3,549 |
| venues | 1,358 |
| organizers | 116 |
| masteredcities | 215 |
| userlogins | 50 |

### Index Count
- **events**: 27 indexes
- **venues**: 10 indexes

---

## Issues Found

### 1. Missing `masteredCityGeolocation` (CRITICAL)

**Status**: Porter fixing now

| Metric | Before Fix | After Fix (expected) |
|--------|------------|---------------------|
| Events with masteredCityGeolocation | 12 (0.3%) | ~2,000 (56%) |
| Density pills working | No | Yes |

**Impact**: MapCenterModal density pills don't display without this field.

**Fix**: Porter's backfill script needs to set `masteredCityGeolocation` from masteredcities collection.

---

### 2. Frontend/Backend Param Mismatch

**Frontend sends** (`useEventDensity.js`):
```javascript
swLat: bounds.south,
swLng: bounds.west,
neLat: bounds.north,
neLng: bounds.east,
```

**Backend ignores these params!**

Backend only supports:
- `lat`, `lng`, `radiusMeters` → `$centerSphere` query

**Impact**:
- Density pills fetch ALL events in date range
- Client-side filtering (inefficient at scale)
- Works now with 3,500 events, but won't scale

**Recommendation**: Add `$geoWithin: { $box: [[sw], [ne]] }` support to Events.js

---

### 3. Missing Index: `isDiscovered`

**Current**: No index on `isDiscovered` field

**Stats**:
- 2,418 discovered events (68% of total)
- Queries filtering by `isDiscovered` do full collection scan

**Recommendation**:
```javascript
db.events.createIndex({ isDiscovered: 1, appId: 1, startDate: 1 })
```

---

### 4. Field `calculatedFields` Not Populated

**Finding**: `calculatedFields.latitude` has 0 documents

This field doesn't exist in the schema. If any code references it, it will fail silently.

**Recommendation**: Remove references or populate the field during event creation.

---

### 5. High Index Count (27 on events)

Some indexes may be redundant or unused:
- `regionName_1` — Is this used? Different from `masteredRegionName`?
- Multiple organizer indexes — Could potentially consolidate

**Recommendation**: Audit index usage via `$indexStats` before adding more.

---

## Recommendations Summary

### Immediate (Do Now)

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 1 | Complete `masteredCityGeolocation` backfill | Porter | In progress |
| 2 | Verify density pills work after backfill | QA | 5 min |

### Short-term (Next Sprint)

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 3 | Add `isDiscovered` compound index | Fulton | 15 min |
| 4 | Add bounding box support to Events.js | Fulton | 2 hrs |
| 5 | Add performance queries to CalOps App Insights | Dash | 1 hr |

### Medium-term (Tech Debt)

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 6 | Audit unused indexes via `$indexStats` | Fulton | 1 hr |
| 7 | Remove/consolidate redundant indexes | Fulton | 1 hr |
| 8 | Document required event fields for discovered events | Porter/Fulton | 30 min |

---

## Index Recommendations

### Add These Indexes

```javascript
// 1. isDiscovered queries (discovered event filtering)
db.events.createIndex(
  { isDiscovered: 1, appId: 1, startDate: 1 },
  { name: "isDiscovered_appId_startDate" }
)

// 2. If bounding box support added (optional, 2dsphere already covers this)
// No new index needed - use existing venueGeolocation_2dsphere
```

### Existing Geospatial Indexes (Good)
- `venueGeolocation_2dsphere` — Use for event location queries
- `masteredCityGeolocation_2dsphere` — Use for city-level aggregation

---

## Bounding Box Support Proposal

### Current: `$centerSphere` (radius)
```javascript
// Works but not ideal for rectangular map views
venueGeolocation: {
  $geoWithin: {
    $centerSphere: [[lng, lat], radiusRadians]
  }
}
```

### Proposed: Add `$box` support
```javascript
// Better for map bounding boxes
if (swLat && swLng && neLat && neLng) {
  baseFilter.venueGeolocation = {
    $geoWithin: {
      $box: [[swLng, swLat], [neLng, neLat]]
    }
  };
}
```

### API Change
Add params to `/api/events`:
- `swLat`, `swLng` — Southwest corner
- `neLat`, `neLng` — Northeast corner

Frontend already sends these; backend just needs to handle them.

---

## CalOps App Insights Enhancement

Currently CalOps has error queries but no performance queries.

### Add to `/api/appinsights/route.js`:

```javascript
// Request performance by endpoint
requestPerformance: (timeRange) => `
  requests
  | where timestamp > ago(${timeRange})
  | summarize
      count(),
      avg(duration),
      percentile(duration, 95),
      percentile(duration, 99)
    by name
  | order by count_ desc
  | take 20
`,

// Slow requests (>2s)
slowRequests: (timeRange) => `
  requests
  | where timestamp > ago(${timeRange})
  | where duration > 2000
  | project timestamp, name, duration, resultCode, url
  | order by duration desc
  | take 50
`,

// Dependency performance (MongoDB, external APIs)
dependencyPerformance: (timeRange) => `
  dependencies
  | where timestamp > ago(${timeRange})
  | summarize
      count(),
      avg(duration),
      percentile(duration, 95)
    by name, type
  | order by count_ desc
  | take 20
`
```

---

## Monitoring Recommendations

### Key Metrics to Watch

| Metric | Threshold | Action |
|--------|-----------|--------|
| Events collection size | >10,000 | Review query performance |
| P95 request duration | >2s | Investigate slow endpoints |
| MongoDB query time | >500ms | Add/optimize indexes |
| Error rate | >1% | Investigate failures |

### Set Up Alerts (Azure Monitor)

1. **Slow Requests**: P95 > 3000ms
2. **High Error Rate**: 4xx+5xx > 5% of requests
3. **MongoDB Timeouts**: Connection errors > 10/hour

---

## Questions for Team

1. **For Sarah**: Is the bounding box param (`swLat` etc.) intentionally sent? Should we support it?

2. **For Porter**: What fields should ALL discovered events have? Document the contract.

3. **For Dash**: Can you add performance queries to CalOps App Insights page?

---

## Appendix: Current Events Indexes

```
_id_
startDate_1_endDate_1
masteredRegionName_1
masteredDivisionName_1
masteredCityName_1
masteredRegionId_1
masteredDivisionId_1
masteredCityId_1
masteredCityId_1_startDate_1
masteredDivisionId_1_startDate_1
masteredRegionId_1_startDate_1
ownerOrganizerID_1
grantedOrganizerID_1
alternateOrganizerID_1
venueID_1
venueGeolocation_2dsphere
masteredCityGeolocation_2dsphere
regionName_1
ownerOrganizer.id_1
ownerOrganizer.eventRole_1
alternateOrganizers.id_1
alternateOrganizers.eventRole_1
isRepeating_1_startDate_1
excludedDates_1
appId_1_startDate_1_masteredCityId_1_categoryFirst_1
appId_1_isActive_1_startDate_1
masteredRegionId_1_venueTimezone_1_startDate_1
venueTimezone_1_startDate_1
```

---

*Generated by Fulton during MongoDB audit session*
