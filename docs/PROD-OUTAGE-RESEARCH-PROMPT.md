# Azure Functions Deployment Failure - Deep Dive Research Prompt

## Context
You are investigating an Azure Functions deployment failure. A Node.js Azure Functions v4 app suddenly stopped deploying successfully. An existing deployment continues to work, but ANY new deployment fails.

## Environment
- **Platform**: Azure Functions v4, Node.js 20/22, Windows
- **Region**: East US
- **Consumption Plan**: Y1
- **Package Size**: 182.4 MB (full app) vs 215 KB (minimal working test)
- **Functions Count**: ~30+ HTTP trigger functions
- **Date**: February 17, 2026

## The Problem

### Symptom
```
Upload completed successfully.
Deployment completed successfully.
[timestamp] Syncing triggers...
[timestamp] Syncing triggers...  (retries 6x over ~15 minutes)
Error calling sync triggers (BadRequest). Request ID = '0a5a90a1-8d38-4c05-ad8a-63b183d499af'
```

After deployment, app returns HTTP 503 "Service Unavailable".
Azure Portal shows: "Encountered an error (Forbidden) from extensions API"
Runtime version shows: "Error"

### What Works
1. **CalendarBEAF-TEST** - Deployed Feb 12, running v1.21.0, works perfectly
2. **Minimal hello world function** - Deploys and runs successfully on same infrastructure

### What Fails
ALL new deployments of the full codebase fail, regardless of:
- Storage account (tried both `calendarbeaf8fd0` and `calendarbeaf9a27`)
- Function app (tried existing PROD, new CalendarAF-PROD, new CalendarAF-TEST, new CalendarAF-Test2)
- Code version (tried HEAD and v1.21.0 which is identical to working TEST)

## Known Facts

### Storage Account Investigation
- Checked `calendarbeaf9a27` (PROD storage):
  - Keys match function app config ✓
  - Networking: "Enabled from all networks" ✓
  - "Allow storage account key access": Enabled ✓
  - Containers exist: `azure-webjobs-hosts`, `azure-webjobs-secrets` ✓

### Code Changes (Recent Commits)
```
348d7ba5 docs: Add database reconciliation handoff
1bbc4f0b CALOPS-42: Add venue quality checks to Data Health  ← ADDED FIREBASE ADMIN SDK
bb9bab9c CALOPS-42: Add Firebase users without userlogins health check
b2228822 fix: Update Admin_UserActivity projection for userlogins schema
4f77f681 fix: Change Users collection to userlogins in Admin functions
```

### Key Code Change: Firebase Admin SDK Addition
File: `src/functions/Admin_DataHealth.js`
```javascript
const admin = require('firebase-admin');

function getFirebaseAdmin() {
    if (admin.apps.length === 0) {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(serviceAccount))
            });
        } else {
            admin.initializeApp({
                credential: admin.credential.applicationDefault()
            });
        }
    }
    return admin;
}
```

### Environment Variables
Working TEST has these that PROD may not:
- `FIREBASE_JSON` - Base64 encoded service account
- `FIREBASE_SERVICE_ACCOUNT_JSON` - May or may not be set
- `SCM_DO_BUILD_DURING_DEPLOYMENT=true`
- `WEBSITE_ENABLE_SYNC_UPDATE_SITE=true`
- `WEBSITE_NODE_DEFAULT_VERSION=~22`

### Package.json Dependencies (partial)
```json
{
  "@azure/functions": "^4.5.1",
  "firebase-admin": "^13.5.0",
  "mongodb": "^6.20.0",
  "openai": "^4.77.0"
}
```

## Test Results

### Test 1: Minimal Function
- Created with `func init --javascript` + `func new --template "HTTP trigger"`
- Package size: 215 KB
- Result: **SUCCESS** - Deploys, syncs triggers, runs correctly

### Test 2: v1.21.0 (Same as Working TEST)
- Checked out exact commit running on working CalendarBEAF-TEST
- Package size: 182.4 MB
- Result: **FAIL** - Syncs triggers but registers 0 functions, returns 503

### Test 3: Multiple Storage Accounts
- Tried `calendarbeaf8fd0` (used by working TEST)
- Tried `calendarbeaf9a27` (used by PROD)
- Result: Both **FAIL** with same error

### Test 4: Multiple New Function Apps
- Created CalendarAF-PROD, CalendarAF-TEST, CalendarAF-Test2
- All brand new, clean function apps
- Result: All **FAIL** with same error

## Theories to Investigate

### Theory 1: Firebase Admin SDK Module Loading (HIGH PROBABILITY)
- Firebase Admin SDK added in recent commits
- May execute during Azure's function discovery phase
- If `FIREBASE_SERVICE_ACCOUNT_JSON` not set, `applicationDefault()` may throw
- Could block entire function registration process

### Theory 2: Package Size / Timeout (MEDIUM PROBABILITY)
- 182 MB is large for Azure Functions
- Trigger sync may timeout processing large packages
- Minimal 215 KB package works fine

### Theory 3: Node.js Module Resolution Issue (MEDIUM PROBABILITY)
- Working app deployed Feb 12 with npm packages from that date
- New deployments get latest npm packages
- A dependency may have breaking change

### Theory 4: Azure Functions Runtime Issue (LOW PROBABILITY)
- Minimal function works, so runtime is functional
- But something specific to our code triggers runtime bug

### Theory 5: Specific Function Syntax Error (LOW PROBABILITY)
- One of 30+ functions has issue only caught during registration
- Working app's cached state bypasses this check

## Unknowns

1. Why does v1.21.0 work on CalendarBEAF-TEST but fail on fresh deploy?
2. Is there cached state on running apps that helps them work?
3. Exact npm package versions on working TEST vs new deployments?
4. What happens during "Syncing triggers" that causes BadRequest?
5. Does Firebase Admin SDK execute code during Azure's function discovery?
6. Is `FIREBASE_SERVICE_ACCOUNT_JSON` set on PROD?

## Questions for Research

1. **Azure Functions trigger sync process**: What exactly happens during "Syncing triggers"? What can cause BadRequest?

2. **Firebase Admin SDK initialization**: Does `firebase-admin` execute any code at require() time that could fail in serverless environment?

3. **Azure Functions function discovery**: How does Azure discover and register functions? Does it execute any code? Does it import modules?

4. **Large package handling**: Are there known issues with Azure Functions and 180+ MB packages?

5. **Node.js v20 vs v22**: Working app uses ~22, new apps default to ~20. Could this cause module resolution differences?

6. **applicationDefault() in Azure**: What happens when `admin.credential.applicationDefault()` is called in Azure Functions without GCP credentials?

## Desired Output

1. Root cause identification
2. Specific fix or workaround
3. Explanation of why existing deployment works but new ones fail
4. Best practices to prevent this in future

## Files to Examine

- `src/functions/Admin_DataHealth.js` - Firebase integration
- `src/functions/Admin_UserActivity.js` - userlogins changes  
- `package.json` - dependencies
- `host.json` - Azure Functions configuration

---

## Full Session History

### Initial State (Before Outage)
- CalendarBEAF-PROD: Running, pointing to TangoTiempo database
- CalendarBEAF-TEST: Running, pointing to TangoTiempo database  
- Goal: Update PROD to point to TangoTiempoProd database

### What Was Changed (All at Once)
1. `MONGODB_URI` environment variable changed to TangoTiempoProd
2. Deployed code with Users→userlogins collection changes
3. Deployed code with Firebase Admin SDK integration

### Immediate Result
- PROD returned 503 errors
- Frontend showed "Event Not Found" for existing events
- Azure Portal showed "Runtime version: Error"

### Recovery Attempts (All Failed)

**Attempt 1: Revert MONGODB_URI**
- Changed MONGODB_URI back to TangoTiempo
- Result: Still 503

**Attempt 2: Revert Code**
- Deployed older git commit
- Result: Still 503

**Attempt 3: Create New Function App (CalendarAF-PROD)**
- Brand new function app
- Deployed same code
- Result: Same 503 error

**Attempt 4: Deploy Even Older Code**
- Checked out Feb 11 commit (b2228822)
- Result: Still 503

### Investigation Steps

**Step 1: Check Azure Status**
- URL: https://azure.status.microsoft/
- Result: No outages reported for Functions, App Service, or East US

**Step 2: Check Storage Account (calendarbeaf9a27)**
- AzureWebJobsStorage key: Matches ✓
- Networking: "Enabled from all networks" ✓
- Allow storage account key access: Enabled ✓
- Containers azure-webjobs-hosts, azure-webjobs-secrets: Exist ✓

**Step 3: Compare Function App Settings**
Working TEST settings:
```
WEBSITE_NODE_DEFAULT_VERSION=~22
WEBSITE_RUN_FROM_PACKAGE=1
SCM_DO_BUILD_DURING_DEPLOYMENT=true
WEBSITE_ENABLE_SYNC_UPDATE_SITE=true
FUNCTIONS_EXTENSION_VERSION=~4
FUNCTIONS_WORKER_RUNTIME=node
AzureWebJobsStorage=...calendarbeaf8fd0...
```

Failing PROD settings:
```
WEBSITE_NODE_DEFAULT_VERSION=~22
WEBSITE_RUN_FROM_PACKAGE=1
FUNCTIONS_EXTENSION_VERSION=~4
FUNCTIONS_WORKER_RUNTIME=node
AzureWebJobsStorage=...calendarbeaf9a27...
```

**Step 4: Test Different Storage Account**
- Created CalendarAF-Test2 with `calendarbeaf8fd0` (same as working TEST)
- Deployed v1.21.0
- Result: SAME FAILURE - 503

**Step 5: Deploy Minimal Function**
```bash
func init --javascript --worker-runtime node
func new --name hello --template "HTTP trigger"
func azure functionapp publish CalendarAF-Test2 --javascript
```
Result: **SUCCESS!**
```
Functions in CalendarAF-Test2:
    hello - [httpTrigger]
        Invoke url: https://calendaraf-test2.azurewebsites.net/api/hello
```
Curl test: `Hello, world!`

### Key Observations

1. **Package size difference**: 
   - Minimal working: 215 KB
   - Full failing: 182.4 MB

2. **Trigger sync behavior**:
   - Minimal: Syncs in ~3 seconds
   - Full: Retries 6 times over 15+ minutes, then BadRequest

3. **Function registration**:
   - Minimal: 1 function registered
   - Full v1.21.0: 0 functions registered (even when sync "completes")

4. **Working vs New**:
   - CalendarBEAF-TEST deployed Feb 12: Works
   - Same exact code deployed Feb 17: Fails

### Git Log (Recent History)
```
348d7ba5 docs: Add database reconciliation handoff for next session
1bbc4f0b CALOPS-42: Add venue quality checks to Data Health
bb9bab9c CALOPS-42: Add Firebase users without userlogins health check
b2228822 fix: Update Admin_UserActivity projection for userlogins schema
4f77f681 fix: Change Users collection to userlogins in Admin functions
8cbcba0d fix: Compare venueID as strings in EventsRA update (CALBEAF-82)
7effbcf3 docs: Add authorOrganizerID to event response schema (CALBEAF-82)
fabd2813 docs: Add GET /api/events endpoint with authorOrganizerId param (CALBEAF-82)
c960cee4 chore: Bump swagger version to 1.21.0 (CALBEAF-82)
d1f2b775 chore: Bump version to 1.21.0 (CALBEAF-82)  ← THIS IS WORKING TEST VERSION
```

### Diff of Firebase Changes (Admin_DataHealth.js)
```diff
+const admin = require('firebase-admin');
+
+function getFirebaseAdmin() {
+    if (admin.apps.length === 0) {
+        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
+        if (serviceAccount) {
+            admin.initializeApp({
+                credential: admin.credential.cert(JSON.parse(serviceAccount))
+            });
+        } else {
+            admin.initializeApp({
+                credential: admin.credential.applicationDefault()
+            });
+        }
+    }
+    return admin;
+}
```

### Azure Function Apps Created During Investigation
| App Name | Storage Account | Code Version | Result |
|----------|-----------------|--------------|--------|
| CalendarBEAF-PROD | calendarbeaf9a27 | HEAD | 503 |
| CalendarAF-PROD | calendarbeaf9a27 | HEAD | 503 |
| CalendarAF-TEST | calendarbeaf9a27 | v1.21.0 | 503 |
| CalendarAF-Test2 | calendarbeaf8fd0 | v1.21.0 | 503 |
| CalendarAF-Test2 | calendarbeaf8fd0 | minimal | ✅ Works |

### Request IDs for Azure Support
- Trigger sync failure: `0a5a90a1-8d38-4c05-ad8a-63b183d499af`

### CLI Versions
```
func --version: Azure Functions Core Tools (likely 4.x)
node --version: v20.x or v22.x
az --version: Azure CLI 2.x
```

### Azure Subscription
- Subscription ID: `53cb0509-ca95-4c33-a92c-3b559ef1f7d5`
- Resource Group: `CalendarBEAF`
- Region: East US

---

## Hypothesis Ranking

1. **Firebase Admin SDK** (80% confidence)
   - Code added `firebase-admin` require
   - `applicationDefault()` may throw without GCP credentials
   - Azure may execute this during function discovery

2. **Module-level code execution** (70% confidence)  
   - Azure scans/imports modules to discover functions
   - Some module throws during import
   - Blocks entire registration

3. **Package size** (40% confidence)
   - 182MB is large
   - But it uploads fine, deployment succeeds
   - Only trigger sync fails

4. **npm dependency drift** (30% confidence)
   - Working app has Feb 12 node_modules
   - New deploy gets latest packages
   - Breaking change in dependency

5. **Azure regional issue** (10% confidence)
   - Minimal function works
   - So infrastructure is functional
