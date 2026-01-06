#!/bin/bash
# Create Google Geolocation API Epic in JIRA
# Uses credentials from macOS Keychain
# Based on successful 2025-01-28 session pattern

# Retrieve credentials (use toby.balsley@gmail.com account, NOT tobybalsley@me.com)
JIRA_EMAIL="toby.balsley@gmail.com"
JIRA_API_TOKEN=$(security find-generic-password -a "toby.balsley@gmail.com" -s "jira-api-token" -w 2>/dev/null)

if [ -z "$JIRA_API_TOKEN" ]; then
  echo "ERROR: Could not retrieve JIRA API token from keychain"
  echo "Tried: security find-generic-password -a 'toby.balsley@gmail.com' -s 'jira-api-token'"
  exit 1
fi

# Base64 encode for Basic Auth
AUTH=$(echo -n "${JIRA_EMAIL}:${JIRA_API_TOKEN}" | base64)

# Epic payload (JIRA wiki markup format for description)
PAYLOAD=$(cat <<'EOF'
{
  "fields": {
    "project": {
      "key": "TIEMPO"
    },
    "summary": "Google Geolocation API - Silent Location Bootstrap",
    "description": "h1. Business Value\nReduce friction for new users by providing silent, automatic location detection based on IP address with intelligent accuracy-based decision making.\n\nh2. Current State\n* Location System: Manual map-based selection only\n* Default Location: Boston, MA (42.3601, -71.0589) for ALL users globally\n* User Experience: Every new user must manually set location via map picker\n* Previous Attempt: ipapi.co implementation disabled in June 2025 due to 50-75% city-level accuracy\n\nh2. Desired State\n* Band A (≤20km accuracy): Silent automatic location acceptance - 80%+ confidence\n* Band B (20-80km accuracy): Map centered with toast \"We think you're near City X — Use / Change\"\n* Band C (>80km accuracy): Automatic map picker open with hint location\n* Manual Override: Users can always manually adjust location via existing map picker\n\nh2. Success Criteria\n* 80%+ users get accurate auto-location (Band A or B accepted without manual intervention)\n* Band A users: Silent bootstrap, no UI interaction required\n* Band B users: One-click acceptance with option to adjust\n* Band C users: Guided to map picker with approximate center\n* Telemetry: Correction rate tracking to validate band thresholds\n* Performance: Location bootstrap completes in <2 seconds\n\nh2. Reference Documents\n* /docs/TangoTiempo_Location_Bootstrap_IP_Only_Guideline.md\n* /docs/GEOLOCATION_GAP_ANALYSIS.md\n\nh2. Total Effort\n7 days (1.4 developer-weeks)\n\nh2. Stories\nSee attached gap analysis document for complete breakdown of 5 stories.",
    "issuetype": {
      "name": "Epic"
    },
    "labels": ["geolocation", "user-experience", "google-api", "location-bootstrap", "new-user-onboarding"]
  }
}
EOF
)

echo "Creating JIRA Epic..."
echo "URL: https://hdtsllc.atlassian.net/rest/api/2/issue"
echo "Project: TIEMPO"
echo "Email: ${JIRA_EMAIL}"
echo ""

# Create Epic (use API v2, not v3)
RESPONSE=$(curl -s -X POST \
  -H "Authorization: Basic ${AUTH}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "${PAYLOAD}" \
  "https://hdtsllc.atlassian.net/rest/api/2/issue")

# Parse response
EPIC_KEY=$(echo "${RESPONSE}" | jq -r '.key // empty')
ERROR_MSG=$(echo "${RESPONSE}" | jq -r '.errorMessages[]? // empty')
ERRORS=$(echo "${RESPONSE}" | jq -r '.errors // empty')

if [ -n "$EPIC_KEY" ]; then
  echo "✅ SUCCESS: Epic created"
  echo "Epic Key: ${EPIC_KEY}"
  echo "Epic URL: https://hdtsllc.atlassian.net/browse/${EPIC_KEY}"
  echo ""
  echo "Next steps:"
  echo "1. Attach docs/GEOLOCATION_GAP_ANALYSIS.md to Epic"
  echo "2. Create 5 stories using docs/JIRA_QUICK_CREATE_GUIDE.md"
  echo "3. Link stories to Epic ${EPIC_KEY}"
  exit 0
else
  echo "❌ ERROR: Epic creation failed"
  if [ -n "$ERROR_MSG" ]; then
    echo "Error Messages: ${ERROR_MSG}"
  fi
  if [ "$ERRORS" != "empty" ] && [ -n "$ERRORS" ]; then
    echo "Errors: ${ERRORS}"
  fi
  echo ""
  echo "Full Response:"
  echo "${RESPONSE}" | jq .
  exit 1
fi
