# Reconciliation Action Plan

**Created**: 2026-02-17
**Author**: Fulton (AI Agent) + Gotan
**Status**: DRAFT - REQUIRES APPROVAL

---

## Executive Summary

The Azure Functions environment pointers are backwards. This plan:
1. Documents current state
2. Plans pointer correction
3. Lists data migrations by organizer (one row at a time)

---

## Phase 0: Current State (PROBLEM)

### Database Naming Confusion

| What We Call It | Database Name | Actually Used By |
|-----------------|---------------|------------------|
| "TEST" | `TangoTiempo` | **LIVE tangotiempo.com** |
| "PROD" | `TangoTiempoProd` | Local dev only |

### Azure Function Apps

| App | URL | Points To | Should Point To |
|-----|-----|-----------|-----------------|
| `calendarbeaf-prod` | calendarbeaf-prod.azurewebsites.net | `TangoTiempo` (LIVE) | ✅ Correct for LIVE |
| `calendar-be-af` | calendar-be-af.azurewebsites.net | `TangoTiempoProd` | Local dev |

### Vercel (Frontend)

```
NEXT_PUBLIC_AF_URL = https://calendarbeaf-prod.azurewebsites.net
```
→ Frontend correctly points to LIVE Azure app → LIVE database

### The Mix-up

~3 weeks ago, during backend migration to Azure Functions:
- Environment variable naming got confused
- `MONGODB_URI_PROD` in local.settings.json points to `TangoTiempoProd`
- `MONGODB_URI_TEST` points to `TangoTiempo` (actual LIVE!)
- Some changes made via direct DB access, some via functions
- Data diverged between databases

---

## Phase 1: Fix Environment Variable Naming (LOCAL ONLY)

**DO NOT TOUCH AZURE APP SETTINGS** - those are correct for production.

### Action 1.1: Update local.settings.json naming for clarity

Current confusing names:
```json
{
  "MONGODB_URI_PROD": "...TangoTiempoProd...",  // Actually local dev
  "MONGODB_URI_TEST": "...TangoTiempo..."       // Actually LIVE!
}
```

Proposed clear names:
```json
{
  "MONGODB_URI_LIVE": "...TangoTiempo...",      // LIVE site
  "MONGODB_URI_DEV": "...TangoTiempoProd..."    // Local dev
}
```

**STATUS**: [ ] Not started

---

## Phase 2: Data Migration Plan

### Strategy

1. **Source of Truth**: `TangoTiempo` (LIVE) - this is what users see
2. **Target for sync**: `TangoTiempoProd` (DEV) - bring it up to match LIVE
3. **Direction**: LIVE → DEV (not the other way!)
4. **Method**: One document at a time, with verification

### Why LIVE → DEV?

- LIVE has user-created events (your TEST event, Alex's Sal Azul, etc.)
- LIVE is what the website shows
- DEV should mirror LIVE for local testing

---

## Phase 3: Organizer-by-Organizer Action List

### Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Keep in LIVE, copy to DEV |
| ❌ | Delete from both (test/junk data) |
| 🔄 | Already in sync |
| ⚠️ | Review needed |
| 🗑️ | Intentionally deleted, do not restore |

---

### 3.1 Milonga Sal Azul Team (AZUL)

**Decision**: 🗑️ Old weekly events were intentionally deleted by Gotan

| ID | Title | Start Date | Action |
|----|-------|------------|--------|
| bba68b | Milonga Sal Azul | 2025-12-19 | 🗑️ Do not restore |
| bba6ef | Milonga Sal Azul | 2025-12-26 | 🗑️ Do not restore |
| bba758 | Milonga Sal Azul | 2026-01-02 | 🗑️ Do not restore |
| bba7b2 | Milonga Sal Azul | 2026-01-09 | 🗑️ Do not restore |
| bba811 | Milonga Sal Azul | 2026-01-16 | 🗑️ Do not restore |
| bba875 | Milonga Sal Azul | 2026-01-23 | 🗑️ Do not restore |
| bba8de | Milonga Sal Azul | 2026-01-30 | 🗑️ Do not restore |
| bba933 | Milonga Sal Azul | 2026-02-06 | 🗑️ Do not restore |

**Note**: Alex (Alexander Prokhorov) added monthly "Sal Azul Milonga" to replace these.

---

### 3.2 Alexander Prokhorov (ALEX) - Sal Azul Monthly

**Decision**: ✅ Keep - legitimate new monthly events

| ID | Title | Start Date | In LIVE | In DEV | Action |
|----|-------|------------|---------|--------|--------|
| c63ec5 | Sal Azul Milonga | 2025-11-07 | ✅ | ✅ | 🔄 In sync |

---

### 3.3 Hsueh-tze Lee - Blue Milonga

**Decision**: ✅ Keep - legitimate monthly Blue Milonga events

| ID | Title | Start Date | In LIVE | In DEV | Action |
|----|-------|------------|---------|--------|--------|
| 0afe25 | Blue Milonga | 2026-01-11 | ✅ | ✅ | 🔄 In sync |
| 0aff32 | Blue Milonga | 2026-02-15 | ✅ | ✅ | 🔄 In sync |
| 0b0234 | Blue Milonga | 2026-03-15 | ✅ | ✅ | 🔄 In sync |
| 0b02ba | Blue Milonga | 2026-04-12 | ✅ | ✅ | 🔄 In sync |

---

### 3.4 Simonida Cekovic-Vuletic (AFFAIR) - Tango Affair / Vida Mia

**Decision**: ✅ Keep new events, 🗑️ old RRULE-expanded events

| ID | Title | Start Date | Status | Action |
|----|-------|------------|--------|--------|
| e53eef | SPECIAL PRE-MILONGA WORKSHOP | 2025-12-27 | In LIVE+DEV | 🔄 In sync |
| e53d1f | Vida Mia HOLIDAY PARTY | 2025-12-27 | In LIVE+DEV | 🔄 In sync |
| 0afa54 | Pre-milonga workshop | 2026-01-31 | In LIVE+DEV | 🔄 In sync |
| 0afda4 | VIDA MIA 5TH FRI EDITION | 2026-01-31 | In LIVE+DEV | 🔄 In sync |
| 42a4d0 | INT/ADV classes, TangoAffair | 2026-02-25 | BKP-0217 only | ⚠️ Review - deleted after Feb 17 |

**Old RRULE-expanded (in BKP-0131 only)**:
| ID | Title | Action |
|----|-------|--------|
| bba6f4 | Special pre-milonga workshop | 🗑️ Old expanded, replaced |
| bba6f9 | VIDA MIA MILONGA | 🗑️ Old expanded, replaced |
| bba87a | Special pre-milonga workshop | 🗑️ Old expanded, replaced |
| bba87f | VIDA MIA MILONGA | 🗑️ Old expanded, replaced |

---

### 3.5 Milton and Corin (MILT-CORI) - Milonga NUEVA

**Decision**: ✅ Keep - legitimate monthly events

| ID | Title | Start Date | In LIVE | In DEV | Action |
|----|-------|------------|---------|--------|--------|
| 0ac3c3 | Milonga NUEVA 2026 | 2026-01-04 | ✅ | ✅ | 🔄 In sync |
| 0182a1 | Milonga NUEVA: Feel the LOVE! | 2026-02-08 | ✅ | ✅ | 🔄 In sync |
| 0abe28 | Milonga NUEVA! | 2026-03-08 | ✅ | ✅ | 🔄 In sync |

**Milton Azevedo duplicates (BKP-0217 only)**:
| ID | Title | Action |
|----|-------|--------|
| ab153a | Milonga NUEVA! (Mar 8) | 🗑️ Duplicate, do not restore |
| ab153b | Milonga NUEVA! (Apr 5) | 🗑️ Duplicate, do not restore |

---

### 3.6 Guillermo Merlo (GMERLO) - NOCHE DE PRÁCTICA

**Decision**: ⚠️ Review - These are old RRULE-expanded Tuesday events

| ID | Title | Start Date | Status | Action |
|----|-------|------------|--------|--------|
| bba9ce | NOCHE DE PRÁCTICA | 2026-02-18 | BKP-0131 only | ⚠️ Check if RRULE replacement exists |
| bbaa32 | NOCHE DE PRÁCTICA | 2026-02-25 | BKP-0131 only | ⚠️ Check if RRULE replacement exists |
| bbaa9b | NOCHE DE PRÁCTICA | 2026-03-04 | BKP-0131 only | ⚠️ Check if RRULE replacement exists |
| bbaaf5 | NOCHE DE PRÁCTICA | 2026-03-10 | BKP-0131 only | ⚠️ Check if RRULE replacement exists |
| bbab54 | NOCHE DE PRÁCTICA | 2026-03-17 | BKP-0131 only | ⚠️ Check if RRULE replacement exists |
| bbabb8 | NOCHE DE PRÁCTICA | 2026-03-24 | BKP-0131 only | ⚠️ Check if RRULE replacement exists |
| bbac21 | NOCHE DE PRÁCTICA | 2026-03-31 | BKP-0131 only | ⚠️ Check if RRULE replacement exists |
| bbac7b | NOCHE DE PRÁCTICA | 2026-04-07 | BKP-0131 only | ⚠️ Check if RRULE replacement exists |
| bbacda | NOCHE DE PRÁCTICA | 2026-04-14 | BKP-0131 only | ⚠️ Check if RRULE replacement exists |

**TODO**: Query LIVE for `isRepeating: true` events with similar title to see if replaced.

---

### 3.7 Tango Practica Corazón (CORAZON)

**Decision**: ✅ Keep - legitimate bi-weekly practicas

| ID | Title | Start Date | Action |
|----|-------|------------|--------|
| e4f63a | Tango Practica Corazón | 2026-01-08 | 🔄 In sync |
| e55f57 | Tango Practica Corazón | 2026-02-12 | 🔄 In sync |
| e4f721 | Tango Practica Corazón | 2026-02-26 | 🔄 In sync |
| e56868 | La Malena | 2026-03-01 | 🔄 In sync |
| e4f7dc | Tango Practica Corazón | 2026-03-12 | 🔄 In sync |
| e4f894 | Tango Practica Corazón | 2026-03-19 | 🔄 In sync |
| e56a15 | La Malena | 2026-03-29 | 🔄 In sync |
| e4f94c | Tango Practica Corazón | 2026-04-02 | 🔄 In sync |
| e4fa06 | Tango Practica Corazón | 2026-04-16 | 🔄 In sync |

---

### 3.8 Toby Balsley (YBOTMAN / TOBY)

**Decision**: Mixed - keep real events, delete test data

**Keep**:
| ID | Title | Start Date | Action |
|----|-------|------------|--------|
| f19c35 | Sunday practica | 2026-01-25 | 🔄 In sync |
| f1c54c | ACADEMY CLASSES are CNCLD | 2026-02-07 | 🔄 In sync |
| ef6dcb | TEST | 2026-02-20 | ✅ LIVE only - copy to DEV if needed |

**Delete (test/junk)**:
| ID | Title | Action |
|----|-------|--------|
| bf534a | TEST - IGNORE | ❌ Delete from all |
| dcc834 | 23 | ❌ Delete from all |
| 318171 | aa | ❌ Delete from all |
| fc9df6 | 2026-03-09, | ❌ Delete from all |
| 318170 | sd | ❌ Delete from all |
| 8c0865 | NEW!! MILONGA : BAILAMOS! | ⚠️ Review - was this real? |
| 62ddb4 | TST | ❌ Delete from all |

---

### 3.9 Test/Junk Data (Various Organizers)

**Decision**: ❌ Delete all

| ID | Title | Organizer | Action |
|----|-------|-----------|--------|
| e47ce9 | sdf | Adriana Pinto | ❌ Delete |
| 31816f | sdf | Andi Babbs | ❌ Delete |
| 4f8885 | LA SOCIAL | Mia Dalglish | ⚠️ Review |
| fc9df5 | 12 | Sue Davis | ❌ Delete |
| cd2206 | 324 | Sue Davis | ❌ Delete |
| 776b50 | Foundry Festival Milonga Demo | Roger Wood | ⚠️ Review - was this real? |
| 9a25c9 | VICKY'S 70th BIRTHDAY PARTY | Vicky Magaletta | ⚠️ Review - was this real? |

---

### 3.10 Events Already In Sync (No Action Needed)

These organizers' events are already consistent between LIVE and DEV:

- **MIT Tango Club**: 6 events ✅
- **Queer Tango Boston**: 3 events ✅
- **Tango Academy of Boston**: 6 events ✅
- **Tango Society of Boston**: 4 events ✅
- **TangoSpark**: 3 events ✅
- **Ultimate Tango**: 6 events ✅
- **Henry Lappen**: 2 events ✅
- **Laura Grandi**: 2 events ✅
- **Andi Babbs**: 5 events ✅

---

## Phase 4: Execution Checklist

### Pre-Execution

- [ ] Review this plan with Gotan
- [ ] Confirm each ⚠️ decision
- [ ] Create backup of current LIVE and DEV databases
- [ ] Test database connectivity

### Execution Order

1. [ ] **Delete test/junk data** from LIVE (if any exists there)
2. [ ] **Sync LIVE → DEV** for events in sync
3. [ ] **Handle LIVE ONLY events** (copy to DEV)
4. [ ] **Handle DEV ONLY events** (delete or keep per decision)
5. [ ] **Verify counts match**

### Post-Execution

- [ ] Run reconciliation scripts again to verify
- [ ] Test frontend with both databases
- [ ] Update local.settings.json naming
- [ ] Document final state

---

## Phase 5: Venues Reconciliation

**860 venue deltas** - mostly AI-discovered venues.

### Summary

| Status | Count | Action |
|--------|-------|--------|
| ADDED (after Jan 31) | 519 | ✅ Keep - AI discovered |
| DELETED (after Feb 17) | 323 | ⚠️ Review |
| DELETED (old) | 17 | 🗑️ Old test data |
| RESTORED | 1 | ✅ Dance Union |

### Key Venue: Dance Union

- ID: `5b57c1`
- Status: RESTORED (in LIVE+DEV, was in BKP-0131, not in BKP-0217)
- Action: ✅ Keep

---

## Phase 6: Userlogins Reconciliation

**64 userlogin deltas** - mostly Firebase ID mismatches.

| Status | Count | Action |
|--------|-------|--------|
| LIVE ONLY | 16 | ✅ Copy to DEV |
| PROD ONLY | 15 | ⚠️ Review |
| PARTIAL | 33 | ⚠️ Review |

---

## Appendix: Scripts to Run

### Check for RRULE replacements

```javascript
// Run in mongosh against TangoTiempo (LIVE)
db.events.find({
  isRepeating: true,
  title: { $regex: /NOCHE|PRACTICA|Guillermo/i }
}).pretty()
```

### Sync single event LIVE → DEV

```javascript
// Get event from LIVE
const event = db.getSiblingDB('TangoTiempo').events.findOne({ _id: ObjectId('EVENT_ID') });

// Insert to DEV
db.getSiblingDB('TangoTiempoProd').events.insertOne(event);
```

### Delete test event

```javascript
db.events.deleteOne({ _id: ObjectId('EVENT_ID') });
```

---

## Sign-Off

| Role | Name | Approved | Date |
|------|------|----------|------|
| User | Gotan | [ ] | |
| Agent | Fulton | [x] | 2026-02-17 |

**IMPORTANT**: Do not execute any changes without explicit approval from Gotan.
