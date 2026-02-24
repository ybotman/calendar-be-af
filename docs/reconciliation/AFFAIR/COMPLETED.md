# Completed Actions

**Last Updated**: 2026-02-20
**Status**: COMPLETE

---

## Summary

| Action ID | Category | Description | Status |
|-----------|----------|-------------|--------|
| AFFAIR-001 | EVENT | Insert "INT/ADV classes, TangoAffair" to PROD | DONE |
| AFFAIR-002 | EVENT | Restore Simonida's Feb 16 edits (times/descriptions) | DONE |

---

## Execution Log

### AFFAIR-001: Insert Event to PROD

**Executed**: 2026-02-18T20:05:00Z
**Executor**: Fulton

| Field | Value |
|-------|-------|
| Event ID | `698cf499af6501609242a4d0` |
| Title | INT/ADV classes, TangoAffair |
| Date | Feb 24, 2026 |
| Organizer | Simonida Cekovic-Vuletic |
| Source | TangoTiempo.events_backup_2026-02-17T05-46-30-560Z |
| Target | TangoTiempoProd.events |

**Result**: Successfully inserted to PROD.

---

### AFFAIR-002: Restore Simonida's Feb 16 Edits

**Executed**: 2026-02-20
**Executor**: Fulton
**Reported By**: Simonida (via Gotan)

**Issue**: Simonida reported that Vida Mia event times and descriptions kept reverting to wrong values.

**Root Cause**: The Feb 17 reconciliation sync overwrote her Feb 16 edits with old data.

**Evidence Found**:
- Backup `events_backup_2026-02-17T05-46-30-560Z` contained her correct edits
- Current DB had reverted to Jun 23, 2025 versions

**Events Restored**:

| Event ID | Title | Correct Times | Updated |
|----------|-------|---------------|---------|
| `68533143a1e3cfb6f8bbaa55` | Special pre-milonga workshop | 7:30pm - 8:30pm | Feb 16, 2026 |
| `68533143a1e3cfb6f8bbaa5a` | VIDA MIA MILONGA | 7:30pm - 12:30am | Feb 16, 2026 |
| `698cf499af6501609242a4d0` | INT/ADV classes, TangoAffair | 7:30pm - 9:00pm | Feb 11, 2026 |

**What Was Wrong (Before Restore)**:
- Pre-milonga: 1:30pm - 2:30pm (6 hours off!)
- Vida Mia: 6:30pm - 11:30pm (1 hour off)
- Description: Referenced "Feb 28, 2025" instead of "Feb 27, 2026"

**Restored To**:
- TangoTiempoProd (PROD) ✅
- TangoTiempo (TEST) ✅

**Result**: Successfully restored to both databases.

---

## Verification

- [x] Event exists in PROD
- [x] Event accessible via API
- [x] Correct times: 7:30pm-8:30pm (workshop), 7:30pm-12:30am (milonga)
- [x] Correct description: "Friday, February 27"
