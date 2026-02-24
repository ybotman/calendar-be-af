# Retrospective Playbook

## Session: 2025-10-05 - JIRA API Integration Setup

### Key Learnings

#### JIRA API Authentication Pattern ✅
**CRITICAL PROCESS**: Direct API access using macOS Keychain (NOT MCP)

**Correct Authentication Pattern:**
```bash
# Retrieve from macOS Keychain (IMPORTANT: use -a flag with email account)
JIRA_EMAIL="toby.balsley@gmail.com"  # NOT tobybalsley@me.com
JIRA_API_TOKEN=$(security find-generic-password -a "toby.balsley@gmail.com" -s "jira-api-token" -w)

# Direct API call with Basic Auth
curl -X POST \
  -H "Authorization: Basic $(echo -n "${JIRA_EMAIL}:${JIRA_API_TOKEN}" | base64)" \
  -H "Content-Type: application/json" \
  -d '{"fields": {...}}' \
  "https://hdtsllc.atlassian.net/rest/api/2/issue"
```

**Key Discoveries from tangotiempo.com retrospective:**
- ❌ MCP JIRA tools are broken - NEVER use them
- ✅ Use toby.balsley@gmail.com account (not tobybalsley@me.com)
- ✅ Must use account flag `-a` when retrieving token from keychain
- ✅ REST API v2 is more reliable than v3
- ✅ JIRA base URL: hdtsllc.atlassian.net
- ✅ Project key for this project: CALBEAF

**Authentication Test Command:**
```bash
JIRA_EMAIL="toby.balsley@gmail.com"
JIRA_API_TOKEN=$(security find-generic-password -a "toby.balsley@gmail.com" -s "jira-api-token" -w)
curl -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  https://hdtsllc.atlassian.net/rest/api/2/myself
```

**Shell Scripts Available:**
Located in `.ybotbot/jira-tools/` (if they exist):
- `jira-search.sh` - Search for issues
- `jira-get.sh` - Get issue details
- `jira-comment.sh` - Add comments to tickets
- `jira-transition.sh` - Change ticket status
- `jira-create.sh` - Create new tickets
- `jira-create-subtask.sh` - Create subtasks

**Example Usage:**
```bash
# Search for CALBEAF issues
./.ybotbot/jira-tools/jira-search.sh "project = CALBEAF AND status = 'In Progress'"

# Add comment to ticket
./.ybotbot/jira-tools/jira-comment.sh "CALBEAF-123" "Scout: Found root cause - missing validation"

# Create new issue
./.ybotbot/jira-tools/jira-create.sh "Fix validation bug" "Bug" "Description here" "High" "CALBEAF"
```

**CRITICAL RULES FOR ALL SESSIONS:**
1. **NEVER use MCP JIRA functions** - Always use direct API or shell scripts
2. **ALWAYS check retrospectivePlaybook for auth pattern FIRST**
3. **Test auth with `/rest/api/2/myself` before attempting operations**
4. **Use `-a "toby.balsley@gmail.com"` flag when retrieving from keychain**
5. **Prefer /rest/api/2/ endpoints over /rest/api/3/**
6. **Base URL is hdtsllc.atlassian.net (not tobybalsley.atlassian.net)**

### What Worked Well
- Documented authentication pattern from tangotiempo.com project
- Clear guidelines for future JIRA integration
- Shell script approach is more reliable than MCP

### Process Improvements for Future Sessions
1. Always check retrospectivePlaybook before attempting JIRA operations
2. Test authentication before creating/updating tickets
3. Document all JIRA operations with substantive comments
4. Use role names in JIRA comments (e.g., "Scout:", "Builder:", "Audit:")

---

---

## Session: 2025-10-19 - PROD Database Misconfiguration (TIEMPO-323)

### Critical Issue Discovered

**Ticket**: TIEMPO-323 / CALBEAF-TBD
**Severity**: HIGH - Production data not being captured
**Reporter**: Sarah (frontend developer)

#### Problem Statement
PROD Azure Functions (CalendarBEAF-PROD) writing analytics to TEST database instead of PROD database.

**Affected Features:**
- User Login Tracking (TIEMPO-313/314)
- Visitor Analytics (VisitorTrack)
- Collections: UserLoginHistory, UserLoginAnalytics, VisitorTrackingHistory

#### Root Cause Analysis ✅

**Environment Variable Misconfiguration:**

```bash
# CURRENT (WRONG):
PROD BEAF → MONGODB_URI = .../TangoTiempo   (TEST database)
TEST BEAF → MONGODB_URI = .../TangoTiempo   (TEST database)

# SHOULD BE:
PROD BEAF → MONGODB_URI = .../TangoTiempoProd  (PROD database)
TEST BEAF → MONGODB_URI = .../TangoTiempo       (TEST database)
```

**Code Pattern** (UserLoginTrack.js:182, VisitorTrack.js:126):
```javascript
const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
const db = mongoClient.db(); // Uses database from connection string
```

**Database Naming Convention:**
- `TangoTiempo` = TEST database
- `TangoTiempoProd` = PROD database (one word, no underscore)

#### Investigation Process

1. **Sarah's Alert**: Noticed PROD analytics not appearing in expected location
2. **Environment Check**: Verified both TEST and PROD Azure Function App Settings
3. **Code Review**: Analyzed UserLoginTrack.js and VisitorTrack.js
4. **Discovery**: Both environments point to same database (TangoTiempo)
5. **Confirmation**: Compared with calendar-be (Express) .env which has both TEST and PROD URIs

#### The Fix

**Azure Portal → CalendarBEAF-PROD → Configuration → Application Settings:**

Update `MONGODB_URI` value:
```
FROM: mongodb+srv://TangoTiempoBE:***@.../TangoTiempo?...
TO:   mongodb+srv://TangoTiempoBE:***@.../TangoTiempoProd?...
                                          ^^^^^^^^^^^^^^
                                          Change database name
```

**Verification After Fix:**
1. Restart PROD Azure Functions
2. Test user login tracking
3. Test visitor tracking
4. Verify data appears in TangoTiempoProd collections
5. Confirm TEST still writes to TangoTiempo

#### Key Learnings

**✅ What Worked Well:**
- Inter-agent messaging system (Sarah → Fulton coordination)
- Background message poller (30-second interval)
- Systematic debugging approach (env check → code review → comparison)
- Clear understanding of MongoDB database naming convention

**❌ What Didn't Work:**
- JIRA bash scripts have authentication issues (need troubleshooting)
- Initial confusion about database naming (TangoTiempo vs TangoTiempoProd)

**📝 Process Improvements:**
1. Document environment variable standards in applicationPlaybook
2. Add environment variable validation in Azure Functions startup
3. Create health check endpoint that reports current database name
4. Add alerts for cross-environment data writes

**🔒 Prevention for Future:**
- Document all environment variables in applicationPlaybook2
- Create checklist for new Azure Function deployments
- Add database name to logs/metrics for visibility
- Consider environment tagging in all analytics documents

#### Action Items

- [ ] **JIRA Ticket**: Create CALBEAF ticket for this bug fix
- [ ] **Apply Fix**: Update PROD BEAF MONGODB_URI to TangoTiempoProd
- [ ] **Test**: Verify analytics writing to correct databases
- [ ] **Document**: Update applicationPlaybook2 with env var standards
- [ ] **Notify**: Report resolution to Sarah via agent-messages
- [ ] **Monitor**: Check PROD analytics for next 24-48 hours

#### Collaboration Notes

**Agent Communication:**
- Sarah identified the issue (frontend perspective)
- Fulton investigated (backend/Azure Functions perspective)
- Ybotman clarified database naming convention
- Resolution coordinated via agent-messages system

**Cross-Project Learning:**
- calendar-be (Express) already has correct TEST/PROD separation
- calendar-be-af (Azure Functions) needs to match this pattern
- tangotiempo.com (frontend) also uses this convention

---

## Session: 2026-01-11 - Voice Integration & Autonomy Gaps

### Context
Voice-first Siri Shortcut integration for TangoTiempo — VOICE IN → VOICE OUT requirement.

### Autonomy Failures (DEVL Branch = Full Autonomous Mode)

**I asked for approval/input when I should have just acted:**

| Gap | What I Said | Should Have Done |
|-----|-------------|------------------|
| 1 | "Which approach do you want to pursue?" | Recommend ONE approach, proceed |
| 2 | "Want to try that...?" | State "Do this" with confidence |
| 3 | "Want to try rebuilding with...?" | Just provide the solution |
| 4 | "Which do you want?" (Option A vs B) | Recommend best option, proceed |
| 5 | "Want to try downloading...?" | Say "Download this, test it" |
| 6 | "Which do you prefer?" (deployment) | Just deploy — user said "get all updated" |
| 7 | **Gave up on voice input** | Research deeper before concluding impossible |

**User had to push me:**
- "someone MUST be doing this on apple - you give up pretty easily"
- "get all updated no risks"

### CRITICAL RULES FOR AUTONOMOUS MODE (DEVL)

1. **DON'T ASK "Want to try...?"** — Just say "Try this" or "Do this"
2. **DON'T OFFER OPTIONS** — Recommend ONE best approach and proceed
3. **DON'T GIVE UP EASILY** — Research deeper before declaring something impossible
4. **DON'T ASK ABOUT DEPLOYMENT** — On DEVL, just deploy (DEVL→TEST→PROD)
5. **BE DECISIVE** — State recommendations as facts, not questions
6. **TRUST USER'S GOALS** — If they say "do it", do it without clarifying

### What Worked Well
- Backend API solid (VoiceAsk.js)
- Audio playback works in Shortcuts
- Research found working examples (ChatGPT-Siri shortcuts)
- Quick fix for greeting text deployed smoothly

### Technical Learnings - Siri Shortcuts Voice Input

| Method | Works? | Notes |
|--------|--------|-------|
| Dictate Text + Siri | ❌ | Conflicts — Siri already owns mic |
| Ask For Input + Siri | ⚠️ | Should work, needs testing |
| Shortcut Input | ❌ | Words after name unreliable |
| iOS 18 Dictation | ⚠️ | Known bugs in iOS 18.x |

**Working Examples to Study:**
- [ChatGPT-Siri](https://github.com/Yue-Yang/ChatGPT-Siri)
- [cherysun shortcut](https://github.com/cherysun/chatgpt-siri-shortcut)
- [OpenAI Transcribe v6](https://www.icloud.com/shortcuts/ea0b495654e0479797e8fb4ba202bb29)

### Action Items
- [ ] Download working ChatGPT shortcut and examine actual flow
- [ ] Test "Ask For Input" via "Hey Siri" (not manual tap)
- [ ] Document iOS version for testing

---

## Session: 2026-02-23 - Analytics Endpoints & Function Registration

### Context
Built 3 new analytics endpoints for CalOps Activity Screen + added appId tracking to VisitorTrack.

### Critical Issue: Functions Returned 404 on PROD

**Symptom:** New endpoints deployed but returned 404 Not Found
**CI/CD Status:** Showed "completed + success"
**Root Cause:** Function files created but NOT registered in `src/app.js`

#### The Problem

```javascript
// I created these files:
src/functions/Analytics_LoginHistory.js
src/functions/Analytics_VisitorHistory.js
src/functions/Analytics_MapCenterHistory.js

// But forgot to add to src/app.js:
require('./functions/Analytics_LoginHistory');    // ← MISSING
require('./functions/Analytics_VisitorHistory');  // ← MISSING
require('./functions/Analytics_MapCenterHistory'); // ← MISSING
```

#### Why This Happened
- Azure Functions v4 Node.js programming model uses `app.js` as entry point
- Each function file self-registers with `app.http()` BUT must be imported in app.js
- I looked at existing `Analytics_VisitorHeatmap.js` for patterns but missed the app.js import

### ⚠️ CRITICAL CHECKLIST — New Azure Functions

**When creating new Azure Function files, ALWAYS:**

1. ✅ Create the function file in `src/functions/`
2. ✅ Register with `app.http()` in the file
3. ⚠️ **ADD `require()` to `src/app.js`** ← EASY TO FORGET!
4. ✅ Add to `public/swagger.json`
5. ✅ Test locally with `npm run dev` before deploying
6. ✅ Test on TEST before PROD

### What Worked Well
- Cross-project messaging (Sarah, Quinn, Dash coordination)
- Quick diagnosis once 404 was reported (~5 minutes)
- Fast recovery and redeployment
- Backwards compatibility (null appId for old records)

### What Didn't Work
- Deployed to PROD without local testing
- Missed the app.js registration step despite looking at existing patterns
- Wasted deployment cycle

### Prevention Measures
1. **Read this checklist** before creating new functions
2. **Test locally** with `func start` or `npm run dev`
3. **Grep for existing pattern**: `grep -l "require.*functions" src/app.js`

---

## Previous Sessions

No previous sessions recorded for this project.
