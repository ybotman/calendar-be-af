#!/bin/bash
# Capture baseline endpoint responses from a calendar-be-af environment.
# Run BEFORE merging TEST → PROD (or DEVL → TEST) so verify.sh can diff.
#
# Usage:
#   ./capture-baseline.sh --env=prod
#   ./capture-baseline.sh --env=test
#
# Output: baselines/*-pre.json (gitignored).
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASELINES_DIR="$SCRIPT_DIR/baselines"
mkdir -p "$BASELINES_DIR"

ENV=""
for arg in "$@"; do
  case "$arg" in
    --env=prod) ENV="prod" ;;
    --env=test) ENV="test" ;;
  esac
done

if [ -z "$ENV" ]; then
  echo "Usage: $0 --env=prod|test"
  exit 1
fi

case "$ENV" in
  prod) BASE="https://calendarbeaf-prod.azurewebsites.net" ;;
  test) BASE="https://calendarbeaf-test.azurewebsites.net" ;;
esac

cd "$BASELINES_DIR"
rm -f *-pre.json *-pre.txt 2>/dev/null

echo "=== Capturing baseline from $ENV ($BASE) ==="

echo "[1] Health/version"
curl -s --max-time 5 "$BASE/api/health/version" -o health-pre.json
node -e "console.log('  version:', JSON.parse(require('fs').readFileSync('health-pre.json')).version)"

echo "[2] TW WITHOUT Referer"
curl -s -o tw-noref-pre.json -w "  status=%{http_code}\n" --max-time 10 \
  "$BASE/api/events?travelWorthy=true&appId=1&start=2026-04-01&end=2026-12-31&page=1"

echo "[3] TW WITH Referer"
curl -s -H "Referer: https://tangotiempo.com/explore" -o tw-ref-pre.json -w "  status=%{http_code}\n" --max-time 10 \
  "$BASE/api/events?travelWorthy=true&appId=1&start=2026-04-01&end=2026-12-31&page=1"

echo "[4] TW with limit=500 (cap-impact check)"
curl -s -H "Referer: https://tangotiempo.com/explore" -o tw-cap-pre.json --max-time 10 \
  "$BASE/api/events?travelWorthy=true&appId=1&start=2026-01-01&end=2026-12-31&limit=500"

echo "[5] Non-TW events (regression sanity)"
curl -s -o events-april-pre.json --max-time 10 \
  "$BASE/api/events?appId=1&start=2026-04-25&end=2026-04-28&limit=20"

echo "[6] /api/userlogins/all sample (find high-role users)"
curl -s -o ul-all50-pre.json --max-time 15 "$BASE/api/userlogins/all?appId=1&limit=50"

echo "[7] High-role user populates (CALBEAF-143-relevant)"
node -e '
const r = JSON.parse(require("fs").readFileSync("ul-all50-pre.json"));
const candidates = (r.users||[]).filter(u => (u.roleIds||[]).length >= 3).slice(0, 5);
for (const u of candidates) console.log(u.firebaseUserId);
' > high-role-uids-pre.txt

while read uid; do
  [ -z "$uid" ] && continue
  curl -s --max-time 10 "$BASE/api/userlogins/firebase/$uid?appId=1" -o "ul-${uid:0:12}-pre.json"
  node -e "
    const r = JSON.parse(require('fs').readFileSync('ul-${uid:0:12}-pre.json'));
    const roles = (r.roleIds||[]).map(x => typeof x === 'object' ? x.roleName : 'raw-id');
    console.log('  ${uid:0:12}... ('+roles.length+'):', roles.join(', '));
  "
done < high-role-uids-pre.txt

echo "[8] /api/roles?appId=1"
curl -s -o roles-pre.json --max-time 10 "$BASE/api/roles?appId=1&limit=20"

echo "[9] /api/categories?appId=1"
curl -s -o cats-pre.json --max-time 10 "$BASE/api/categories?appId=1&limit=20"

echo "[10] /api/venues + /api/organizers"
curl -s -o venues-pre.json --max-time 10 "$BASE/api/venues?appId=1&limit=3"
curl -s -o orgs-pre.json --max-time 10 "$BASE/api/organizers?appId=1&limit=3"

echo ""
echo "=== Baseline captured to $BASELINES_DIR ==="
echo "Run ./verify.sh --env=$ENV after the deploy lands."
