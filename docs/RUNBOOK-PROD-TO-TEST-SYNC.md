# Runbook: PROD → TEST Sync + Classification Refresh

**Owner:** Fulton (calendar-be-af)
**Last updated:** 2026-04-18 (CALBEAF-110)
**When to use:** refresh TEST Mongo from PROD before QA cycles, periodic refresh, or after major PROD changes.

---

## Overview (3 steps, ~3-5 min total)

1. Sync PROD → TEST (`syncProdToTest.js`)
2. Run post-sync sanity check (auto, baked into sync script as of 2026-04-18)
3. Re-run classifier / DQ backfill (`runDataQualityBackfill.js`)

**Hard rail:** PROD is read-only. PROD STAY-OUT per CALBEAF-110 initiative.

---

## Step 1 — Sync

### Default (full mirror, since CALBEAF-110)

```bash
node scripts/syncProdToTest.js
```

**Synced by default (as of 2026-04-18):**
- Dimensional: categories, mastered* (cities/countries/divisions/regions), organizers, venues, roles
- Events (all-history, all appIds) — **default changed from opt-in to opt-out**
- Userlogins — **default changed from opt-in to opt-out**

### Opt-out flags

- `--skip-events` — skip events sync (dimensional-only refresh)
- `--skip-users` — skip userlogins sync

### Legacy opt-in flags (still work, now redundant)

- `--include-events`, `--include-users`, `--include-transactional`

### Date filters on events (optional)

- `--events-all` (default when events included)
- `--events-future` / `--events-days N` / `--events-from YYYY-MM-DD` / `--events-to YYYY-MM-DD`

### Dry-run (no writes)

```bash
node scripts/syncProdToTest.js --dry-run
```

### Backup behavior

Existing TEST collections are RENAMED with timestamp before overwrite:
- Example: `events` → `events_backup_2026-04-18T19-23-41-013Z`
- Rollback: rename backup back over current (manual)
- Backups accumulate — clean up periodically (see Housekeeping below)

---

## Step 2 — Post-sync sanity check (automatic as of 2026-04-18)

Script runs this check automatically after events sync:

```
PROD events (appId=1): <count>
TEST events (appId=1): <count>
Ratio (TEST/PROD):     <%>
```

**If `ratio < 50%`**: script exits with code `3` and loud ERROR log. This catches the "I did a full pull but events didn't sync" silent failure mode.

---

## Step 3 — Classifier / DQ refresh

Sync replaces event docs but does NOT re-run the enrichment pipeline (classification, country, venue resolution, travelWorthy). Follow up:

### Dry-run preview (safe, always run first)

```bash
node scripts/runDataQualityBackfill.js --force-recompute --dry-run
```

Output: per-field change counts, per-category breakdown, sample diffs. Saved to `/tmp/` if `--output=<path>` given.

### Apply (requires AIDI Q1=C review gate + Toby personal authorization)

```bash
node scripts/runDataQualityBackfill.js --force-recompute --apply
```

**Governance reminder:** `--apply` is gated. Do NOT run without:
1. AIDI review of dry-run output
2. Toby personal go via Number2 relay
3. Quinn clearance

### `--force-recompute` semantics

Per Option A preserve-gate (Toby 2026-04-18): always recompute classifier fields; `*Override` fields (forBeginnersOverride etc.) protect organizer intent. Self-heals stale values that earlier code runs may have written incorrectly.

---

## Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| "I thought I did a full pull, events are missing" | Running old version of sync script (pre-2026-04-18) that required `--include-events` | Pull latest; events default-ON |
| TEST event count far below PROD | Date-filter flag stuck from a prior command | Remove filters; re-run with defaults |
| Organizers exist but no events | `--skip-events` left in command | Remove flag; re-run |
| Backup collections accumulating | Periodic cleanup skipped | See Housekeeping below |
| Sanity check exits with `3` | Events didn't sync despite intent | Investigate; re-run explicitly |

---

## Housekeeping — drop stale backup collections

Backups accumulate forever unless pruned. To list and drop:

```bash
# List all backup collections
mongosh "$MONGODB_URI_TEST" --eval 'db.listCollections().toArray().filter(c=>c.name.includes("_backup_")).map(c=>c.name)'

# Drop a specific backup (careful — destructive)
mongosh "$MONGODB_URI_TEST" --eval 'db.getCollection("events_backup_2026-04-18T19-23-41-013Z").drop()'
```

Keep at least the most recent backup per collection for quick rollback. Drop anything older than 30 days routinely.

---

## Hard rails

- PROD is READ-ONLY for this script
- No PROD writes under any flag combination
- PROD STAY-OUT per CALBEAF-110 Toby authorization posture (standing rule)
- Sanity check alerts but does NOT roll back — writes have already happened when it runs

---

## Change history

- **2026-04-18 (CALBEAF-110):** Events + userlogins default ON; `--skip-events`/`--skip-users` opt-out flags; post-sync sanity check; strict-threshold beginnerFriendly for ineligible categories; Option A preserve-gate (always recompute; override wins).
- **2026-04-17:** Initial 3-step procedure.
