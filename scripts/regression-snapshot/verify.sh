#!/bin/bash
# Re-run baseline queries and diff against captured baseline.
# Run AFTER merge + Azure rollout (~2min).
#
# Usage:
#   ./verify.sh --env=prod
#   ./verify.sh --env=test
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASELINES_DIR="$SCRIPT_DIR/baselines"

ENV=""
EXPECTED_VERSION=""
for arg in "$@"; do
  case "$arg" in
    --env=prod) ENV="prod" ;;
    --env=test) ENV="test" ;;
    --expected-version=*) EXPECTED_VERSION="${arg#--expected-version=}" ;;
  esac
done

if [ -z "$ENV" ]; then
  echo "Usage: $0 --env=prod|test [--expected-version=X.Y.Z]"
  exit 1
fi

case "$ENV" in
  prod) BASE="https://calendarbeaf-prod.azurewebsites.net" ;;
  test) BASE="https://calendarbeaf-test.azurewebsites.net" ;;
esac

cd "$BASELINES_DIR"

ok=0; fail=0
chk() {
  local label="$1"; local expected="$2"; local actual="$3"
  if [ "$expected" = "$actual" ]; then echo "  ✅ $label: $actual"; ok=$((ok+1));
  else echo "  ❌ $label: expected=$expected actual=$actual"; fail=$((fail+1)); fi
}

echo "==================================================================="
echo "POST-DEPLOY VERIFICATION — calendarbeaf-$ENV"
echo "==================================================================="

echo ""
echo "[1] Health/version"
v=$(curl -s --max-time 10 "$BASE/api/health/version" | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).version)")
if [ -n "$EXPECTED_VERSION" ]; then
  chk "version" "$EXPECTED_VERSION" "$v"
else
  pre_v=$(node -e "console.log(JSON.parse(require('fs').readFileSync('health-pre.json')).version)")
  echo "  pre=$pre_v post=$v (no --expected-version given; informational only)"
fi

echo ""
echo "[2] CALBEAF-132 RISKY: TW WITHOUT Referer"
code=$(curl -s -o /tmp/tw-noref-post.json -w "%{http_code}" --max-time 10 "$BASE/api/events?travelWorthy=true&appId=1&start=2026-04-01&end=2026-12-31&page=1")
chk "TW-no-referer status (post-CALBEAF-132 must be 403)" "403" "$code"

echo ""
echo "[3] CALBEAF-132 SAFE: TW WITH Referer"
code=$(curl -s -H "Referer: https://tangotiempo.com/explore" -o tw-ref-post.json -w "%{http_code}" --max-time 10 "$BASE/api/events?travelWorthy=true&appId=1&start=2026-04-01&end=2026-12-31&page=1")
chk "TW-with-referer status" "200" "$code"
pre_total=$(node -e "console.log(JSON.parse(require('fs').readFileSync('tw-ref-pre.json')).pagination?.total || 0)")
post_total=$(node -e "console.log(JSON.parse(require('fs').readFileSync('tw-ref-post.json')).pagination?.total || 0)")
chk "TW-with-referer pagination.total" "$pre_total" "$post_total"

echo ""
echo "[4] CALBEAF-146 RISKY: TW limit=500"
curl -s -H "Referer: https://tangotiempo.com/explore" -o tw-cap-post.json --max-time 10 "$BASE/api/events?travelWorthy=true&appId=1&start=2026-01-01&end=2026-12-31&limit=500"
pre_len=$(node -e "console.log(JSON.parse(require('fs').readFileSync('tw-cap-pre.json')).events?.length || 0)")
post_len=$(node -e "console.log(JSON.parse(require('fs').readFileSync('tw-cap-post.json')).events?.length || 0)")
post_lim=$(node -e "console.log(JSON.parse(require('fs').readFileSync('tw-cap-post.json')).pagination?.limit || 0)")
chk "TW-cap events.length unchanged" "$pre_len" "$post_len"
chk "TW-cap pagination.limit raised" "500" "$post_lim"

echo ""
echo "[4b] CALBEAF-146 BOUNDARY: limit handling at edges"
post_lim200=$(curl -s -H "Referer: https://tangotiempo.com/explore" --max-time 10 "$BASE/api/events?travelWorthy=true&appId=1&start=2026-01-01&end=2026-12-31&limit=200" | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).pagination?.limit || 0)")
post_lim600=$(curl -s -H "Referer: https://tangotiempo.com/explore" --max-time 10 "$BASE/api/events?travelWorthy=true&appId=1&start=2026-01-01&end=2026-12-31&limit=600" | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).pagination?.limit || 0)")
post_lim1=$(curl -s -H "Referer: https://tangotiempo.com/explore" --max-time 10 "$BASE/api/events?travelWorthy=true&appId=1&start=2026-01-01&end=2026-12-31&limit=1" | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).pagination?.limit || 0)")
chk "limit=200 honored" "200" "$post_lim200"
chk "limit=600 capped to ceiling 500" "500" "$post_lim600"
chk "limit=1 passthrough" "1" "$post_lim1"

echo ""
echo "[5] Non-TW events (regression sanity)"
curl -s -o events-april-post.json --max-time 10 "$BASE/api/events?appId=1&start=2026-04-25&end=2026-04-28&limit=20"
pre_t=$(node -e "console.log(JSON.parse(require('fs').readFileSync('events-april-pre.json')).pagination?.total || 0)")
post_t=$(node -e "console.log(JSON.parse(require('fs').readFileSync('events-april-post.json')).pagination?.total || 0)")
chk "non-TW events total" "$pre_t" "$post_t"

echo ""
echo "[6] CALBEAF-143: high-role user populate counts"
while read uid; do
  [ -z "$uid" ] && continue
  curl -s --max-time 10 "$BASE/api/userlogins/firebase/$uid?appId=1" -o "ul-${uid:0:12}-post.json"
  pre_n=$(node -e "console.log((JSON.parse(require('fs').readFileSync('ul-${uid:0:12}-pre.json')).roleIds||[]).length)")
  post_n=$(node -e "console.log((JSON.parse(require('fs').readFileSync('ul-${uid:0:12}-post.json')).roleIds||[]).length)")
  chk "$uid roles count" "$pre_n" "$post_n"
done < high-role-uids-pre.txt

echo ""
echo "[7] /api/roles?appId=1 total"
curl -s -o roles-post.json --max-time 10 "$BASE/api/roles?appId=1&limit=20"
pre_r=$(node -e "console.log(JSON.parse(require('fs').readFileSync('roles-pre.json')).pagination?.total || 0)")
post_r=$(node -e "console.log(JSON.parse(require('fs').readFileSync('roles-post.json')).pagination?.total || 0)")
chk "roles total" "$pre_r" "$post_r"

echo ""
echo "[8] /api/categories?appId=1 total"
curl -s -o cats-post.json --max-time 10 "$BASE/api/categories?appId=1&limit=20"
pre_c=$(node -e "console.log(JSON.parse(require('fs').readFileSync('cats-pre.json')).pagination?.total || 0)")
post_c=$(node -e "console.log(JSON.parse(require('fs').readFileSync('cats-post.json')).pagination?.total || 0)")
chk "categories total" "$pre_c" "$post_c"

echo ""
echo "[9] /api/venues + /api/organizers totals"
curl -s -o venues-post.json --max-time 10 "$BASE/api/venues?appId=1&limit=3"
curl -s -o orgs-post.json --max-time 10 "$BASE/api/organizers?appId=1&limit=3"
pre_v=$(node -e "console.log(JSON.parse(require('fs').readFileSync('venues-pre.json')).pagination?.total || 0)")
post_v=$(node -e "console.log(JSON.parse(require('fs').readFileSync('venues-post.json')).pagination?.total || 0)")
pre_o=$(node -e "console.log(JSON.parse(require('fs').readFileSync('orgs-pre.json')).pagination?.total || 0)")
post_o=$(node -e "console.log(JSON.parse(require('fs').readFileSync('orgs-post.json')).pagination?.total || 0)")
chk "venues total" "$pre_v" "$post_v"
chk "organizers total" "$pre_o" "$post_o"

echo ""
echo "==================================================================="
echo "RESULT: $ok passed / $fail failed"
echo "==================================================================="
[ $fail -eq 0 ] && echo "✅ ALL GREEN — safe to greenlight downstream FE/dashboard deploys." || echo "⚠️  Some checks failed — review above before signaling downstream."
exit $fail
