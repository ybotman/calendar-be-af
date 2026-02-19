# Reconciliation Plan: Re-point Azure Functions + Insert Delta

**Plan Created**: 2026-02-17T23:45:00Z (Mon Feb 17, 2026 6:45 PM EST)
**Status**: DRAFT - Awaiting Approval
**Author**: Fulton (Azure Functions Backend Agent)

---

## Executive Summary

1. **Re-point** Azure Functions PROD to TangoTiempoProd (the correct database)
2. **Insert 10 documents** from backup to bring TangoTiempoProd up to date with 15-day changes

---

## Step 1: Re-point Azure Functions

| Setting | Current (Wrong) | Target (Correct) |
|---------|-----------------|------------------|
| `calendarbeaf-prod` MONGODB_URI | → TangoTiempo | → **TangoTiempoProd** |

---

## Step 2: Insert Delta

### EVENTS (7 to INSERT)

| Source DB | Source Collection |
|-----------|-------------------|
| TangoTiempo | `events_backup_2026-02-17T05-46-30-560Z` |

| Target DB | Target Collection |
|-----------|-------------------|
| TangoTiempoProd | `events` |

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

| Source DB | Source Collection |
|-----------|-------------------|
| TangoTiempo | `userlogins` |

| Target DB | Target Collection |
|-----------|-------------------|
| TangoTiempoProd | `userlogins` |

| # | Name | Email | Created | ID |
|---|------|-------|---------|-----|
| 1 | Cyla Bagolan | cylabagolan@gmail.com | Feb 16, 2026 | `69934b979cbad5b2761954c9` |
| 2 | Elena Getmanova | egetmanova@gmail.com | Feb 17, 2026 | `6994d56de8f31046140b72af` |

---

### ORGANIZERS (1 to INSERT)

| Source DB | Source Collection |
|-----------|-------------------|
| TangoTiempo | `organizers_backup_2026-02-17T05-46-29-565Z` |

| Target DB | Target Collection |
|-----------|-------------------|
| TangoTiempoProd | `organizers` |

| # | ShortName | Name | Created | ID |
|---|-----------|------|---------|-----|
| 1 | MCRISTINA | Maria Cristina | Feb 11, 2026 | `698cfe764a84997face5052c` |

---

### VENUES

**No action** - Will re-run FB Conditioner to repopulate discovered venues.

---

## Summary

| Collection | Source | Action | Count |
|------------|--------|--------|-------|
| events | TangoTiempo.events_backup_2026-02-17T05-46-30-560Z | INSERT | 7 |
| userlogins | TangoTiempo.userlogins | INSERT | 2 |
| organizers | TangoTiempo.organizers_backup_2026-02-17T05-46-29-565Z | INSERT | 1 |
| venues | - | SKIP | 0 |
| **TOTAL** | | | **10** |

---

## IDs Summary (for script)

```javascript
// EVENTS - from TangoTiempo.events_backup_2026-02-17T05-46-30-560Z
const eventIds = [
  '698e38e63b4aba65674f8885', // ACADEMY - LA SOCIAL
  '698cf499af6501609242a4d0', // AFFAIR - INT/ADV classes
  '6992474928188fc892ab153a', // MILT-CORI - Milonga NUEVA! (Mar 7)
  '699247fa28188fc892ab153b', // MILT-CORI - Milonga NUEVA! (Apr 4)
  '6992489bfb0f669d31e1336f', // MILT-CORI - Milonga NUEVA! (May 2)
  '6989f0c480cbd93808776b50', // ROGER - Foundry Festival
  '6992c09fd7738f471b9a25c9', // SOCIETY - VICKY'S 70th BIRTHDAY
];

// USERLOGINS - from TangoTiempo.userlogins
const userloginIds = [
  '69934b979cbad5b2761954c9', // Cyla Bagolan
  '6994d56de8f31046140b72af', // Elena Getmanova
];

// ORGANIZERS - from TangoTiempo.organizers_backup_2026-02-17T05-46-29-565Z
const organizerIds = [
  '698cfe764a84997face5052c', // MCRISTINA
];
```

---

## Execution Order

### Phase 1: Pre-Flight
- [ ] Verify backup collections exist and are readable
- [ ] Create fresh backup of TangoTiempoProd before changes

### Phase 2: Re-point Azure Functions
- [ ] Update `calendarbeaf-prod` connection string to TangoTiempoProd
- [ ] Verify connection works

### Phase 3: Insert Delta
- [ ] Insert 7 events from backup → TangoTiempoProd.events
- [ ] Insert 2 userlogins from current → TangoTiempoProd.userlogins
- [ ] Insert 1 organizer from backup → TangoTiempoProd.organizers

### Phase 4: Verification
- [ ] Confirm document counts
- [ ] Spot check inserted documents on LIVE site
- [ ] Verify Cyla and Elena can log in
- [ ] Verify MCRISTINA organizer appears

### Phase 5: Later
- [ ] Re-run FB Conditioner for discovered events/venues

---

## Approvals Required

| Role | Name | Approval |
|------|------|----------|
| Arbiter | Gotan | [ ] Pending |

---

**NO CHANGES WILL BE MADE UNTIL APPROVED**
