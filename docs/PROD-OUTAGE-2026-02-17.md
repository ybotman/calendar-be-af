# PROD Outage Investigation - 2026-02-17

## Timeline
- Attempted to update PROD with URI change + variable change + function change (all at once)
- PROD went down, returning 503 errors
- "Sync Web Apps Function Triggers" failing with BadRequest/Forbidden

## Key Finding: AZURE IS WORKING

### Minimal Function Test
Created minimal "hello world" function using `func init` and `func new`:
- Deployed to CalendarAF-Test2
- **Trigger sync SUCCEEDED**
- **Function runs correctly**: `curl .../api/hello` → "Hello, world!"

### Conclusion
**Azure Functions infrastructure is working.** The problem is something in our codebase that causes trigger sync to fail.

## Theories

### 1. Large Package Size (Most Likely)
- Our app: 182MB
- Minimal app: 215KB
- Could be hitting limits/timeout during sync

### 2. Specific Function Causing Failure
- One of our ~30+ functions has error
- Trigger sync fails trying to register that function

### 3. Firebase Admin SDK (Recent Change)
- Recent commits added Firebase Admin SDK to Admin_DataHealth.js
- May fail during function discovery/registration
- If FIREBASE_SERVICE_ACCOUNT_JSON not set, could cause issues

### 4. Dependencies Conflict
- npm package incompatible with Azure Functions v4

## Recent Changes (Prime Suspects)
- `src/functions/Admin_DataHealth.js` - Added Firebase Admin SDK
- `src/functions/Admin_UserActivity.js` - Changed Users → userlogins

## Apps Status
| App | Status | Notes |
|-----|--------|-------|
| CalendarBEAF-TEST | ✅ WORKS | Deployed Feb 12, not touched |
| CalendarBEAF-PROD | ❌ 503 | New deployment fails |
| CalendarAF-Test2 | ✅ WORKS | With minimal hello function |
| CalendarAF-Test2 | ❌ FAILS | When deploying full codebase |

## Error Pattern
```
Upload completed successfully.
Deployment completed successfully.
Syncing triggers... (retries 6x)
Error calling sync triggers (BadRequest). Request ID = '0a5a90a1-8d38-4c05-ad8a-63b183d499af'
```

## Next Steps
1. **Revert recent commits** - Deploy version before Firebase changes
2. **Binary search** - Deploy half functions to find failing one
3. **Check function logs** - Look for startup errors in Azure Portal

## DO NOT
- **DO NOT redeploy CalendarBEAF-TEST** - It's our only working app
