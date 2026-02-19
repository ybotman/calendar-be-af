# Database Reconciliation Plan

**Created**: 2026-02-17
**Status**: PHASE 1 - ORGANIZER RECONCILIATION
**Author**: Fulton (AI Agent) + Gotan

---

## CRITICAL RULE

**NO DATABASE CHANGES WITHOUT EXPLICIT APPROVAL FROM GOTAN.**

Every action must be:
1. Documented before execution
2. Explicitly approved by Gotan
3. Logged after execution with results
4. Tracked in the organizer-specific folder

---

## Database Reference (ALWAYS USE THESE NAMES)

| Actual Database Name | Azure Function Env Var | Current Role | After Fix |
|---------------------|------------------------|--------------|-----------|
| **`TangoTiempo`** | `MONGODB_URI_TEST` | LIVE site (tangotiempo.com) | Will become TEST |
| **`TangoTiempoProd`** | `MONGODB_URI_PROD` | Local dev only | Will become true PROD |
| `TangoTiempoIntg` | - | NOT USED | - |
| `TangoTiempoTest` | - | NOT USED | - |

**IMPORTANT**: Throughout this document, we use the actual database names (`TangoTiempo`, `TangoTiempoProd`), not "PROD" or "TEST" labels which are currently backwards.

---

## What Happened

### The Problem

During the Azure Functions migration, the Vercel frontend environment variables were configured incorrectly, causing the LIVE site to point to the wrong database.

### Cutover Date: ~January 29, 2026

**Evidence from git history:**

| Date | Commit | Significance |
|------|--------|--------------|
| Jan 29, 2026 | `100% TT coverage (42/42)` | Backend reached full API parity with Express |
| Jan 29, 2026 | `v1.16.0 - Full AF migration readiness` | Frontend ready for Azure Functions |
| Feb 4, 2026 | `Express BE deprecation` | Express backend officially deprecated |

**The Vercel environment variable swap happened around January 29, 2026.**

### Current State (BACKWARDS)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CURRENT (WRONG)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   tangotiempo.com (LIVE)                                           │
│         │                                                           │
│         ▼                                                           │
│   PROD Vercel Frontend                                              │
│         │                                                           │
│         │ uses MONGODB_URI_TEST                                     │
│         ▼                                                           │
│   ┌─────────────────┐                                              │
│   │  TangoTiempo    │  ◄── LIVE user data goes here                │
│   │  (1,575 events) │      But Azure calls this "TEST"             │
│   └─────────────────┘                                              │
│                                                                     │
│   Local dev only                                                    │
│         │                                                           │
│         │ uses MONGODB_URI_PROD                                     │
│         ▼                                                           │
│   ┌─────────────────┐                                              │
│   │ TangoTiempoProd │  ◄── Dev data + AI-discovered events         │
│   │  (1,670 events) │      Azure calls this "PROD" but it's not    │
│   └─────────────────┘                                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Impact

- Data entered via tangotiempo.com (LIVE) → went to `TangoTiempo` database
- Data entered via local dev → went to `TangoTiempoProd` database
- AI-discovered events (fb-conditioner) → loaded to `TangoTiempoProd` only
- Databases diverged after Jan 29, 2026

---

## Divergence Analysis (as of 2026-02-17)

**See [FULL-ANALYSIS-REPORT.md](./FULL-ANALYSIS-REPORT.md) for complete details.**

### Executive Summary

| Category | Count | Notes |
|----------|-------|-------|
| Events only in `TangoTiempo` | 1 | Test event (YBOTMAN, Feb 17) |
| Events only in `TangoTiempoProd` | 15 | 13 old (March 2024) + 2 future HJ |
| Events with field differences | 6 | All AZUL (`isActive` mismatch) |
| **Events identical in both** | **995** | **99.4% - No action needed** |

### Event Counts

| Category | `TangoTiempo` (LIVE) | `TangoTiempoProd` (DEV) | Difference |
|----------|---------------------|------------------------|------------|
| Organizer-created events | 1,002 | 1,016 | +14 in DEV |
| AI-discovered (fb-conditioner) | 573 | 654 | +81 in DEV |
| **Total events** | **1,575** | **1,670** | **+95 in DEV** |

### Organizers with Divergence

| Organizer | `TangoTiempo` | `TangoTiempoProd` | Only TT | Only TTP | Notes |
|-----------|---------------|-------------------|---------|----------|-------|
| ULTIMATE | 78 | 82 | 0 | 4 | Old events from March 2024 |
| SOCIETY | 365 | 367 | 0 | 2 | Old events |
| MILT-CORI | 12 | 14 | 0 | 2 | Old events |
| MIT | 12 | 14 | 0 | 2 | Old events |
| SUENO | 75 | 76 | 0 | 1 | Old event |
| LAURA | 11 | 12 | 0 | 1 | Old event |
| SUN-PRAC | 61 | 62 | 0 | 1 | Old event |
| YBOTMAN | 25 | 24 | 1 | 0 | Test event in LIVE |
| **AZUL** | 26 | 26 | 0 | 0 | **6 events with `isActive` diff** |

### Field-Level Differences

**6 AZUL events** have different `isActive` values:
- `TangoTiempo` (LIVE): `isActive: false` (organizer deactivated them)
- `TangoTiempoProd` (DEV): `isActive: true` (deactivation not synced)

**Action**: Apply `isActive: false` to these 6 events in `TangoTiempoProd`.

### Userlogins

| Database | Count | Notes |
|----------|-------|-------|
| `TangoTiempo` (LIVE) | 48 | 17 unique (real users from LIVE site) |
| `TangoTiempoProd` (DEV) | 46 | 15 unique (dev/test accounts) |

**Action**: Copy 17 userlogins from `TangoTiempo` to `TangoTiempoProd`.

### Key Finding

**The divergence is minimal.** 99.4% of organizer-created events are identical in both databases. The remaining issues are:
1. 6 AZUL events need `isActive` flag updated
2. 13 old events (March 2024) in `TangoTiempoProd` should be deleted
3. 17 userlogins need to be copied to `TangoTiempoProd`

---

## The Fix Plan

### Phase 0: Backup (BEFORE ANY CHANGES) ✅ COMPLETE

| Backup ID | Database | Collections | Documents | Status |
|-----------|----------|-------------|-----------|--------|
| BACKUP-001 | `TangoTiempo` | 10 | 2,669 | ✅ COMPLETE 2026-02-17 16:03 EST |
| BACKUP-002 | `TangoTiempoProd` | 10 | 2,762 | ✅ COMPLETE 2026-02-17 16:03 EST |

**Backup collections**: `{collection}_backup_2026-02-17_reconciliation`

See [BACKUP-LOG.md](./BACKUP-LOG.md) for details.

### Phase 1: Event Reconciliation ⏳ IN PROGRESS

**Target Database for Changes**: `TangoTiempoProd` (via `MONGODB_URI_PROD`)

#### Phase 1A: AZUL Events - Fix `isActive` Flag
| Action | Database | Description | Status |
|--------|----------|-------------|--------|
| ACTION-001 | `TangoTiempoProd` | Set `isActive: false` for 6 AZUL events | PENDING |

#### Phase 1B: Delete Old Events from `TangoTiempoProd`
| Action | Database | Description | Status |
|--------|----------|-------------|--------|
| ACTION-002 | `TangoTiempoProd` | Delete 13 old events from March 2024 | PENDING |

Events to delete:
- LAURA: Partylonga NoHo (2024-03-02)
- SOCIETY: Milonga TRANOCHANDO (2024-03-02)
- SUENO: Argentine Tango West Hartford (2024-03-02)
- MILT-CORI: 2 events (2024-03-03)
- ULTIMATE: 4 events (2024-03-03)
- SUN-PRAC: Boston Weekly Sunday Practica (2024-03-03)
- SOCIETY: PRACTILONGA CAMINITO (2024-03-03)
- MIT: 2 events (2024-03-04, 2024-03-05)

**Keep**: 2 future HarmonyJunction events (BHS 2027, HI 2027)

#### Phase 1C: Optional - Delete Test Event from `TangoTiempo`
| Action | Database | Description | Status |
|--------|----------|-------------|--------|
| ACTION-003 | `TangoTiempo` | Delete YBOTMAN "TEST" event (Feb 17) | OPTIONAL |

### Phase 2: Userlogins Sync ⏳ PENDING

| Action | Database | Description | Status |
|--------|----------|-------------|--------|
| ACTION-004 | `TangoTiempoProd` | Copy 17 userlogins from `TangoTiempo` | PENDING |

These are real users who signed up on the LIVE site (tangotiempo.com).

### Phase 3: Frontend Pointer Swap (FINAL STEP)

**LAST STEP - Only after all data is reconciled:**

| Frontend Environment | Current Database | After Swap |
|---------------------|------------------|------------|
| PROD Vercel (`MONGODB_URI`) | `TangoTiempo` | `TangoTiempoProd` |
| TEST Vercel (`MONGODB_URI`) | `TangoTiempoProd` | `TangoTiempo` |

**Result**: `TangoTiempoProd` becomes the true production database, names finally match reality.

---

## Organizer List (by Short Name)

### Organizers Requiring Action

| Short Name | Full Name | Issue | Action Needed |
|------------|-----------|-------|---------------|
| **AZUL** | Milonga Sal Azul Team | 6 events have `isActive` mismatch | Update `isActive: false` in `TangoTiempoProd` |
| YBOTMAN | Toby Balsley | 1 test event only in `TangoTiempo` | Delete test event (optional) |

### Organizers with Old Events to Delete from `TangoTiempoProd`

| Short Name | Events to Delete | Start Dates |
|------------|------------------|-------------|
| ULTIMATE | 4 events | 2024-03-03 |
| SOCIETY | 2 events | 2024-03-02, 2024-03-03 |
| MILT-CORI | 2 events | 2024-03-03 |
| MIT | 2 events | 2024-03-04, 2024-03-05 |
| SUENO | 1 event | 2024-03-02 |
| LAURA | 1 event | 2024-03-02 |
| SUN-PRAC | 1 event | 2024-03-03 |

### Organizers with Identical Data (No Action Needed) - 22 organizers

AFFAIR, GMERLO, ALEX, HSUEH-TZE, ACADEMY, ANDI, ROGER, Vicky Magaletta, CORAZON, TOBY, QTB, SPARK, HENRAH, SUEDAVIS, ADRIANAPIN, Mia Dalglish, Milton Azevedo, HARVARD, MISHA, BLUE, DORTAN, WESTMA, UNKNOWN, BTO, PS1, SGALLER, V-KRUTA, TTCALTESTER

---

## Folder Structure

```
docs/reconciliation/
├── OVERVIEW.md                    # This file - master plan
├── FULL-ANALYSIS-REPORT.md        # Complete analysis results
├── BACKUP-LOG.md                  # Backup execution log
├── EXECUTION-LOG.md               # All approved/executed statements
├── TEMPLATE-ORGANIZER.md          # Template for organizer folders
│
└── [ORGANIZER FOLDERS]/           # Only needed for complex cases
    └── ...
```

**Note**: Given the minimal divergence found, per-organizer folders may not be necessary. Most reconciliation can be done with 4 simple actions.

---

## Action Tracking Format

### Before Execution (in TODO.md)

```markdown
### ACTION-001: [Category] Description

**Status**: PENDING APPROVAL

**Category**: EVENTS | USERLOGIN | VENUE | ORGANIZER

**Technical Description**:
- Database: `TangoTiempoProd` (via MONGODB_URI_PROD)
- Collection: events
- Operation: INSERT / UPDATE / DELETE
- Query: `db.events.insertOne({...})`

**User Description**:
What this does in plain English for the organizer.

**Approval**: [ ] Gotan approved on YYYY-MM-DD
```

### After Execution (in COMPLETED.md)

```markdown
### ACTION-001: [Category] Description

**Executed**: 2026-02-17 HH:MM EST
**Approved By**: Gotan
**Database**: `TangoTiempoProd`

**What We Did** (User-Friendly):
- Restored the "VIDA MIA MILONGA" event for Feb 23
- Event now visible on tangotiempo.com (after frontend swap)

**Technical Details**:
- Statement: `db.events.insertOne({_id: ObjectId("..."), ...})`
- Result: Inserted 1 document
- Verification: Event confirmed in `TangoTiempoProd` database
```

---

## Execution Log Summary

| Action ID | Database | Category | Description | Status | Date |
|-----------|----------|----------|-------------|--------|------|
| BACKUP-001 | `TangoTiempo` | BACKUP | Full backup (10 collections, 2,669 docs) | ✅ COMPLETE | 2026-02-17 |
| BACKUP-002 | `TangoTiempoProd` | BACKUP | Full backup (10 collections, 2,762 docs) | ✅ COMPLETE | 2026-02-17 |
| ANALYSIS-001 | BOTH | ANALYSIS | Full reconciliation analysis | ✅ COMPLETE | 2026-02-17 |
| ACTION-001 | `TangoTiempoProd` | EVENTS | Set `isActive: false` for 6 AZUL events | ⏳ PENDING | - |
| ACTION-002 | `TangoTiempoProd` | EVENTS | Delete 13 old events (March 2024) | ⏳ PENDING | - |
| ACTION-003 | `TangoTiempo` | EVENTS | Delete YBOTMAN test event | ⏳ OPTIONAL | - |
| ACTION-004 | `TangoTiempoProd` | USERLOGINS | Copy 17 userlogins from `TangoTiempo` | ⏳ PENDING | - |

---

## Next Steps

1. ✅ ~~Backup both databases~~ COMPLETE
2. ✅ ~~Full reconciliation analysis~~ COMPLETE - See FULL-ANALYSIS-REPORT.md
3. ⏳ **Get Gotan approval** for the 4 actions below:
   - ACTION-001: Update 6 AZUL events (`isActive: false`)
   - ACTION-002: Delete 13 old events from `TangoTiempoProd`
   - ACTION-003: Delete YBOTMAN test event (optional)
   - ACTION-004: Copy 17 userlogins to `TangoTiempoProd`
4. Execute approved actions
5. Verify results
6. Frontend pointer swap (Phase 3)

---

## Sign-Off

| Role | Name | Approved | Date |
|------|------|----------|------|
| User | Gotan | [ ] | |
| Agent | Fulton | [x] | 2026-02-17 |
| Oversight | Quinn | [x] | 2026-02-17 |

**REMINDER**: No database changes without explicit approval from Gotan.

---

## Oversight Log (Quinn - Cross-Project Coordinator)

### 2026-02-17 15:45 EST - Quinn Taking Oversight Role

**ROLE ASSIGNMENT:**
- **Quinn**: Oversight & Verification - verifies each step, appends notes, halts if deviations
- **Gotan**: Arbiter - final decision maker, approves each organizer's changes
- **Fulton**: Executor - performs approved database operations

**MONGODB ACCESS VERIFIED:**
```
MONGODB_URI_PROD → TangoTiempoProd database (1,016 organizer-created events)
MONGODB_URI_TEST → TangoTiempo database (1,002 organizer-created events)
```

**SWAP SITUATION CONFIRMED:**
- LIVE site (tangotiempo.com) uses `TangoTiempo` database
- Azure Functions env var calls this "TEST" (`MONGODB_URI_TEST`) but it's actually serving LIVE traffic
- This naming mismatch is the core problem we're fixing

**TEAM NOTIFIED:**
- Message sent to Fulton (calendar-be-af executor)
- Message sent to Sarah (tangotiempo.com frontend)

---

### 2026-02-17 17:00 EST - Cutover Date Analysis

**CUTOVER DATE DETERMINED: ~January 29, 2026**

Git evidence:
- Backend: `100% TT coverage (42/42)` commit on Jan 29
- Frontend: `v1.16.0 - Full AF migration readiness` on Jan 29
- Express deprecation: Feb 4

**DIVERGENCE ANALYSIS:**
- Only 1 event unique to `TangoTiempo` (created Feb 17 post-cutover)
- 15 events unique to `TangoTiempoProd` (created June 2025, intentionally deleted from LIVE)
- Most event difference (81 of 95) is AI-discovered events in `TangoTiempoProd` not synced to `TangoTiempo`

---

### 2026-02-17 17:30 EST - Full Analysis Complete

**ANALYSIS COMPLETE**: See [FULL-ANALYSIS-REPORT.md](./FULL-ANALYSIS-REPORT.md)

**KEY FINDINGS:**

| Metric | Value |
|--------|-------|
| Organizer-created events identical in both databases | 995 (99.4%) |
| Events with field differences | 6 (all AZUL, `isActive` flag) |
| Events unique to `TangoTiempo` | 1 (test event) |
| Events unique to `TangoTiempoProd` | 15 (13 old + 2 future HJ) |
| Userlogins to copy | 17 |

**RECONCILIATION IS SIMPLER THAN EXPECTED:**

The original plan assumed organizer-by-organizer reconciliation would be needed. Analysis shows:
- 22 organizers have **identical data** - no action needed
- Only **AZUL** has field differences (6 events need `isActive` update)
- 7 organizers have **old events to delete** from `TangoTiempoProd`
- **17 userlogins** need to be copied from `TangoTiempo` → `TangoTiempoProd`

**ACTIONS IDENTIFIED:**

| Action | Database | Description |
|--------|----------|-------------|
| ACTION-001 | `TangoTiempoProd` | Update 6 AZUL events: `isActive: false` |
| ACTION-002 | `TangoTiempoProd` | Delete 13 old events (March 2024) |
| ACTION-003 | `TangoTiempo` | Delete YBOTMAN test event (optional) |
| ACTION-004 | `TangoTiempoProd` | Copy 17 userlogins |

**AWAITING**: Gotan approval to execute actions.

---
