# Reconciliation Plan: Re-point Azure Functions + Insert Delta

**Plan Created**: 2026-02-17T23:00:00Z (Mon Feb 17, 2026 6:00 PM EST)
**Status**: DRAFT - Awaiting Approval
**Author**: Fulton (Azure Functions Backend Agent)

---

## Executive Summary

1. **Re-point** Azure Functions PROD to TangoTiempoProd (the correct database)
2. **Insert delta** from backup to bring TangoTiempoProd up to date with 15-day changes

---

## Step 1: Re-point Azure Functions

| Setting | Current (Wrong) | Target (Correct) |
|---------|-----------------|------------------|
| `calendarbeaf-prod` MONGODB_URI | → TangoTiempo | → **TangoTiempoProd** |

After this change:
- LIVE site (tangotiempo.com) will use TangoTiempoProd
- TangoTiempoProd becomes the real PROD database

---

## Step 2: Insert Delta from Backup

**Source**: `TangoTiempo.events_backup_2026-02-17T05-46-30-560Z` (and other backup collections)
**Target**: `TangoTiempoProd` (all collections)

### Outer Join Analysis Results

| Collection | Backup | TTP | To INSERT | Keep in TTP |
|------------|--------|-----|-----------|-------------|
| events | 1,023 | 1,016 | 7 real | 2 |
| organizers | 60 | 59 | 2 | 1 |
| userlogins | 48 | 46 | 17 | 15 |
| venues | 400 | 584 | 0* | 507 |
| masteredcities | 215 | 215 | 0* | 3 |
| masteredcountries | 51 | 51 | 0* | 3 |
| mastereddivisions | 67 | 67 | 0* | 6 |
| masteredregions | 38 | 38 | 0* | 1 |
| categories | 21 | 21 | 0 | 0 |
| roles | 11 | 11 | 0 | 0 |

*\*Venues and mastered data will be repopulated by FB Conditioner - no manual insert needed*

---

## Delta to Insert

### EVENTS (7 real events)

| # | Organizer | Title | Event Date | ID |
|---|-----------|-------|------------|-----|
| 1 | ACADEMY | "LA SOCIAL" | Feb 18, 2026 | `698e38e63b4aba65674f8885` |
| 2 | AFFAIR | "INT/ADV classes, TangoAffair" | Feb 24, 2026 | `698cf499af6501609242a4d0` |
| 3 | MILT-CORI | "Milonga NUEVA!" | Mar 7, 2026 | `6992474928188fc892ab153a` |
| 4 | MILT-CORI | "Milonga NUEVA!" | Apr 4, 2026 | `699247fa28188fc892ab153b` |
| 5 | MILT-CORI | "Milonga NUEVA!" | May 2, 2026 | `6992489bfb0f669d31e1336f` |
| 6 | ROGER | "Foundry Festival Milonga Demo" | Feb 21, 2026 | `6989f0c480cbd93808776b50` |
| 7 | SOCIETY | "VICKY'S 70th BIRTHDAY PARTY" | Mar 28, 2026 | `6992c09fd7738f471b9a25c9` |

**EXCLUDED** (test data):
- ADRIANAPIN "sdf"
- YBOTMAN "TST"

### ORGANIZERS (2 to insert)

| ShortName | ID |
|-----------|-----|
| UNK | `6982c3c9cd86da3c9644fc99` |
| MCRISTINA | `698cfe764a84997face5052c` |

### USERLOGINS (17 new users)

| Firebase UID | ID |
|--------------|-----|
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

---

## What We Are NOT Doing

| Item | Reason |
|------|--------|
| Insert test events (sdf, TST) | Junk data |
| Insert/update venues | Will re-run FB Conditioner |
| Insert mastered geo data | Will re-run FB Conditioner |
| Delete anything from TTP | Additive only |
| Update existing documents | Insert only (field comparison TBD) |

---

## Execution Order

### Phase 1: Pre-Flight
- [ ] Verify backup collections are readable
- [ ] Create fresh backup of TangoTiempoProd before changes
- [ ] Document current state

### Phase 2: Re-point Azure Functions
- [ ] Update `calendarbeaf-prod` connection string to TangoTiempoProd
- [ ] Verify connection works
- [ ] Test basic API calls

### Phase 3: Insert Delta
- [ ] Insert 7 events into TangoTiempoProd.events
- [ ] Insert 2 organizers into TangoTiempoProd.organizers
- [ ] Insert 17 userlogins into TangoTiempoProd.userlogins

### Phase 4: Verification
- [ ] Confirm event counts
- [ ] Spot check inserted events on LIVE site
- [ ] Verify user logins work

### Phase 5: Post-Reconciliation (Later)
- [ ] Re-run FB Conditioner to repopulate discovered events
- [ ] Field-by-field comparison of "in both" documents (if needed)

---

## Summary Counts

| Action | Count |
|--------|-------|
| Events to INSERT | 7 |
| Organizers to INSERT | 2 |
| Userlogins to INSERT | 17 |
| **Total INSERTs** | **26** |

---

## Rollback Plan

If issues after re-pointing:
1. Revert `calendarbeaf-prod` connection string back to TangoTiempo
2. Inserted documents remain in TangoTiempoProd (no harm)
3. Investigate and retry

---

## Open Questions

1. **Field-by-field comparison**: Do we need to UPDATE the 1,014 events that exist in both? Or are they identical?
2. **Userlogin updates**: 10 userlogins exist in both but have different updatedAt - do we need to merge changes?

---

## Approvals Required

| Role | Name | Approval |
|------|------|----------|
| Arbiter | Gotan | [ ] Pending |
| Coordinator | Quinn | [ ] Pending |
| Executor | Fulton | Ready to execute |

---

**NO CHANGES WILL BE MADE UNTIL APPROVED**
