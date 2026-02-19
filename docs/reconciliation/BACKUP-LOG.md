# Backup Execution Log

**Last Updated**: 2026-02-17 16:03 EST

---

## Backup Summary

| Backup ID | Database | Status | Date | Collections |
|-----------|----------|--------|------|-------------|
| BACKUP-001 | TangoTiempo (current LIVE) | ✅ COMPLETE | 2026-02-17 16:03 EST | 10/10 |
| BACKUP-002 | TangoTiempoProd (current DEV) | ✅ COMPLETE | 2026-02-17 16:03 EST | 10/10 |

---

## BACKUP-001: TangoTiempo (Current LIVE)

**Status**: ✅ COMPLETE
**Approved By**: Gotan on 2026-02-17
**Executed**: 2026-02-17T21:03:35.637Z

**Naming Convention**: `{collection}_backup_2026-02-17_reconciliation`

| Collection | Backup Collection | Docs | Status |
|------------|-------------------|------|--------|
| events | events_backup_2026-02-17_reconciliation | 1,575 | ✅ OK |
| venues | venues_backup_2026-02-17_reconciliation | 584 | ✅ OK |
| organizers | organizers_backup_2026-02-17_reconciliation | 59 | ✅ OK |
| userlogins | userlogins_backup_2026-02-17_reconciliation | 48 | ✅ OK |
| categories | categories_backup_2026-02-17_reconciliation | 21 | ✅ OK |
| roles | roles_backup_2026-02-17_reconciliation | 11 | ✅ OK |
| masteredcities | masteredcities_backup_2026-02-17_reconciliation | 215 | ✅ OK |
| masteredcountries | masteredcountries_backup_2026-02-17_reconciliation | 51 | ✅ OK |
| mastereddivisions | mastereddivisions_backup_2026-02-17_reconciliation | 67 | ✅ OK |
| masteredregions | masteredregions_backup_2026-02-17_reconciliation | 38 | ✅ OK |

**Total Documents Backed Up**: 2,669

---

## BACKUP-002: TangoTiempoProd (Current DEV)

**Status**: ✅ COMPLETE
**Approved By**: Gotan on 2026-02-17
**Executed**: 2026-02-17T21:03:41.285Z

**Naming Convention**: `{collection}_backup_2026-02-17_reconciliation`

| Collection | Backup Collection | Docs | Status |
|------------|-------------------|------|--------|
| events | events_backup_2026-02-17_reconciliation | 1,670 | ✅ OK |
| venues | venues_backup_2026-02-17_reconciliation | 584 | ✅ OK |
| organizers | organizers_backup_2026-02-17_reconciliation | 59 | ✅ OK |
| userlogins | userlogins_backup_2026-02-17_reconciliation | 46 | ✅ OK |
| categories | categories_backup_2026-02-17_reconciliation | 21 | ✅ OK |
| roles | roles_backup_2026-02-17_reconciliation | 11 | ✅ OK |
| masteredcities | masteredcities_backup_2026-02-17_reconciliation | 215 | ✅ OK |
| masteredcountries | masteredcountries_backup_2026-02-17_reconciliation | 51 | ✅ OK |
| mastereddivisions | mastereddivisions_backup_2026-02-17_reconciliation | 67 | ✅ OK |
| masteredregions | masteredregions_backup_2026-02-17_reconciliation | 38 | ✅ OK |

**Total Documents Backed Up**: 2,762

---

## Key Observations from Backup

| Metric | TangoTiempo (LIVE) | TangoTiempoProd (DEV) | Delta |
|--------|--------------------|-----------------------|-------|
| Events | 1,575 | 1,670 | +95 in DEV |
| Venues | 584 | 584 | Same |
| Organizers | 59 | 59 | Same |
| Userlogins | 48 | 46 | +2 in LIVE |

**Note**: DEV has 95 more events than LIVE. This includes old events that were cleaned from LIVE.

---

## Recovery Commands

If rollback needed:

```javascript
// Restore events in TangoTiempo
db.events_backup_2026-02-17_reconciliation.aggregate([{ $out: "events" }])

// Restore events in TangoTiempoProd
db.events_backup_2026-02-17_reconciliation.aggregate([{ $out: "events" }])
```

**WARNING**: The `$out` operation will REPLACE the target collection. Use with caution.

---

## Existing Backups (For Reference)

These backup collections already existed in TangoTiempo before today:

| Collection | Date | Purpose |
|------------|------|---------|
| events_backup_2026-02-17T05-46-30-560Z | Feb 17, 2026 | Pre-sync backup (earlier today) |
| events_backup_2026-01-31T05-12-10-576Z | Jan 31, 2026 | Before migration |
| events_backup_2025-09-19T17-20-45-846Z | Sep 19, 2025 | Historical |

---

## Script Used

`scripts/reconciliation-backup.js`

```bash
node scripts/reconciliation-backup.js --db=BOTH
```
