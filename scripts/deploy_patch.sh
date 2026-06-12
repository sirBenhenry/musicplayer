#!/usr/bin/env bash
# OPS-2 helper: upload changed backend files into the running container via
# Portainer archive API, then optionally restart.
# Usage: ./scripts/deploy_patch.sh [--restart]
set -euo pipefail
cd "$(dirname "$0")/.."

PORTAINER=https://10.1.8.4:9443
CID=f05355dcf876

TOKEN=$(curl -s -k -X POST "$PORTAINER/api/auth" \
  -H 'Content-Type: application/json' \
  -d '{"username":"ben","password":"Passw0rd@docker"}' \
  | grep -o '"jwt":"[^"]*"' | cut -d'"' -f4)
if [ -z "$TOKEN" ]; then echo "AUTH FAILED" >&2; exit 1; fi
echo "auth ok (token ${#TOKEN} chars)"

upload() { # upload <tarfile> <container-dir>
  local code
  code=$(curl -s -k -o /dev/null -w '%{http_code}' -X PUT \
    "$PORTAINER/api/endpoints/3/docker/containers/$CID/archive?path=$2" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/x-tar' \
    --data-binary @"$1")
  echo "$1 -> $2 : HTTP $code"
  [ "$code" = "200" ]
}

tar -cf /tmp/p_api.tar  -C backend/app/api       library.py queue.py admin.py
tar -cf /tmp/p_disc.tar -C backend/app/discovery artist_of_day.py new_genre.py
tar -cf /tmp/p_jobs.tar -C backend/app/jobs      library_sync.py eod.py
tar -cf /tmp/p_svc.tar  -C backend/app/services  essentia_svc.py

upload /tmp/p_api.tar  /app/app/api
upload /tmp/p_disc.tar /app/app/discovery
upload /tmp/p_jobs.tar /app/app/jobs
upload /tmp/p_svc.tar  /app/app/services

if [ "${1:-}" = "--restart" ]; then
  code=$(curl -s -k -o /dev/null -w '%{http_code}' -X POST \
    "$PORTAINER/api/endpoints/3/docker/containers/$CID/restart" \
    -H "Authorization: Bearer $TOKEN")
  echo "restart : HTTP $code"
fi
