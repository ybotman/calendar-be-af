# Function Naming Convention

## Problem

As we expand to multiple apps (TangoTiempo, HarmonyJunction, NTTT, etc.), some functions will be:
- **Generic** - work for all apps (use appId from request)
- **App-Specific** - have logic unique to one app's role structure or workflow

We need a clear naming convention to distinguish these.

## Current State (Legacy)

| File | Scope | Notes |
|------|-------|-------|
| `Events.js` | Generic | Uses appId from request |
| `EventsRA.js` | App-specific (appId=1) | TangoTiempo RA logic, defaults to appId=1 |

**Problem**: `EventsRA.js` doesn't indicate it's TangoTiempo-specific.

## Proposed Naming Convention

### Pattern

```
{Domain}_{AppCode}_{Role}.js
```

Where:
- **Domain**: The resource (Events, Venues, Organizers, etc.)
- **AppCode**: App identifier (optional for generic functions)
- **Role**: Access level (RO, RA, SA, etc.)

### App Codes

| AppId | App | Code | Full Name |
|-------|-----|------|-----------|
| 1 | tangotiempo.com | TT | TangoTiempo |
| 2 | harmonyjunction.org | HJ | HarmonyJunction |
| 3 | NTTT | NTTT | NTTT |
| 6 | CalOps | OPS | CalOps |

### Role Codes

| Code | Role | Description |
|------|------|-------------|
| RO | RegionalOrganizer | User manages own events |
| RA | RegionalAdmin | Admin manages region's events |
| SA | SystemAdmin | Admin manages all events |
| SO | SystemOwner | Full system access |

### Examples

**Generic (all apps):**
```
Events.js              # GET events (all apps)
Events_RO.js           # RO CRUD (all apps)
Venues.js              # Venues (all apps)
```

**App-Specific:**
```
Events_TT_RA.js        # TangoTiempo Regional Admin
Events_HJ_RA.js        # HarmonyJunction Regional Admin
Events_TT_SA.js        # TangoTiempo System Admin
Organizers_HJ_RA.js    # HarmonyJunction organizer admin
```

**Current → Future Migration:**
```
EventsRA.js → Events_TT_RA.js
```

## Decision Matrix

| Scenario | Naming |
|----------|--------|
| Works for all apps, no special logic | `{Domain}.js` or `{Domain}_{Role}.js` |
| Uses app-specific roles | `{Domain}_{AppCode}_{Role}.js` |
| Uses app-specific business logic | `{Domain}_{AppCode}_{Role}.js` |
| Shared utility | `{Domain}.js` (generic) |

## Migration Plan

### Phase 1: Document (Now)
- Create this convention doc
- Identify existing app-specific functions

### Phase 2: New Functions (Ongoing)
- All new app-specific functions follow convention
- Example: `Events_HJ_RA.js` for HarmonyJunction admin

### Phase 3: Migrate (Future)
When time permits:
```bash
# Rename
EventsRA.js → Events_TT_RA.js

# Update imports in app.js
require('./functions/Events_TT_RA');

# Update route comments/docs
```

## Files to Migrate (Identified)

| Current | Future | Reason |
|---------|--------|--------|
| `EventsRA.js` | `Events_TT_RA.js` | TT-specific RA logic |
| (future) | `Events_HJ_RA.js` | When HJ needs admin |

## Route Naming

Routes should also indicate app-specificity when applicable:

**Generic:**
```
/api/events          # All apps (uses appId param)
/api/events/post     # All apps RO create
```

**App-Specific:**
```
/api/events/ra/...   # Could become /api/tt/events/ra/...
                     # Or keep generic route, app-specific handler
```

**Recommendation**: Keep routes generic, use handler naming for clarity.

## Summary

1. **Generic functions**: `{Domain}.js` or `{Domain}_{Role}.js`
2. **App-specific functions**: `{Domain}_{AppCode}_{Role}.js`
3. **App codes**: TT, HJ, NTTT, OPS
4. **Role codes**: RO, RA, SA, SO
5. **Migrate existing when convenient, not urgent**

---

*Created: 2026-02-25*
*Status: Proposed - for future reference*
