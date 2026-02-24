# Organizer Findings: AFFAIR (Simonida Cekovic-Vuletic)

**Generated**: 2026-02-17
**Updated**: 2026-02-20
**Status**: COMPLETE

---

## Summary

| Category | Issue | Resolution |
|----------|-------|------------|
| Events | Feb 17 sync overwrote Simonida's Feb 16 edits | Restored from backup |
| Times | Wrong times (6 hrs off for workshop, 1 hr for milonga) | Fixed |
| Description | Reverted to "Feb 28, 2025" | Fixed to "Feb 27, 2026" |

---

## Root Cause Analysis

**User Report (Feb 20, 2026)**:
Simonida reported that Vida Mia Milonga times and descriptions kept reverting:
- Times should be 7:30pm-12:30am (milonga) and 7:30pm-8:30pm (workshop)
- Description kept showing old "Feb 28, 2025" date

**Investigation Found**:
1. Simonida DID edit events on Feb 16, 2026 (updatedAt timestamps prove it)
2. Her correct edits existed in backup `events_backup_2026-02-17T05-46-30-560Z`
3. The Feb 17 reconciliation sync overwrote her edits with old Jun 2025 data
4. Current DB showed `updatedAt: Jun 23 2025` instead of `Feb 16 2026`

---

## Events Affected

| ID | Title | Her Edit Date | Was Overwritten |
|----|-------|---------------|-----------------|
| `68533143a1e3cfb6f8bbaa55` | Special pre-milonga workshop | Feb 16, 2026 | YES - Restored |
| `68533143a1e3cfb6f8bbaa5a` | VIDA MIA MILONGA | Feb 16, 2026 | YES - Restored |
| `698cf499af6501609242a4d0` | INT/ADV classes, TangoAffair | Feb 11, 2026 | YES - Restored |

---

## Time Comparison

| Event | WRONG (Before) | CORRECT (After) |
|-------|----------------|-----------------|
| Pre-milonga | 1:30pm - 2:30pm | 7:30pm - 8:30pm |
| Vida Mia | 6:30pm - 11:30pm | 7:30pm - 12:30am |

---

## Resolution

All 3 events restored from `events_backup_2026-02-17T05-46-30-560Z` to both:
- TangoTiempoProd (PROD)
- TangoTiempo (TEST)

Executed: 2026-02-20 by Fulton
