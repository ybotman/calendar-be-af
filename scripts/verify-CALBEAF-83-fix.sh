#!/bin/bash
# scripts/verify-CALBEAF-83-fix.sh
# UC-0013 / CALBEAF-83 post-fix verification harness.
#
# Story 4.1.1 baseline scaffolding for Phase D Routing v0 round-trip closure.
# Runs against any environment via BASE_URL env var (default: TEST canonical
# from docs/CANONICAL-URLS.md).
#
# Usage:
#   ./scripts/verify-CALBEAF-83-fix.sh                       # against TEST
#   BASE_URL=http://localhost:7071 ./scripts/verify-CALBEAF-83-fix.sh
#   APP_ID=1 ./scripts/verify-CALBEAF-83-fix.sh
#
# Test data uses appId=99 by default (Pattern A test partition per memory rule
# feedback_test_mutator_compound_scope.md). Cleanup is manual via mongosh —
# script prints the correlation values at the end for sweep.

set -euo pipefail

BASE_URL="${BASE_URL:-https://calendarbeaf-test.azurewebsites.net}"
APP_ID="${APP_ID:-99}"
CORRELATION="$(date +%s)-$$"
EMAIL="e2e+CALBEAF83-verify-${CORRELATION}@example.com"
UID_A="fb-uid-A-CALBEAF83-verify-${CORRELATION}"
UID_B="fb-uid-B-CALBEAF83-verify-${CORRELATION}"

echo "=== CALBEAF-83 fix verification ==="
echo "BASE_URL: ${BASE_URL}"
echo "appId:    ${APP_ID}"
echo "email:    ${EMAIL}"
echo

# Step 0: env-ping pre-flight (per Gauge SAD Step 0 / docs/CANONICAL-URLS.md)
echo "Step 0: env-ping /api/health"
HEALTH=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/health")
if [ "${HEALTH}" != "200" ]; then
    echo "FAIL: /api/health returned ${HEALTH} (expected 200)"
    echo "      URL is stale or FA stopped; abort and re-resolve via docs/CANONICAL-URLS.md"
    exit 1
fi
echo "  /api/health -> 200 OK"
echo

# Step 1: First POST — uid-A (expected 201, record created)
echo "Step 1: POST userlogins with uid-A (expected 201)"
RES_1_CODE=$(curl -sS -o /tmp/c83-r1.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/userlogins" \
    -H "Content-Type: application/json" \
    -d "{\"firebaseUserId\":\"${UID_A}\",\"appId\":\"${APP_ID}\",\"firebaseUserInfo\":{\"email\":\"${EMAIL}\"}}")
if [ "${RES_1_CODE}" != "201" ]; then
    echo "FAIL: first POST returned ${RES_1_CODE} (expected 201)"
    cat /tmp/c83-r1.json
    exit 1
fi
echo "  first POST -> 201 OK"
echo

# Step 2: Second POST — uid-B same email
#   pre-fix: 201 dup record (BUG)
#   post-fix: 200 with rotated UID
echo "Step 2: POST userlogins with uid-B same email"
echo "        (post-fix expects 200; 201 here = pre-fix BUG NOT FIXED)"
RES_2_CODE=$(curl -sS -o /tmp/c83-r2.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/userlogins" \
    -H "Content-Type: application/json" \
    -d "{\"firebaseUserId\":\"${UID_B}\",\"appId\":\"${APP_ID}\",\"firebaseUserInfo\":{\"email\":\"${EMAIL}\"}}")

if [ "${RES_2_CODE}" = "201" ]; then
    echo "FAIL: second POST returned 201 — bug NOT fixed (duplicate created)"
    cat /tmp/c83-r2.json
    exit 1
fi
if [ "${RES_2_CODE}" != "200" ]; then
    echo "FAIL: second POST returned ${RES_2_CODE} (expected 200)"
    cat /tmp/c83-r2.json
    exit 1
fi
echo "  second POST -> 200 OK (record rotated, not duplicated)"
echo

# Step 3: Validate response shape — alternateFirebaseUserIds contains old UID
echo "Step 3: validate alternateFirebaseUserIds contains ${UID_A}"
if ! grep -q "${UID_A}" /tmp/c83-r2.json; then
    echo "FAIL: response does NOT contain old UID in alternateFirebaseUserIds"
    cat /tmp/c83-r2.json
    exit 1
fi
echo "  old UID preserved in alternates OK"
echo

# Step 4: GET by new UID resolves
echo "Step 4: GET /api/userlogins/firebase/${UID_B}?appId=${APP_ID}"
GET_CODE=$(curl -sS -o /tmp/c83-r4.json -w "%{http_code}" \
    "${BASE_URL}/api/userlogins/firebase/${UID_B}?appId=${APP_ID}")
if [ "${GET_CODE}" != "200" ]; then
    echo "FAIL: GET by new UID returned ${GET_CODE} (expected 200)"
    cat /tmp/c83-r4.json
    exit 1
fi
echo "  GET by new UID -> 200 OK"
echo

# Step 5: GET by old UID also resolves via alternates fallback
echo "Step 5: GET /api/userlogins/firebase/${UID_A}?appId=${APP_ID} (alternates fallback)"
GET_OLD_CODE=$(curl -sS -o /tmp/c83-r5.json -w "%{http_code}" \
    "${BASE_URL}/api/userlogins/firebase/${UID_A}?appId=${APP_ID}")
if [ "${GET_OLD_CODE}" != "200" ]; then
    echo "FAIL: GET by old UID returned ${GET_OLD_CODE} (expected 200 via alternates fallback)"
    cat /tmp/c83-r5.json
    exit 1
fi
echo "  GET by old UID via alternates -> 200 OK"
echo

echo "=== ALL CHECKS PASSED ==="
echo "CALBEAF-83 fix verified against ${BASE_URL}"
echo
echo "Cleanup hint (mongosh against TangoTiempoTest):"
echo "  db.userlogins.deleteMany({"
echo "    'firebaseUserInfo.email': '${EMAIL}',"
echo "    appId: '${APP_ID}'"
echo "  })"
echo
echo "Or by correlation:"
echo "  db.userlogins.deleteMany({"
echo "    firebaseUserId: { \$in: ['${UID_A}', '${UID_B}'] }"
echo "  })"
