# Azure Functions Architecture

**Version**: 1.0
**Date**: 2026-02-25
**Status**: APPROVED
**Decision**: Fulton manages all Azure Functions across all apps

---

## Summary

All Azure Functions for all apps are managed in a single Azure Functions project, maintained by **Fulton**. App-specific logic is organized via folder structure and naming conventions.

---

## Architecture Decision

### Decision: Single Azure Functions Project

**Chosen**: One unified Azure Functions project serving all apps
**Rejected**: Separate Azure Functions per app/universe

### Rationale

| Factor | Single Project | Multiple Projects |
|--------|---------------|-------------------|
| Deployment | One pipeline | Multiple pipelines |
| Shared code | Co-located | Duplicated or npm package |
| Auth/middleware | Shared | Duplicated |
| Azure costs | Lower | Higher |
| Maintenance | Easier | Harder |
| Persona ownership | Clear (Fulton) | Fragmented |

---

## Project Structure

```
calendar-be-af/                    # May rename to hdts-af later
├── src/
│   ├── functions/
│   │   ├── shared/                # All apps use these
│   │   │   ├── Health_Basic.js
│   │   │   ├── Health_MongoDB.js
│   │   │   ├── Metrics.js
│   │   │   ├── VisitorTrack.js        # appId param determines app
│   │   │   ├── UserLoginTrack.js
│   │   │   └── User.js
│   │   │
│   │   ├── calendar/              # TT, HJ, future calendars
│   │   │   ├── Events.js              # Shared calendar logic
│   │   │   ├── Events_TT.js           # TangoTiempo-specific
│   │   │   ├── Events_HJ.js           # HarmonyJunction-specific
│   │   │   ├── Venues.js
│   │   │   ├── Categories.js
│   │   │   └── MapCenter.js
│   │   │
│   │   ├── nttt/                  # NTTT (AppId 3)
│   │   │   ├── Games_NT.js            # Game sessions, scores
│   │   │   ├── Comments_NT.js         # Game comments
│   │   │   └── Leaderboard_NT.js      # Future: leaderboards
│   │   │
│   │   ├── tbap/                  # TBaP (AppId 10)
│   │   │   └── Assessment_TR.js       # Assessment results
│   │   │
│   │   └── ops/                   # Operations (AppId 9)
│   │       ├── Billing.js             # Usage tracking
│   │       └── Analytics.js           # Cross-app analytics
│   │
│   ├── middleware/
│   │   ├── standardMiddleware.js
│   │   ├── authMiddleware.js
│   │   └── corsMiddleware.js
│   │
│   └── shared/
│       ├── db.js                      # MongoDB connection
│       ├── firebase.js                # Firebase Admin
│       └── validators.js
│
├── docs/
│   ├── FUNCTION-NAMING-STANDARD.md
│   ├── AVAILABLE-ENDPOINTS.md
│   └── AZURE-FUNCTIONS-ARCHITECTURE.md  # This file
│
└── host.json
```

---

## Naming Conventions

### File Naming

| Pattern | Use Case | Example |
|---------|----------|---------|
| `{Domain}.js` | Shared logic, all apps | `Events.js`, `Venues.js` |
| `{Domain}_{AppCode}.js` | App-specific logic | `Events_TT.js`, `Games_NT.js` |
| `{Domain}_{AppCode}_{Role}.js` | Role-specific | `Events_TT_RA.js` |

### App Codes

| AppId | Code | App | Folder |
|-------|------|-----|--------|
| 1 | TT | tangotiempo.com | `calendar/` |
| 2 | HJ | harmonyjunction.org | `calendar/` |
| 3 | NT | NTTT | `nttt/` |
| 4 | DJ | TangoDJ | `calendar/` (future) |
| 5 | TL | Tangology | `shared/` (static, minimal) |
| 6 | CO | CalOps | `ops/` |
| 7 | OB | OpeningBlitz | `chess/` (future) |
| 8 | DN | Dental Navigator | `dental/` (future) |
| 9 | HD | HDTS | `ops/` |
| 10 | TR | TBaP | `tbap/` |

### Function Naming

Inside files, follow the standard:
```javascript
// File: nttt/Games_NT.js
app.http('Games_NT_Create', { ... });
app.http('Games_NT_GetScores', { ... });
```

### Route Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Shared | `/api/{resource}` | `/api/visitor/track` |
| App-specific | `/api/{appCode}/{resource}` | `/api/nt/games/scores` |

---

## Persona Responsibilities

### Fulton (Azure Functions)

**Owns**: All Azure Functions code and deployment

- Maintains `calendar-be-af` (or future `hdts-af`)
- Implements shared middleware, auth, DB connections
- Creates app-specific functions in appropriate folders
- Manages Azure deployment pipelines
- Monitors function health and performance

### Christopher (HDTS)

**Owns**: Client-side shared library and operations

- Maintains `@hdts/core` NPM package
- Implements client-side tracking calls
- Builds `hdts-ops` dashboard
- Defines data schemas and contracts
- Does NOT implement Azure Functions (delegates to Fulton)

### App Personas (Sarah, Compás, etc.)

**Own**: Their app's frontend and business logic

- Call Fulton's functions via API
- Use `@hdts/core` for tracking
- Request new functions from Fulton when needed
- Do NOT modify Azure Functions directly

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT APPS                              │
│  TT (Sarah) │ HJ (Cord) │ NT (Compás) │ TR (Charlotte) │ etc.   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ HTTP API calls
                               │ (uses @hdts/core)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AZURE FUNCTIONS (Fulton)                      │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   shared/   │  │  calendar/  │  │    nttt/    │   ...        │
│  │VisitorTrack │  │  Events.js  │  │ Games_NT.js │              │
│  │UserLogin    │  │ Events_TT.js│  │Comments_NT  │              │
│  │Health       │  │ Events_HJ.js│  │             │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                               │                                  │
└───────────────────────────────┼──────────────────────────────────┘
                               │
                               │ Database operations
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                         MONGODB ATLAS                            │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ hdts-shared │  │  calendar   │  │    nttt     │              │
│  │  - visits   │  │  - Events   │  │  - scores   │              │
│  │  - logins   │  │  - Venues   │  │  - comments │              │
│  │  - users    │  │  - etc.     │  │             │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Path

### Phase 1: Reorganize Current Structure

1. Create folder structure: `shared/`, `calendar/`, `nttt/`
2. Move existing functions to appropriate folders
3. Update imports and paths
4. Deploy and verify

### Phase 2: Add NTTT Functions

1. Create `nttt/` folder
2. Add `Games_NT.js` for game sessions/scores
3. Add routes: `/api/nt/games/*`
4. Update NTTT frontend to call new endpoints

### Phase 3: Add Shared Tracking

1. Enhance `VisitorTrack.js` with full HDTS schema
2. Create `Analytics.js` for cross-app reporting
3. Add `Billing.js` for usage metrics
4. Connect to hdts-ops dashboard

### Phase 4: Future Apps

As new apps need functions:
1. Create app folder (e.g., `dental/`, `chess/`)
2. Add app-specific functions
3. Follow naming conventions
4. Update this document

---

## Questions & Answers

**Q: Why not rename to `hdts-af`?**
A: Could do this later. Current name works and avoids breaking changes. The scope expansion is internal organization, not a rebrand.

**Q: What if an app needs many functions?**
A: Still stays in this project. Use subfolders within the app folder:
```
nttt/
├── games/
│   ├── Sessions.js
│   └── Scores.js
├── social/
│   ├── Comments.js
│   └── Reactions.js
└── index.js
```

**Q: How do app personas request new functions?**
A: Create a JIRA ticket in CALBEAF project, or send MSG to Fulton. Fulton implements and deploys.

**Q: What about serverless cold starts?**
A: Monitor and optimize. Consider Azure Functions Premium if needed. Shared project actually helps (more traffic = warmer functions).

---

## Related Documents

- [FUNCTION-NAMING-STANDARD.md](./FUNCTION-NAMING-STANDARD.md) - Naming conventions
- [AVAILABLE-ENDPOINTS.md](./AVAILABLE-ENDPOINTS.md) - Current endpoints
- [HDTS-SharedInfra-Plan.md](/Users/tobybalsley/MyDocs/AppDev/HDTS-SharedInfra-Plan.md) - Overall infrastructure

---

**Maintained By**: Fulton (calendar-be-af)
**Approved By**: Gotan (HDTS Overseer)
