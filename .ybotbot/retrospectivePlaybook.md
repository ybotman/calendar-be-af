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

## Previous Sessions

No previous sessions recorded for this project.
