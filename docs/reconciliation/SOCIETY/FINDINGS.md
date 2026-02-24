# Organizer Findings: SOCIETY (Tango Society of Boston)

**Generated**: 2026-02-17
**Updated**: 2026-02-20
**Status**: COMPLETE

---

## Summary

| Category | Issue | Resolution |
|----------|-------|------------|
| Events | VICKY'S 70th BIRTHDAY missing | Inserted to PROD |
| Events | LA MILONGA Dancing had broken times | Restored from backup |

---

## Events Analysis

### SOCIETY-001: VICKY'S 70th BIRTHDAY PARTY

| Field | Value |
|-------|-------|
| ID | `6992c09fd7738f471b9a25c9` |
| Title | VICKY'S 70th BIRTHDAY PARTY |
| Date | Mar 28, 2026 |
| Issue | Missing from PROD |
| Resolution | Inserted from backup |

### SOCIETY-002: LA MILONGA Dancing

| Field | Value |
|-------|-------|
| ID | `68533139a1e3cfb6f8bbaa0a` |
| Title | LA MILONGA Dancing |
| Date | Feb 21, 2026 |
| Issue | Times reverted to broken 0-hour duration (9pm-9pm) |
| Resolution | Restored correct times (7pm-11pm) from backup |

**Root Cause**: Feb 17 reconciliation sync overwrote user's Feb 16 edits.

---

## Resolution

Both events restored from backup collection `events_backup_2026-02-17T05-46-30-560Z`:
- VICKY'S 70th: Inserted to PROD (2026-02-18)
- LA MILONGA Dancing: Restored to PROD + TEST (2026-02-20)
