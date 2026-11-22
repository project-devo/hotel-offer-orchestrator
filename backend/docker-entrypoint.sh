#!/bin/sh
# Starts the app. With EMBEDDED_TEMPORAL=true (single-container deploys such as Render's free tier),
# a Temporal dev server is started first on 127.0.0.1:7233 and stopped cleanly on SIGTERM/SIGINT.
set -u

if [ "${EMBEDDED_TEMPORAL:-false}" != "true" ]; then
  exec node dist/index.js
fi

echo "[entrypoint] starting embedded Temporal dev server on 127.0.0.1:7233"
temporal server start-dev --headless --ip 127.0.0.1 --port 7233 --log-level "${TEMPORAL_LOG_LEVEL:-warn}" &
TEMPORAL_PID=$!

waited=0
until temporal operator cluster health --address 127.0.0.1:7233 >/dev/null 2>&1; do
  if ! kill -0 "$TEMPORAL_PID" 2>/dev/null; then
    echo "[entrypoint] Temporal dev server exited during startup" >&2
    exit 1
  fi
  if [ "$waited" -ge 60 ]; then
    echo "[entrypoint] Temporal dev server not ready after 60s" >&2
    kill -TERM "$TEMPORAL_PID" 2>/dev/null
    exit 1
  fi
  waited=$((waited + 1))
  sleep 1
done
echo "[entrypoint] Temporal dev server ready after ${waited}s"

node dist/index.js &
NODE_PID=$!

stop() {
  echo "[entrypoint] stopping"
  kill -TERM "$NODE_PID" 2>/dev/null
  wait "$NODE_PID" 2>/dev/null
  kill -TERM "$TEMPORAL_PID" 2>/dev/null
  wait "$TEMPORAL_PID" 2>/dev/null
  exit 0
}
trap stop TERM INT

STATUS=0
wait "$NODE_PID" || STATUS=$?
# Node exited on its own: take the dev server down with it so the platform restarts the container.
kill -TERM "$TEMPORAL_PID" 2>/dev/null
wait "$TEMPORAL_PID" 2>/dev/null
exit "$STATUS"
