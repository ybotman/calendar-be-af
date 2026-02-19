# Backup Analysis: TangoTiempo (LIVE) - All Collections

**Generated**: 2026-02-17T22:45:00Z (Mon Feb 17, 2026 5:45 PM EST)
**Mode**: READ ONLY
**Analyst**: Fulton (Azure Functions Backend Agent)

---

## Purpose

Comprehensive analysis of ALL collections comparing 05:46 UTC backup to current state.
This shows changes that occurred on TangoTiempo (LIVE - tangotiempo.com) AFTER the backup.

**Note**: TangoTiempoProd (TEST - test.tangotiempo.com) is STABLE with zero changes because no users access it.

---

## Backup Time: Feb 17, 2026 05:46 UTC (12:46 AM EST)

---

## ALL COLLECTIONS SUMMARY

| Collection | Backup | Current | Added | Deleted | Modified |
|------------|--------|---------|-------|---------|----------|
| **events** | 1,441 | 1,575 | 576 | 442 | 15 |
| **venues** | 400 | 584 | 507 | 323 | 2 |
| **organizers** | 60 | 59 | 1 | 2 | 0 |
| **userlogins** | 48 | 48 | 0 | 0 | 0 |
| categories | 21 | 21 | 0 | 0 | 0 |
| masteredcities | 215 | 215 | 0 | 0 | 0 |
| masteredcountries | 51 | 51 | 0 | 0 | 0 |
| mastereddivisions | 67 | 67 | 0 | 0 | 0 |
| masteredregions | 38 | 38 | 0 | 0 | 0 |
| roles | 11 | 11 | 0 | 0 | 0 |

**Collections with changes**: events, venues, organizers

---

## EVENTS ANALYSIS (User-Created Only)

### Summary
| Metric | Count |
|--------|-------|
| User-created in backup | 1,023 |
| User-created current | 1,002 |
| **Deleted** | **24** |
| **Added** | **3** |

### 🗑️ DELETED USER-CREATED EVENTS (24 total)

#### Old Events (2024 - no createdAt, likely RRULE cleanup)
| Organizer | Title | Event Date |
|-----------|-------|------------|
| LAURA | "Partylonga NoHo" | Mar 1, 2024 |
| SOCIETY | "Milonga TRANOCHANDO" | Mar 1, 2024 |
| SUENO | "Argentine Tango in West Hartford" | Mar 2, 2024 |
| MILT-CORI | "Milonga NUEVA" | Mar 2, 2024 |
| MILT-CORI | "Milonga NUEVA: March with Melina!" | Mar 2, 2024 |
| ULTIMATE | (5 events) | Mar 3-4, 2024 |
| SUN-PRAC | "Boston Weekly Sunday Practica" | Mar 3, 2024 |
| SOCIETY | "PRACTILONGA CAMINITO" | Mar 3, 2024 |
| MIT | (2 events) | Mar 4, 2024 |
| (undefined) | "2027 BHS International Convention" | Jul 4, 2027 |
| (undefined) | "Harmony Inc. International Convention 2027" | Nov 10, 2027 |

#### ⚠️ RECENT EVENTS (Created in 15-day window, then deleted)
| Organizer | Title | Event Date | Created |
|-----------|-------|------------|---------|
| ADRIANAPIN | "sdf" | Feb 11, 2026 | Feb 4 | *test data*
| ROGER | "Foundry Festival Milonga Demo" | Feb 21, 2026 | Feb 9 | **REAL**
| AFFAIR | "INT/ADV classes, TangoAffair" | Feb 24, 2026 | Feb 11 | **REAL**
| YBOTMAN | "TST" | Feb 20, 2026 | Feb 11 | *test data*
| ACADEMY | "LA SOCIAL" | Feb 18, 2026 | Feb 12 | **REAL**
| MILT-CORI | "Milonga NUEVA!" | Mar 7, 2026 | Feb 15 | **REAL**
| MILT-CORI | "Milonga NUEVA!" | Apr 4, 2026 | Feb 15 | **REAL**
| MILT-CORI | "Milonga NUEVA!" | May 2, 2026 | Feb 15 | **REAL**
| SOCIETY | "VICKY'S 70th BIRTHDAY PARTY" | Mar 28, 2026 | Feb 16 | **REAL**

### ✅ ADDED USER-CREATED EVENTS (3 total)
| Organizer | Title | Event Date | Created |
|-----------|-------|------------|---------|
| YBOTMAN | "Journey Hands-On Guided Practica" | Aug 25, 2025 | N/A |
| MILT-CORI | "Milonga NUEVA: Feel the LOVE! ❤" | Feb 7, 2026 | N/A |
| YBOTMAN | "TEST" | Feb 19, 2026 | Feb 17 | *test data*

---

## VENUES ANALYSIS

### Summary
| Metric | Count |
|--------|-------|
| Backup | 400 |
| Current | 584 |
| Added | 507 |
| Deleted | 323 |
| Modified | 2 |

**Note**: Large venue churn is likely from FB Conditioner pipeline (AI-discovered events create venues).

### Sample Deleted Venues
- Austin Uptown Dance (Austin)
- Esquina Tango (Austin)
- Vic Mathias Shores (Austin)
- Dauntless Dance and Movement (Houston)
- Marcone's (Houston)
- Museum of Fine Arts, Houston
- Private studio in the Meyerland Area
- Simone on Sunset (Houston)
- TBH Express-Arte (Houston)
- Urban Fit Yoga (Houston)
- Pivot Ballroom (Ardmore)

---

## ORGANIZERS ANALYSIS

### Summary
| Metric | Count |
|--------|-------|
| Backup | 60 |
| Current | 59 |
| Net change | -1 |

### 🗑️ Deleted Organizers
| ShortName | ID |
|-----------|-----|
| UNK | `6982c3c9cd86da3c9644fc99` |
| MCRISTINA | `698cfe764a84997face5052c` |

### ✅ Added Organizers
| ShortName |
|-----------|
| UNK (recreated with new ID) |

---

## USERLOGINS ANALYSIS

**NO CHANGES** - 48 userlogins in both backup and current.

---

---

## Analysis Parameters

- **Change Window**: Jan 29 - Feb 17, 2026 (when events were created/modified)
- **Event Date Range**: Jan 29 - Mar 30, 2026 (event start dates)
- **Filter**: `isDiscovered=false` (USER-CREATED events only, excludes AI-discovered FB events)

---

## TangoTiempo (LIVE) Analysis

### Events in Date Range (Jan 29 - Mar 30)

| Source | Count |
|--------|-------|
| Backup | 130 |
| Current | 125 |
| **Difference** | **-5 real events** |

### 🗑️ DELETED FROM LIVE (7 total, 5 real events)

These events existed in the backup but are NOW GONE from current TangoTiempo.events:

#### Test Data (OK to ignore)
| Organizer | Title | Event Date | Created | ID |
|-----------|-------|------------|---------|-----|
| ADRIANAPIN | "sdf" | Feb 11, 2026 | Feb 4, 2026 | `6983db904e3714b1c0e47ce9` |
| YBOTMAN | "TST" | Feb 20, 2026 | Feb 11, 2026 | `698d10a1b2d454c79a62ddb4` |

#### ⚠️ REAL EVENTS NEEDING RESTORATION
| Organizer | Title | Event Date | Created | ID |
|-----------|-------|------------|---------|-----|
| ROGER | "Foundry Festival Milonga Demo" | Sat, Feb 21, 2026 | Mon, Feb 9, 2026 | `6989f0c480cbd93808776b50` |
| ACADEMY | "LA SOCIAL" | Wed, Feb 18, 2026 | Thu, Feb 12, 2026 | `698e38e63b4aba65674f8885` |
| AFFAIR | "INT/ADV classes, TangoAffair" | Tue, Feb 24, 2026 | Wed, Feb 11, 2026 | `698cf499af6501609242a4d0` |
| MILT-CORI | "Milonga NUEVA!" | Sat, Mar 7, 2026 | Sun, Feb 15, 2026 | `6992474928188fc892ab153a` |
| SOCIETY | "VICKY'S 70th BIRTHDAY PARTY" | Sat, Mar 28, 2026 | Mon, Feb 16, 2026 | `6992c09fd7738f471b9a25c9` |

**Status**: All 5 real events are MISSING from both TangoTiempo.events AND TangoTiempoProd.events

### ✅ ADDED TO LIVE (2 total)

| Organizer | Title | Event Date | In TTP? | ID |
|-----------|-------|------------|---------|-----|
| MILT-CORI | "Milonga NUEVA: Feel the LOVE! ❤" | Feb 7, 2026 | ✓ Yes | `698234ac87b34404680182a1` |
| YBOTMAN | "TEST" | Feb 19, 2026 | ✗ No | `69940a8dc17106d597ef6dcb` |

---

## Key Observations

1. **No CRUD Audit Trail**: Azure Functions do NOT log create/update/delete operations to MongoDB. We cannot determine WHO deleted the 5 real events or WHY.

2. **All Deletions Occurred After Backup**: The backup at 05:46 UTC on Feb 17 has these events. Current state does not. Deletions happened between then and now.

3. **TangoTiempoProd Never Had These**: The 5 deleted events were created on LIVE (TangoTiempo) and never synced to TEST (TangoTiempoProd).

4. **Database Swap Context**:
   - TangoTiempo = tangotiempo.com (LIVE site)
   - TangoTiempoProd = test.tangotiempo.com (TEST site)
   - Environment variable names are backwards in local.settings.json

---

## Recommended Actions

### Phase 1: Restore 5 Real Events to TangoTiempo (LIVE)

Execute 1:1 transaction restore from `events_backup_2026-02-17T05-46-30-560Z`:

```javascript
// IDs to restore to TangoTiempo.events
const restoreIds = [
  '6989f0c480cbd93808776b50', // ROGER - Foundry Festival Milonga Demo
  '698e38e63b4aba65674f8885', // ACADEMY - LA SOCIAL
  '698cf499af6501609242a4d0', // AFFAIR - INT/ADV classes, TangoAffair
  '6992474928188fc892ab153a', // MILT-CORI - Milonga NUEVA!
  '6992c09fd7738f471b9a25c9', // SOCIETY - VICKY'S 70th BIRTHDAY PARTY
];
```

### Phase 2: Sync to TangoTiempoProd (TEST)

After restoring to LIVE, copy same 5 events to TEST for consistency.

### Phase 3: Do NOT Restore Test Data

- `6983db904e3714b1c0e47ce9` (ADRIANAPIN "sdf") - junk
- `698d10a1b2d454c79a62ddb4` (YBOTMAN "TST") - junk

---

## Scripts Used

- `scripts/compare-15day-focused.js` - Main analysis script
- `scripts/compare-15day-window.js` - Full comparison (includes AI-discovered)
- `scripts/compare-15day-organizers.js` - Organizer-only (incorrect field name)

---

## TangoTiempoProd (TEST) Analysis

### Backup Used
- Collection: `events_backup_2026-02-17_reconciliation`
- Count: 1,670 events total, 124 in date range

### Results

| Metric | Count |
|--------|-------|
| TTP Backup (Jan 29 - Mar 30) | 124 |
| TTP Current (Jan 29 - Mar 30) | 124 |
| TT Current (for reference) | 125 |

### Changes Since Backup

**DELETED FROM TEST**: 0
**ADDED TO TEST**: 0

### Sync Status

**In LIVE but not TEST**: 1 event
- YBOTMAN "TEST" (test data, ignore)

### Conclusion

TangoTiempoProd (TEST) is **STABLE** - no changes since the backup was created. The 5 real events that were deleted from LIVE were **NEVER in TEST** to begin with.

---

## Combined Analysis

| Database | Backup | Current | Deleted | Added |
|----------|--------|---------|---------|-------|
| TangoTiempo (LIVE) | 130 | 125 | 7 (5 real) | 2 |
| TangoTiempoProd (TEST) | 124 | 124 | 0 | 0 |

### The 5 Real Deleted Events

These events:
1. Were **CREATED** on TangoTiempo (LIVE) during 15-day window
2. Were **NEVER SYNCED** to TangoTiempoProd (TEST)
3. Were **DELETED** from TangoTiempo (LIVE) after backup at 05:46 UTC
4. **ONLY EXIST** in `TangoTiempo.events_backup_2026-02-17T05-46-30-560Z`

---

## Restoration Plan

### Step 1: Restore to TangoTiempo (LIVE)

Source: `TangoTiempo.events_backup_2026-02-17T05-46-30-560Z`
Target: `TangoTiempo.events`

| # | Organizer | Title | Event Date | ID |
|---|-----------|-------|------------|-----|
| 1 | ROGER | "Foundry Festival Milonga Demo" | Feb 21, 2026 | `6989f0c480cbd93808776b50` |
| 2 | ACADEMY | "LA SOCIAL" | Feb 18, 2026 | `698e38e63b4aba65674f8885` |
| 3 | AFFAIR | "INT/ADV classes, TangoAffair" | Feb 24, 2026 | `698cf499af6501609242a4d0` |
| 4 | MILT-CORI | "Milonga NUEVA!" | Mar 7, 2026 | `6992474928188fc892ab153a` |
| 5 | SOCIETY | "VICKY'S 70th BIRTHDAY PARTY" | Mar 28, 2026 | `6992c09fd7738f471b9a25c9` |

### Step 2: Copy to TangoTiempoProd (TEST)

After restoring to LIVE, copy same 5 events to TEST for consistency.

---

## Next Steps

1. [x] Compare TangoTiempoProd backup to current (parallel analysis) ✅
2. [ ] Get Gotan approval for restoration
3. [ ] Execute 1:1 restore transactions to TangoTiempo
4. [ ] Copy restored events to TangoTiempoProd
5. [ ] Verify restoration
6. [ ] Document completion

---

## Approval Required

**NO DATABASE CHANGES WITHOUT EXPLICIT APPROVAL FROM GOTAN**

This document is for analysis purposes only. All restoration actions require approval.
