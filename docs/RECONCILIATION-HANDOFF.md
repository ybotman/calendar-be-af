# Database Reconciliation Handoff

**Created**: 2026-02-17 ~2:00am EST
**Author**: Fulton (AI Agent)
**Status**: PAUSED - Ready to resume

---

## CRITICAL DISCOVERY: Database Naming Mixup

### The Problem

We discovered that the database naming is **backwards** from what documentation says:

| What We Call It | Database Name | Actually Used By |
|-----------------|---------------|------------------|
| "TEST" | `TangoTiempo` | **LIVE tangotiempo.com** |
| "PROD" | `TangoTiempoProd` | Local dev only (NOT live!) |

### Evidence

1. **Vercel Environment Variable** (tangotiempo.com):
   ```
   NEXT_PUBLIC_AF_URL = https://calendarbeaf-prod.azurewebsites.net
   ```

2. **Two Azure Function Apps exist**:
   - `calendarbeaf-prod.azurewebsites.net` → Used by LIVE site → connects to `TangoTiempo`
   - `calendar-be-af.azurewebsites.net` → Local dev → connects to `TangoTiempoProd`

3. **Database sizes confirm**:
   - `TangoTiempo`: 55 MB, 1,575 events (LIVE - has user's new TEST event)
   - `TangoTiempoProd`: 10 MB, 1,670 events (not used by live)

### Sync That Was Run Earlier

Earlier in this session, we ran:
```bash
node scripts/syncProdToTest.js --include-events --events-from 2025-01-01 --events-to 2026-12-31
```

This synced FROM `TangoTiempoProd` TO `TangoTiempo` (the LIVE db).

**Result**: Created backup `events_backup_2026-02-17T05-46-30-560Z` before overwriting. User's new TEST event was created AFTER sync so it's safe.

---

## Backup Collections in TangoTiempo (LIVE)

| Date | Collections Backed Up |
|------|----------------------|
| 2026-02-17 | events, venues, organizers, categories, roles, mastered* (TODAY - our sync) |
| 2026-01-31 | events, venues, organizers, categories, roles, mastered* |
| 2025-09-19 | events, venues, organizers, categories, roles, mastered* |
| 2025-09-18 | events, venues, organizers, categories, roles, mastered* |
| 2025-07-24 | events, venues, organizers, categories, roles, mastered* |

**TangoTiempoProd has NO backup collections** - clean slate.

---

## Initial Day-by-Day Comparison (Summary)

For manual events (isDiscovered=false) + recurring expanded:

| Period | LIVE | PROD | Backup-0217 | Match? |
|--------|------|------|-------------|--------|
| 2025-12-20 to 2026-02-13 | All match | All match | All match | ✅ |
| 2026-02-14 | 22 | 22 | 23 | -1 |
| 2026-02-15 | 7 | 7 | 8 | -1 |
| 2026-02-16 | 6 | 6 | 6 | ✅ |
| 2026-02-17 | 5 | 5 | 6 | -1 |

**LIVE = PROD for all 60 days!** Small differences with backup are likely the user's TEST event.

---

## TASK FOR NEXT SESSION

### Objective

Create a detailed **day-by-day, event-by-event** comparison between:
1. `TangoTiempo` (LIVE)
2. `TangoTiempoProd` (local "PROD")
3. `events_backup_2026-02-17T05-46-30-560Z` (pre-sync backup)
4. `events_backup_2026-01-31T05-12-10-576Z` (Jan 31 backup)

### Scope

- **Date Range**: 2025-12-20 to 2026-03-31 (past 60 days + next 6 weeks)
- **Focus**: Manual events only (`isDiscovered=false`)
- **Include**: Recurring events expanded to show each occurrence
- **Output**: Markdown file with tables showing differences

### Output Format

For each day with differences, show:

```markdown
### 2026-02-14 (Saturday)

| Event ID | Title | LIVE | PROD | Backup-0217 | Backup-0131 |
|----------|-------|------|------|-------------|-------------|
| 69940a8d | TEST | ✅ | ❌ | ❌ | ❌ |
| abc12345 | Some Event | ✅ | ✅ | ✅ | ❌ |
```

### Connection Strings

```javascript
// In local.settings.json
MONGODB_URI_TEST → TangoTiempo (ACTUALLY LIVE!)
MONGODB_URI_PROD → TangoTiempoProd (local dev only)

// To connect to LIVE:
BASE_URI = MONGODB_URI_PROD.replace('/TangoTiempoProd', '/TangoTiempo')
```

### Backup Collection Names

```
events_backup_2026-02-17T05-46-30-560Z  (pre-sync today)
events_backup_2026-01-31T05-12-10-576Z  (Jan 31)
events_backup_2025-09-19T17-20-45-846Z  (Sep 19)
```

---

## DO NOT CHANGE

1. **No updates to databases** until reconciliation complete
2. **No code changes** until we understand the full picture
3. **Document everything** in output markdown file

---

## Files to Reference

- `/Users/tobybalsley/MyDocs/AppDev/MasterCalendar/calendar-be-af/local.settings.json` - Connection strings
- `/Users/tobybalsley/MyDocs/AppDev/MasterCalendar/calendar-be-af/scripts/syncProdToTest.js` - Sync script
- `/Users/tobybalsley/MyDocs/AppDev/MasterCalendar/calendar-be-af/CLAUDE.md` - Has wrong db naming

---

## Resume Instructions

When resuming this task:

1. **Read this handoff file**
2. **Confirm understanding** with user
3. **Create output file**: `docs/RECONCILIATION-RESULTS.md`
4. **Run day-by-day comparison** for each day in range
5. **For days with differences**, list event-by-event
6. **Summarize** what needs to be reconciled

### Start Command

```
Read /Users/tobybalsley/MyDocs/AppDev/MasterCalendar/calendar-be-af/docs/RECONCILIATION-HANDOFF.md
Then start the detailed comparison and write results to docs/RECONCILIATION-RESULTS.md
```

---

## User Notes

- User: Ybotman (Toby)
- Time: Going to bed, will resume tomorrow
- Priority: Understanding the data state, NOT making changes
- Question pending: Whether to halt POST/PUT in test (decided: NO for now)
