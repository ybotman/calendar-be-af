#!/bin/bash
# BE vs AF Parity Test Script
# Tests Express (3010) vs Azure Functions (7071 local, TEST)

EXPRESS="http://localhost:3010"
AF_LOCAL="http://localhost:7071"
AF_TEST="https://calendarbeaf-test.azurewebsites.net"

echo "=========================================="
echo "BE vs AF 1:1 PARITY TEST REPORT"
echo "=========================================="
echo "Date: $(date)"
echo ""
echo "Endpoints:"
echo "  Express: $EXPRESS"
echo "  AF Local: $AF_LOCAL"
echo "  AF TEST: $AF_TEST"
echo ""

# Function to extract JSON keys
get_keys() {
    echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(','.join(sorted(d.keys())))" 2>/dev/null || echo "ERROR"
}

get_pagination() {
    echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('pagination',{}); print(f\"total={p.get('total','?')}, page={p.get('page','?')}, limit={p.get('limit','?')}, pages={p.get('pages','?')}\")" 2>/dev/null || echo "ERROR"
}

get_array_key() {
    echo "$1" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for k in d.keys():
    if isinstance(d[k], list):
        print(k)
        break
" 2>/dev/null || echo "ERROR"
}

get_count() {
    key=$2
    echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('$key', d.get('data', []))))" 2>/dev/null || echo "0"
}

# Test each endpoint
echo "=========================================="
echo "1. CATEGORIES"
echo "=========================================="
EXP_CAT=$(curl -s "$EXPRESS/api/categories?appId=1&limit=3")
AFL_CAT=$(curl -s "$AF_LOCAL/api/categories?appId=1&limit=3")
AFT_CAT=$(curl -s "$AF_TEST/api/categories?appId=1&limit=3")

echo "Express keys: $(get_keys "$EXP_CAT")"
echo "AF Local keys: $(get_keys "$AFL_CAT")"
echo "AF TEST keys: $(get_keys "$AFT_CAT")"
echo ""
echo "Express array key: $(get_array_key "$EXP_CAT")"
echo "AF Local array key: $(get_array_key "$AFL_CAT")"
echo "AF TEST array key: $(get_array_key "$AFT_CAT")"
echo ""
echo "Express pagination: $(get_pagination "$EXP_CAT")"
echo "AF Local pagination: $(get_pagination "$AFL_CAT")"
echo "AF TEST pagination: $(get_pagination "$AFT_CAT")"
echo ""

echo "=========================================="
echo "2. EVENTS"
echo "=========================================="
EXP_EVT=$(curl -s "$EXPRESS/api/events?appId=1&limit=2")
AFL_EVT=$(curl -s "$AF_LOCAL/api/events?appId=1&limit=2")
AFT_EVT=$(curl -s "$AF_TEST/api/events?appId=1&limit=2")

echo "Express keys: $(get_keys "$EXP_EVT")"
echo "AF Local keys: $(get_keys "$AFL_EVT")"
echo "AF TEST keys: $(get_keys "$AFT_EVT")"
echo ""
echo "Express array key: $(get_array_key "$EXP_EVT")"
echo "AF Local array key: $(get_array_key "$AFL_EVT")"
echo "AF TEST array key: $(get_array_key "$AFT_EVT")"
echo ""
echo "Express pagination: $(get_pagination "$EXP_EVT")"
echo "AF Local pagination: $(get_pagination "$AFL_EVT")"
echo "AF TEST pagination: $(get_pagination "$AFT_EVT")"
echo ""

echo "=========================================="
echo "3. VENUES"
echo "=========================================="
EXP_VEN=$(curl -s "$EXPRESS/api/venues?appId=1&limit=2")
AFL_VEN=$(curl -s "$AF_LOCAL/api/venues?appId=1&limit=2")
AFT_VEN=$(curl -s "$AF_TEST/api/venues?appId=1&limit=2")

echo "Express keys: $(get_keys "$EXP_VEN")"
echo "AF Local keys: $(get_keys "$AFL_VEN")"
echo "AF TEST keys: $(get_keys "$AFT_VEN")"
echo ""
echo "Express array key: $(get_array_key "$EXP_VEN")"
echo "AF Local array key: $(get_array_key "$AFL_VEN")"
echo "AF TEST array key: $(get_array_key "$AFT_VEN")"
echo ""
echo "Express pagination: $(get_pagination "$EXP_VEN")"
echo "AF Local pagination: $(get_pagination "$AFL_VEN")"
echo "AF TEST pagination: $(get_pagination "$AFT_VEN")"
echo ""

echo "=========================================="
echo "4. ORGANIZERS"
echo "=========================================="
EXP_ORG=$(curl -s "$EXPRESS/api/organizers?appId=1&limit=2")
AFL_ORG=$(curl -s "$AF_LOCAL/api/organizers?appId=1&limit=2")
AFT_ORG=$(curl -s "$AF_TEST/api/organizers?appId=1&limit=2")

echo "Express keys: $(get_keys "$EXP_ORG")"
echo "AF Local keys: $(get_keys "$AFL_ORG")"
echo "AF TEST keys: $(get_keys "$AFT_ORG")"
echo ""
echo "Express array key: $(get_array_key "$EXP_ORG")"
echo "AF Local array key: $(get_array_key "$AFL_ORG")"
echo "AF TEST array key: $(get_array_key "$AFT_ORG")"
echo ""
echo "Express pagination: $(get_pagination "$EXP_ORG")"
echo "AF Local pagination: $(get_pagination "$AFL_ORG")"
echo "AF TEST pagination: $(get_pagination "$AFT_ORG")"
echo ""

echo "=========================================="
echo "5. ROLES"
echo "=========================================="
EXP_ROL=$(curl -s "$EXPRESS/api/roles?appId=1")
AFL_ROL=$(curl -s "$AF_LOCAL/api/roles?appId=1")
AFT_ROL=$(curl -s "$AF_TEST/api/roles?appId=1")

echo "Express keys: $(get_keys "$EXP_ROL")"
echo "AF Local keys: $(get_keys "$AFL_ROL")"
echo "AF TEST keys: $(get_keys "$AFT_ROL")"
echo ""
echo "Express array key: $(get_array_key "$EXP_ROL")"
echo "AF Local array key: $(get_array_key "$AFL_ROL")"
echo "AF TEST array key: $(get_array_key "$AFT_ROL")"
echo ""
echo "Express pagination: $(get_pagination "$EXP_ROL")"
echo "AF Local pagination: $(get_pagination "$AFL_ROL")"
echo "AF TEST pagination: $(get_pagination "$AFT_ROL")"
echo ""

echo "=========================================="
echo "PARITY SUMMARY"
echo "=========================================="
