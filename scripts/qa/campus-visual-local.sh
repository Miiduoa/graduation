#!/usr/bin/env bash
# Run the production build with browser fixtures and a restricted local server.
set -euo pipefail
cd "$(dirname "$0")/../.."

test -f apps/web/.next/standalone/apps/web/server.js
mkdir -p apps/web/.next/standalone/apps/web/.next/static
mkdir -p apps/web/.next/standalone/apps/web/public artifacts/campus-visual
cp -a apps/web/.next/static/. apps/web/.next/standalone/apps/web/.next/static/
cp -a apps/web/public/. apps/web/.next/standalone/apps/web/public/

# This uses the existing origin setting; the guard additionally refuses every
# external fetch/TCP destination before connecting. No real account is supplied.
journey_run_id=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
NUNI_API_BASE_URL=https://127.0.0.1:1 HOSTNAME=127.0.0.1 PORT=3137 TZ=Asia/Taipei \
  NUNI_QA_RUN_ID="$journey_run_id" CAMPUS_LEGACY_ENABLED=false FILE_STORAGE_BACKEND='' \
  NODE_OPTIONS="--import $PWD/scripts/qa/campus-visual-local-network.mjs" \
  node apps/web/.next/standalone/apps/web/server.js > artifacts/campus-visual/server.log 2>&1 &
journey_server_pid=$!
trap 'kill "$journey_server_pid" 2>/dev/null || true' EXIT
node --input-type=module - "$journey_server_pid" "$journey_run_id" <<'JS'
const serverPid = Number(process.argv[2]);
const runId = process.argv[3];
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  process.kill(serverPid, 0);
  try {
    const response = await fetch('http://127.0.0.1:3137/health/live', { redirect: 'error' });
    if (response.ok && response.headers.get('X-Nuni-QA-Run') === runId) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 200));
}
if (!ready) throw new Error('Local production server did not become ready');
process.kill(serverPid, 0);
JS
CAMPUS_VISUAL_URL=http://127.0.0.1:3137 TZ=Asia/Taipei python scripts/campus-visual-smoke.py
