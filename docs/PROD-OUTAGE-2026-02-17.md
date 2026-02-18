# PROD Outage Investigation - 2026-02-17

## Timeline of Events

### What Was Attempted
Tried to update PROD with THREE changes at once:
1. **URI change** - MONGODB_URI pointing to TangoTiempoProd database
2. **Variable change** - related configuration
3. **Function change** - code changes (Users → userlogins, Firebase integration)

### What Happened
- PROD went down after the combined changes
- Frontend showed "Event Not Found" for existing events
- Azure Functions returning 503 errors
- "Sync Web Apps Function Triggers" failing with BadRequest/Forbidden

### Investigation Results

**Hypothesis 1: Code corruption** - RULED OUT
- Created brand new function app CalendarAF-TEST
- Deployed v1.21.0 (same version working on CalendarBEAF-TEST)
- CalendarAF-TEST ALSO FAILS with 503

**Hypothesis 2: Storage account issue** - CONFIRMED
| App | Storage Account | Status |
|-----|-----------------|--------|
| CalendarBEAF-TEST | calendarbeaf8fd0 | ✅ WORKS |
| CalendarBEAF-PROD | calendarbeaf9a27 | ❌ FAILS |
| CalendarAF-PROD | calendarbeaf9a27 | ❌ FAILS |
| CalendarAF-TEST (new) | calendarbeaf9a27 | ❌ FAILS |

**Root Cause**: Storage account `calendarbeaf9a27` is broken/corrupted.
- All function apps using this storage account fail
- Same code works on apps using `calendarbeaf8fd0`

### Storage Account Details
- **Working**: `calendarbeaf8fd0` (used by CalendarBEAF-TEST)
- **Broken**: `calendarbeaf9a27` (used by PROD apps)

Checked on calendarbeaf9a27:
- Keys match what's in function app config ✓
- Networking: "Enabled from all networks" ✓
- Allow storage account key access: Enabled ✓
- Containers exist: azure-webjobs-hosts, azure-webjobs-secrets ✓

Despite all settings looking correct, Azure Functions cannot sync triggers.

## Recovery Options

### Option A: Quick Recovery (Recommended)
Create new PROD function app using the WORKING storage account:

1. Create new function app `CalendarBEAF-PROD2`
2. Use storage account `calendarbeaf8fd0`
3. Deploy v1.21.0 code
4. Copy environment variables from backup
5. Point to correct database (TangoTiempo for now)
6. Test
7. Update DNS/frontend to use new app

### Option B: Fix Storage Account
Investigate and fix `calendarbeaf9a27`:
- Check Azure activity logs for recent changes
- Look for soft-deleted content
- Consider recreating storage account
- Risk: Unknown time to diagnose

### Option C: Use Different Storage Account
Update CalendarBEAF-PROD to use `calendarbeaf8fd0`:
- Risk: May have file share conflicts

## Current State

### Working
- CalendarBEAF-TEST: https://calendarbeaf-test.azurewebsites.net ✅

### Down
- CalendarBEAF-PROD: https://calendarbeaf-prod.azurewebsites.net ❌
- CalendarAF-PROD: https://calendaraf-prod.azurewebsites.net ❌
- CalendarAF-TEST: https://calendaraf-test.azurewebsites.net ❌

### Backups Available
- `prod-settings-backup.json` - CalendarBEAF-PROD env vars
- `test-settings-backup.json` - CalendarBEAF-TEST env vars

### Git State
- PROD branch has latest commits
- v1.21.0 is known good (matches working TEST)
- Recent commits added Firebase/userlogins changes (not yet validated)

## Lessons Learned
1. Never change URI + variables + code all at once
2. Test database URI changes on TEST first
3. Storage account issues can look like code issues
4. Keep backups of function app settings
