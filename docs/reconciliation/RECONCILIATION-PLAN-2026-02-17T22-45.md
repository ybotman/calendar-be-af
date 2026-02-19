# Reconciliation Plan: TangoTiempoProd Database Restoration

**Plan Created**: 2026-02-17T22:45:00Z (Mon Feb 17, 2026 5:45 PM EST)
**Status**: DRAFT - Awaiting Approval
**Author**: Fulton (Azure Functions Backend Agent)

---

## Executive Summary

15 days ago (~Jan 29, 2026), Azure Functions PROD was accidentally pointed to `TangoTiempo` instead of `TangoTiempoProd`. During this period, LIVE users made changes to the wrong database. This plan restores those changes to the correct database before swapping back.

---

## Current State

| Environment | Database | Status |
|-------------|----------|--------|
| Azure `calendarbeaf-prod` | → TangoTiempo | **WRONG** (should be TangoTiempoProd) |
| LIVE site (tangotiempo.com) | → TangoTiempo | Users making changes here |
| TEST site (test.tangotiempo.com) | → TangoTiempoProd | Stable, no user activity |

## Target State (After Plan Execution)

| Environment | Database | Status |
|-------------|----------|--------|
| Azure `calendarbeaf-prod` | → TangoTiempoProd | **CORRECT** |
| LIVE site (tangotiempo.com) | → TangoTiempoProd | Users will use this |
| TEST site (test.tangotiempo.com) | → TangoTiempo | Dev/test only |

---

## Data Sources

| Source | Description |
|--------|-------------|
| `TangoTiempo.events_backup_2026-02-17T05-46-30-560Z` | Backup of LIVE data (1,023 user events) |
| `TangoTiempoProd.events` | Current target database (1,016 user events) |

---

## Changes to Apply

### ✅ EVENTS TO INSERT (7 real events)

| # | Organizer | Title | Event Date | ID |
|---|-----------|-------|------------|-----|
| 1 | ACADEMY | "LA SOCIAL" | Feb 18, 2026 | `698e38e63b4aba65674f8885` |
| 2 | AFFAIR | "INT/ADV classes, TangoAffair" | Feb 24, 2026 | `698cf499af6501609242a4d0` |
| 3 | MILT-CORI | "Milonga NUEVA!" | Mar 7, 2026 | `6992474928188fc892ab153a` |
| 4 | MILT-CORI | "Milonga NUEVA!" | Apr 4, 2026 | `699247fa28188fc892ab153b` |
| 5 | MILT-CORI | "Milonga NUEVA!" | May 2, 2026 | `6992489bfb0f669d31e1336f` |
| 6 | ROGER | "Foundry Festival Milonga Demo" | Feb 21, 2026 | `6989f0c480cbd93808776b50` |
| 7 | SOCIETY | "VICKY'S 70th BIRTHDAY PARTY" | Mar 28, 2026 | `6992c09fd7738f471b9a25c9` |

**EXCLUDED (test data):**
- ADRIANAPIN "sdf" - junk test
- YBOTMAN "TST" - junk test

### ✏️ EVENTS TO UPDATE (10 modified events)

These events exist in both databases but the backup has a newer version:

| Organizer | Title | Event Date | ID |
|-----------|-------|------------|-----|
| UNKNOWN | "Milonga Poema" | Feb 13, 2026 | `6853312aa1e3cfb6f8bba992` |
| AZUL | "Milonga Sal Azul" | Feb 19, 2026 | `68533136a1e3cfb6f8bba9ec` |
| SOCIETY | ""TANGO BAR" MILONGA" | Feb 20, 2026 | `68533137a1e3cfb6f8bba9f1` |
| SOCIETY | "LA MILONGA Dancing" | Feb 21, 2026 | `68533139a1e3cfb6f8bbaa0a` |
| AFFAIR | "Special pre-milonga workshop" | Feb 27, 2026 | `68533143a1e3cfb6f8bbaa55` |
| AFFAIR | "VIDA MIA MILONGA" | Feb 27, 2026 | `68533143a1e3cfb6f8bbaa5a` |
| HSUEH-TZE | "Blue Milonga" | Feb 14, 2026 | `6934ac4f23298e275c0aff32` |
| CORAZON | "Tango Practica Corazón" | Feb 12, 2026 | `6949ac912788114be0e55f57` |
| CORAZON | "La Malena" | Mar 1, 2026 | `6949aefb2788114be0e56868` |
| MILT-CORI | "Milonga NUEVA: Feel the LOVE <3" | Feb 7, 2026 | `69519a37ce226952160abe28` |

### 👥 USERLOGINS TO ADD (17 new users)

| Firebase UID | MongoDB ID |
|--------------|------------|
| NkZKrURW5YXKd8DIHFwlHpR49ty2 | `683f48696a45dc35c4f32f8b` |
| KQ8KM0YEbXO4ZRxM6EYYeSF3H1n1 | `68ceed93735367db820c5280` |
| c64iyovWSVPNHF9OX3U0q5RAzGF2 | `68cf66b1735367db820defd7` |
| voTQnvDLiDOwfukUmHlFSDcNzSR2 | `68cf6749735367db820df847` |
| 0YJZlEY5ctdosApAEyq8Qdp4cpd2 | `68d0b71f735367db8210d1de` |
| xMvcIV5nA8P6CHJb3ArrGE78TC03 | `68d42ccbac8fbf239816e731` |
| E7exTzXemtWrUiEYUKILh8aacJ72 | `68d42cfeac8fbf239816eb9e` |
| JYn7FamLNafweR1S4dtNKK2QR0Y2 | `68d5871cac8fbf23981798a7` |
| 8AlAgkb0TCZF9p6hN6ER42rDbGd2 | `68d5874cac8fbf2398179b37` |
| 7ysVrcT6SaZ5DLO4Fx8rIvzE0kf2 | `68d58770ac8fbf2398179dc7` |
| 0iHJIMno9ES18C0W3ifLXNQVUYr1 | `68dd56637b9557fa0959c7b1` |
| 4ouaYyFZY3eiKorWZidoKmFWU5t1 | `6903871752f8e417933b5040` |
| cc0j07NnggWPCcOsb6aOi8AatVs2 | `6965be097fec9b87c11d1a47` |
| RAwXfWmNdQcV848Exiuxoo2kRBI3 | `6967083a0f02e0f3b7e42f6b` |
| NJirrGbOzuY0wckkbLnVIP49NZK2 | `6986d1d8d697b0c6fcb993ad` |
| Q8Bydfq4ZMXrBkam1ZeyqaURx4b2 | `69934b979cbad5b2761954c9` |
| tiKEJCWnw6ZS0elSXJZBzlNR0gH3 | `6994d56de8f31046140b72af` |

### 👤 ORGANIZERS

**No changes needed** - Both databases have 59 organizers.

Note: MCRISTINA was deleted but we are NOT deleting it from TangoTiempoProd.

### 🏢 VENUES

**No changes needed** - Both databases have 584 venues.

### 🔄 IGNORED (Will Re-run)

- All `isDiscovered=true` events
- AI-discovered venues from FB Conditioner pipeline
- These will be repopulated by running the FB Conditioner pipeline

---

## Execution Plan

### Phase 1: Pre-Flight Checks
- [ ] Verify backup collection exists and is readable
- [ ] Verify TangoTiempoProd is accessible
- [ ] Create new backup of TangoTiempoProd.events before changes
- [ ] Confirm event counts match expectations

### Phase 2: Insert 7 New Events
```javascript
// Source: TangoTiempo.events_backup_2026-02-17T05-46-30-560Z
// Target: TangoTiempoProd.events

const eventsToInsert = [
  '698e38e63b4aba65674f8885', // ACADEMY - LA SOCIAL
  '698cf499af6501609242a4d0', // AFFAIR - INT/ADV classes
  '6992474928188fc892ab153a', // MILT-CORI - Milonga NUEVA! (Mar 7)
  '699247fa28188fc892ab153b', // MILT-CORI - Milonga NUEVA! (Apr 4)
  '6992489bfb0f669d31e1336f', // MILT-CORI - Milonga NUEVA! (May 2)
  '6989f0c480cbd93808776b50', // ROGER - Foundry Festival
  '6992c09fd7738f471b9a25c9', // SOCIETY - VICKY'S 70th BIRTHDAY
];
```

### Phase 3: Update 10 Modified Events
Replace existing events with newer versions from backup.

### Phase 4: Add 17 Userlogins
Copy userlogin documents from TangoTiempo to TangoTiempoProd.

### Phase 5: Swap Azure Functions
- [ ] Update Azure `calendarbeaf-prod` to point to `TangoTiempoProd`
- [ ] Verify connection
- [ ] Test API endpoints

### Phase 6: Verification
- [ ] Confirm event counts
- [ ] Spot check specific events
- [ ] Verify userlogins work
- [ ] Check LIVE site functionality

### Phase 7: Re-run FB Conditioner (if needed)
- [ ] Run FB Conditioner pipeline to repopulate discovered events

---

## Rollback Plan

If issues occur:
1. Revert Azure `calendarbeaf-prod` back to `TangoTiempo`
2. Events restored from backup remain in TangoTiempoProd (no harm)
3. Investigate and retry

---

## Summary Counts

| Action | Count |
|--------|-------|
| Events to INSERT | 7 |
| Events to UPDATE | 10 |
| Userlogins to ADD | 17 |
| Organizers | 0 (no changes) |
| Venues | 0 (no changes) |

**Total database operations**: 34

---

## Approvals Required

| Role | Name | Approval |
|------|------|----------|
| Arbiter | Gotan | [ ] Pending |
| Coordinator | Quinn | [ ] Pending |
| Executor | Fulton | Ready to execute |

---

## Document History

| Timestamp | Action |
|-----------|--------|
| 2026-02-17T22:45:00Z | Plan created |

---

**NO CHANGES WILL BE MADE UNTIL ALL APPROVALS ARE RECEIVED**
