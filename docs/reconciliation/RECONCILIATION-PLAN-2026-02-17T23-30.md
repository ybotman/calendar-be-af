# Reconciliation Plan: Re-point Azure Functions + Insert Delta

**Plan Created**: 2026-02-17T23:30:00Z (Mon Feb 17, 2026 6:30 PM EST)
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
- TangoTiempoProd becomes the real PROD database (15 days behind, then we apply delta)

---

## Step 2: Insert Delta from Backup

### EVENTS (7 to INSERT)

**Source**: `TangoTiempo.events_backup_2026-02-17T05-46-30-560Z`
**Target**: `TangoTiempoProd.events`

| # | Organizer | Title | Event Date | ID |
|---|-----------|-------|------------|-----|
| 1 | ACADEMY | "LA SOCIAL" | Feb 18, 2026 | `698e38e63b4aba65674f8885` |
| 2 | AFFAIR | "INT/ADV classes, TangoAffair" | Feb 24, 2026 | `698cf499af6501609242a4d0` |
| 3 | MILT-CORI | "Milonga NUEVA!" | Mar 7, 2026 | `6992474928188fc892ab153a` |
| 4 | MILT-CORI | "Milonga NUEVA!" | Apr 4, 2026 | `699247fa28188fc892ab153b` |
| 5 | MILT-CORI | "Milonga NUEVA!" | May 2, 2026 | `6992489bfb0f669d31e1336f` |
| 6 | ROGER | "Foundry Festival Milonga Demo" | Feb 21, 2026 | `6989f0c480cbd93808776b50` |
| 7 | SOCIETY | "VICKY'S 70th BIRTHDAY PARTY" | Mar 28, 2026 | `6992c09fd7738f471b9a25c9` |

---

### USERLOGINS (2 to INSERT)

**Source**: `TangoTiempo.userlogins`
**Target**: `TangoTiempoProd.userlogins`

| # | Name | Email | Created | ID |
|---|------|-------|---------|-----|
| 1 | Cyla Bagolan | cylabagolan@gmail.com | Feb 16, 2026 | `69934b979cbad5b2761954c9` |
| 2 | Elena Getmanova | egetmanova@gmail.com | Feb 17, 2026 | `6994d56de8f31046140b72af` |

**Note**: Other "differences" between databases are trivial sync metadata (timestamps, userDefaults) - not worth updating.

---

### ORGANIZERS (2 to INSERT)

**Source**: `TangoTiempo.organizers_backup_2026-02-17T05-46-29-565Z`
**Target**: `TangoTiempoProd.organizers`

| # | ShortName | ID |
|---|-----------|-----|
| 1 | UNK | `6982c3c9cd86da3c9644fc99` |
| 2 | MCRISTINA | `698cfe764a84997face5052c` |

---

### VENUES

**No action** - Will re-run FB Conditioner to repopulate discovered venues.

---

## Summary

| Collection | Action | Count |
|------------|--------|-------|
| events | INSERT | 7 |
| userlogins | INSERT | 2 |
| organizers | INSERT | 2 |
| venues | SKIP | 0 |
| **TOTAL** | | **11 documents** |

---

## Execution Order

### Phase 1: Pre-Flight
- [ ] Verify backup collections exist
- [ ] Create fresh backup of TangoTiempoProd before changes

### Phase 2: Re-point Azure Functions
- [ ] Update `calendarbeaf-prod` connection string to TangoTiempoProd
- [ ] Verify connection

### Phase 3: Insert Delta
- [ ] Insert 7 events
- [ ] Insert 2 userlogins
- [ ] Insert 2 organizers

### Phase 4: Verification
- [ ] Confirm counts
- [ ] Spot check on LIVE site

### Phase 5: Later
- [ ] Re-run FB Conditioner for discovered events/venues

---

## Approvals Required

| Role | Name | Approval |
|------|------|----------|
| Arbiter | Gotan | [ ] Pending |

---

**NO CHANGES WILL BE MADE UNTIL APPROVED**
