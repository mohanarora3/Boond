#!/usr/bin/env bash
# Deploy Boond to AWS, end to end, from a Mac or Linux machine:
#
#   scripts/deploy.sh [reminder-email]
#
#   1. Backend: sam build + sam deploy (Lambda, API Gateway, DynamoDB, S3, SNS, EventBridge, Location)
#   2. Ward map data: building footprints -> S3 (demo/build_footprints.py --upload)
#   3. Demo data: 40 ward plans + the 5 Lodhi Road showcase plans -> DynamoDB (demo/seed_data.py)
#   4. Frontend: npm build with VITE_API_URL = the API, uploaded to AWS Amplify Hosting
#   5. Backend again, with CORS and reminder links pointing at the Amplify URL
#   6. Warm-up: calls every endpoint once (scripts/warm.sh)
#
# Safe to re-run: every step updates what is already there.
#
# Needs: AWS credentials (aws configure), AWS CLI v2, SAM CLI, make, Node 20+, zip, curl,
# and the repo's Python venv (.venv, Python 3.12) with boto3, duckdb and shapely installed.
#
# Settings (environment variables, all optional):
#   STACK=boond  AWS_REGION=us-east-1  AMPLIFY_APP=boond  BRANCH=main  SKIP_WARM=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK="${STACK:-boond}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
APP_NAME="${AMPLIFY_APP:-boond}"
BRANCH="${BRANCH:-main}"
EMAIL="${1:-${NOTIFY_EMAIL:-}}"
export AWS_REGION="${REGION}" AWS_DEFAULT_REGION="${REGION}"

# Bedrock model: Nova Lite through the cross-region inference profile for this part of the world
# (us. / eu. / apac.). Override with MODEL_ID=... if your account needs a different one.
case "${REGION}" in
  us-*) GEO="us" ;;
  eu-*) GEO="eu" ;;
  ap-*) GEO="apac" ;;
  *)    GEO="us" ;;
esac
MODEL_ID="${MODEL_ID:-${GEO}.amazon.nova-lite-v1:0}"

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- checks
for tool in aws sam make npm zip curl; do
  command -v "${tool}" >/dev/null 2>&1 || die "${tool} is not installed"
done
PY="${ROOT}/.venv/bin/python"
[ -x "${PY}" ] || die "Python venv not found at ${ROOT}/.venv (python3.12 -m venv .venv && .venv/bin/pip install boto3 duckdb shapely pytest)"
"${PY}" -c 'import sys; sys.exit(sys.version_info[:2] != (3, 12))' || die ".venv must be Python 3.12 (the Lambda runtime)"
"${PY}" -c 'import boto3, duckdb, shapely' 2>/dev/null || die "install the demo tools: .venv/bin/pip install boto3 duckdb shapely"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" || die "AWS credentials not set up (run: aws configure)"
echo "Account ${ACCOUNT}, region ${REGION}, stack ${STACK}, model ${MODEL_ID}"

# Bedrock check (not fatal: everything except chat and photo checks works without it)
if aws bedrock-runtime converse --model-id "${MODEL_ID}" \
     --messages '[{"role":"user","content":[{"text":"Reply OK"}]}]' \
     --inference-config '{"maxTokens":5}' >/dev/null 2>"${ROOT}/.bedrock_check.log"; then
  echo "Bedrock ${MODEL_ID}: OK"
else
  echo "WARNING: Bedrock ${MODEL_ID} failed in ${REGION}; chat and photo checks won't work until it does:"
  tail -2 "${ROOT}/.bedrock_check.log"
  echo "Enable Amazon Nova Lite under Bedrock > Model access in ${REGION}, or rerun with MODEL_ID=<another model id>."
fi
rm -f "${ROOT}/.bedrock_check.log"

# Our own bucket for the packaged Lambda code. (sam --resolve-s3 would create a helper stack,
# aws-sam-cli-managed-default, which some AWS Organizations block.)
ARTIFACT_BUCKET="${ARTIFACT_BUCKET:-boond-sam-artifacts-${ACCOUNT}-${REGION}}"
if ! aws s3api head-bucket --bucket "${ARTIFACT_BUCKET}" >/dev/null 2>&1; then
  if [ "${REGION}" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "${ARTIFACT_BUCKET}" >/dev/null
  else
    aws s3api create-bucket --bucket "${ARTIFACT_BUCKET}" \
      --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
  fi
  echo "Created deployment bucket ${ARTIFACT_BUCKET}"
fi

output() {
  aws cloudformation describe-stacks --stack-name "${STACK}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

deploy_backend() {  # $1 = frontend URL ("" on the first run)
  local params=("ReminderAfterDays=0" "BedrockTextModelId=${MODEL_ID}" "BedrockVisionModelId=${MODEL_ID}")
  [ -n "${EMAIL}" ] && params+=("NotificationEmail=${EMAIL}")
  if [ -n "$1" ]; then params+=("AllowedOrigin=$1" "FrontendUrl=$1"); fi
  (cd "${ROOT}/backend" && sam deploy --stack-name "${STACK}" --region "${REGION}" \
      --s3-bucket "${ARTIFACT_BUCKET}" --s3-prefix "${STACK}" \
      --capabilities CAPABILITY_IAM --no-confirm-changeset --no-fail-on-empty-changeset \
      --parameter-overrides "${params[@]}")
}

# ---------------------------------------------------------------- 1. backend
step "1/6 Building the backend"
# Lambda runs Linux on arm64. pip on a Mac would install macOS builds of compiled packages
# (pydantic-core, pillow) that fail to import on Lambda, so the dependency layer is built from
# Linux arm64 wheels by this Makefile (template.yaml: DepsLayer BuildMethod makefile).
cat > "${ROOT}/backend/layers/deps/Makefile" <<'MAKEFILE'
PYTHON ?= python3

build-DepsLayer:
	$(PYTHON) -m pip install -r requirements.txt --target "$(ARTIFACTS_DIR)/python" \
		--platform manylinux2014_aarch64 --implementation cp --python-version 3.12 \
		--only-binary=:all: --upgrade --quiet
MAKEFILE
# PATH: sam needs python3.12 for the functions; PYTHON: layers/deps/Makefile uses it for pip
(cd "${ROOT}/backend" && PATH="${ROOT}/.venv/bin:${PATH}" PYTHON="${PY}" sam build)

step "1/6 Deploying the backend"
EXISTING_URL=""
if aws cloudformation describe-stacks --stack-name "${STACK}" >/dev/null 2>&1; then
  EXISTING_URL="$(aws cloudformation describe-stacks --stack-name "${STACK}" \
    --query "Stacks[0].Parameters[?ParameterKey=='FrontendUrl'].ParameterValue" --output text)"
  [ "${EXISTING_URL}" = "None" ] && EXISTING_URL=""
fi
deploy_backend "${EXISTING_URL}"
API_URL="$(output ApiUrl)"
TABLE="$(output TableName)"
BUCKET="$(output BucketName)"
echo "API ${API_URL}"

# ---------------------------------------------------------------- 2. ward map data
step "2/6 Uploading ward building footprints to s3://${BUCKET}/public-data/wards/"
if [ -f "${ROOT}/demo/data/overture_buildings.parquet" ]; then
  (cd "${ROOT}" && "${PY}" demo/build_footprints.py --upload --bucket "${BUCKET}")
else
  echo "demo/data/overture_buildings.parquet is missing: run ${PY} demo/fetch_overture.py first. Skipping."
fi

# ---------------------------------------------------------------- 3. demo data
step "3/6 Seeding demo plans into ${TABLE}"
(cd "${ROOT}" && "${PY}" demo/seed_data.py --table "${TABLE}")

# ---------------------------------------------------------------- 4. frontend
step "4/6 Building the frontend against ${API_URL}"
(cd "${ROOT}/frontend" && npm ci --no-audit --no-fund && VITE_API_URL="${API_URL}" npm run build)

step "4/6 Deploying the frontend to Amplify Hosting (app '${APP_NAME}', branch '${BRANCH}')"
APP_ID="$(aws amplify list-apps --query "apps[?name=='${APP_NAME}'].appId | [0]" --output text)"
# Single-page app: every path without a file extension serves index.html, so /plan/<id> links work.
SPA_RULES='[{"source":"</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|geojson|gz|pdf)$)([^.]+$)/>","target":"/index.html","status":"200"}]'
if [ -z "${APP_ID}" ] || [ "${APP_ID}" = "None" ]; then
  APP_ID="$(aws amplify create-app --name "${APP_NAME}" --platform WEB \
    --custom-rules "${SPA_RULES}" --query app.appId --output text)"
  echo "Created Amplify app ${APP_ID}"
else
  REPO="$(aws amplify get-app --app-id "${APP_ID}" --query app.repository --output text)"
  if [ -n "${REPO}" ] && [ "${REPO}" != "None" ]; then
    die "Amplify app '${APP_NAME}' is connected to ${REPO}, so it builds from git pushes instead. Push to GitHub, or run with AMPLIFY_APP=boond-web to make a separate app."
  fi
  aws amplify update-app --app-id "${APP_ID}" --custom-rules "${SPA_RULES}" >/dev/null
fi
aws amplify get-branch --app-id "${APP_ID}" --branch-name "${BRANCH}" >/dev/null 2>&1 \
  || aws amplify create-branch --app-id "${APP_ID}" --branch-name "${BRANCH}" --stage PRODUCTION >/dev/null

ZIP="${ROOT}/frontend/.deploy.zip"
rm -f "${ZIP}"
(cd "${ROOT}/frontend/dist" && zip -qr "${ZIP}" .)
read -r JOB_ID UPLOAD_URL < <(aws amplify create-deployment --app-id "${APP_ID}" --branch-name "${BRANCH}" \
  --query '[jobId, zipUploadUrl]' --output text)
curl --fail --silent --show-error -X PUT -H "Content-Type: application/zip" --upload-file "${ZIP}" "${UPLOAD_URL}"
aws amplify start-deployment --app-id "${APP_ID}" --branch-name "${BRANCH}" --job-id "${JOB_ID}" >/dev/null
rm -f "${ZIP}"
printf 'Waiting for Amplify job %s' "${JOB_ID}"
STATUS="PENDING"
for _ in $(seq 1 60); do
  STATUS="$(aws amplify get-job --app-id "${APP_ID}" --branch-name "${BRANCH}" --job-id "${JOB_ID}" \
    --query job.summary.status --output text)"
  case "${STATUS}" in SUCCEED|FAILED|CANCELLED) break ;; esac
  printf '.'; sleep 5
done
echo " ${STATUS}"
[ "${STATUS}" = "SUCCEED" ] || die "Amplify deployment ${STATUS} (see the Amplify console)"
DOMAIN="$(aws amplify get-app --app-id "${APP_ID}" --query app.defaultDomain --output text)"
FRONTEND_URL="https://${BRANCH}.${DOMAIN}"

# ---------------------------------------------------------------- 5. CORS + reminder links
if [ "${EXISTING_URL}" != "${FRONTEND_URL}" ]; then
  step "5/6 Pointing CORS and reminder links at ${FRONTEND_URL}"
  deploy_backend "${FRONTEND_URL}"
else
  step "5/6 CORS already set for ${FRONTEND_URL}"
fi

# ---------------------------------------------------------------- 6. warm-up
if [ -z "${SKIP_WARM:-}" ]; then
  step "6/6 Warming every endpoint (first Bedrock call included)"
  bash "${ROOT}/scripts/warm.sh" "${API_URL}" || echo "Some endpoints failed; see above (chat needs Bedrock access to Amazon Nova Lite in ${REGION})."
fi

cat <<EOF

Done.
  App:        ${FRONTEND_URL}
  Demo plan:  ${FRONTEND_URL}/plan/demo-lodhi-road-planned
  Dashboard:  ${FRONTEND_URL}/dashboard
  API:        ${API_URL}
  Reminders:  aws lambda invoke --function-name $(output ReminderFunctionName) /dev/stdout
EOF
[ -n "${EMAIL}" ] && echo "  Confirm the SNS subscription email sent to ${EMAIL}, or reminders won't arrive."
exit 0
