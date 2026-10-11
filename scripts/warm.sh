#!/usr/bin/env bash
# Call every local endpoint once before presenting, so nothing is cold on stage (including the first Bedrock call).
# Usage: scripts/warm.sh [API base, default http://localhost:3001]
set -u
API="${1:-http://localhost:3001}"
DEMO="demo-lodhi-road"   # seed_data.py prefix for the prepared Lodhi Road plans
fail=0

hit() {
  local method="$1" path="$2" body="${3:-}"
  local start code
  start=$(python3 -c 'import time; print(time.time())')
  if [ -n "$body" ]; then
    code=$(curl -s -o /dev/null -m 60 -w '%{http_code}' -X "$method" -H 'Content-Type: application/json' -d "$body" "$API$path")
  else
    code=$(curl -s -o /dev/null -m 60 -w '%{http_code}' -X "$method" "$API$path")
  fi
  printf '%-4s %-3s %5.1fs  %s\n' "$method" "$code" "$(python3 -c "import time; print(time.time() - $start)")" "$path"
  [[ "$code" =~ ^2 ]] || fail=1
}

hit GET /rules
hit GET /wards
for ward in lodhi-road lajpat-nagar mayur-vihar rohini dwarka; do
  hit GET "/wards/$ward"
  hit GET "/wards/$ward/simulate"
done
hit GET /dashboard
hit GET /dashboard/attention
hit GET "/dashboard/gap?ward=Lodhi%20Road"
for status in planned applied installed needs-attention verified; do
  hit GET "/plans/$DEMO-$status"
done
hit GET "/plans/$DEMO-verified/impact"
hit GET "/verify/$DEMO-verified"
hit GET "/plans/$DEMO-planned/chat"
# Warm Bedrock on a throwaway plan so the demo plans' chat history stays empty (suggestion chips show).
TMP=$(curl -s -X POST -H 'Content-Type: application/json' "$API/plans" \
  -d '{"address":"Warm-up","lat":28.5897,"lon":77.2163,"ward":"Warm-up","roofAreaM2":100,"plotAreaM2":120,"residents":4,"openSpace":true}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["planId"])')
hit POST "/plans/$TMP/chat" '{"message":"Is this required for me?","lang":"en"}'

if [ "$fail" -ne 0 ]; then
  echo "Some endpoints failed — fix before presenting." >&2
  exit 1
fi
echo "All warm."
