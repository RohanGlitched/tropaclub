#!/usr/bin/env bash
# Deploy the Tropa Club indexer as a Cloud Run job + a Cloud Scheduler trigger every 6 hours.
# Usage: bash indexer/deploy.sh            (from app/ or indexer/; needs an authenticated gcloud)
#        bash indexer/deploy.sh --run      (also start one execution and wait for it)
set -euo pipefail

PROJECT=project-5523359e-5941-4df4-998
REGION=us-central1
JOB=tropa-indexer
BUCKET=tropaclub-data
SA_NAME=tropa-indexer
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
SCHED_SA_NAME=tropa-indexer-trigger
SCHED_SA="$SCHED_SA_NAME@$PROJECT.iam.gserviceaccount.com"
SCHED_JOB=tropa-indexer-every-6h
SCHEDULE="17 */6 * * *"   # 00:17, 06:17, 12:17, 18:17 UTC. Do not schedule more often (credits).

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
G="gcloud --project=$PROJECT --quiet"

echo "== runtime service account (storage on $BUCKET only)"
$G iam service-accounts describe "$SA" >/dev/null 2>&1 || $G iam service-accounts create "$SA_NAME" --display-name="Tropa indexer runtime"
$G storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectAdmin --condition=None >/dev/null

echo "== stage build context"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/indexer" "$STAGE/shared"
cp "$HERE/package.json" "$HERE/package-lock.json" "$HERE/tsconfig.json" "$STAGE/indexer/"
cp -r "$HERE/src" "$HERE/data" "$STAGE/indexer/"
cp "$APP/shared/types.ts" "$STAGE/shared/"
cp "$HERE/Dockerfile" "$STAGE/Dockerfile"

echo "== build + deploy job $JOB"
$G run jobs deploy "$JOB" --source="$STAGE" --region="$REGION" \
  --service-account="$SA" --tasks=1 --max-retries=1 --cpu=1 --memory=2Gi --task-timeout=3600s \
  --set-env-vars="BUCKET=$BUCKET,STATE_BUCKET=tropaclub-state"

echo "== scheduler trigger"
$G iam service-accounts describe "$SCHED_SA" >/dev/null 2>&1 || $G iam service-accounts create "$SCHED_SA_NAME" --display-name="Tropa indexer scheduler trigger"
$G run jobs add-iam-policy-binding "$JOB" --region="$REGION" --member="serviceAccount:$SCHED_SA" --role=roles/run.invoker >/dev/null
URI="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$JOB:run"
if $G scheduler jobs describe "$SCHED_JOB" --location="$REGION" >/dev/null 2>&1; then
  $G scheduler jobs update http "$SCHED_JOB" --location="$REGION" --schedule="$SCHEDULE" --time-zone=UTC --uri="$URI" --http-method=POST --oauth-service-account-email="$SCHED_SA"
else
  $G scheduler jobs create http "$SCHED_JOB" --location="$REGION" --schedule="$SCHEDULE" --time-zone=UTC --uri="$URI" --http-method=POST --oauth-service-account-email="$SCHED_SA"
fi

if [[ "${1:-}" == "--run" ]]; then
  echo "== one execution (waits)"
  $G run jobs execute "$JOB" --region="$REGION" --wait
fi
echo "done"
