#!/usr/bin/env bash
# TRACEFUSE — one command, one app.
# Sets up what is missing, builds the web UI when its sources changed, then serves the landing page,
# the Investigation Room, media and the API from a single FastAPI process on one port.
#
#   ./run.sh                  build if needed, then serve on http://127.0.0.1:8000
#   ./run.sh --port 9000      choose the port (or TRACEFUSE_PORT); --host likewise (TRACEFUSE_HOST)
#   ./run.sh --offline        no outbound provider calls (historical Ronin case still works)
#   ./run.sh --rebuild        force a fresh UI build;  --no-build  serve the existing build as-is
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
HOST="${TRACEFUSE_HOST:-127.0.0.1}"
PORT="${TRACEFUSE_PORT:-8000}"
BUILD=auto

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --offline) export TRACEFUSE_OFFLINE=1; shift ;;
    --rebuild) BUILD=always; shift ;;
    --no-build) BUILD=never; shift ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see ./run.sh --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;36m›\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ---- backend: Python virtualenv ------------------------------------------------------------------
if [ ! -x "$BACKEND/.venv/bin/uvicorn" ]; then
  PY="$(command -v python3 || true)"
  [ -n "$PY" ] || die "python3 not found (TRACEFUSE needs Python ≥ 3.11)"
  "$PY" -c 'import sys; sys.exit(sys.version_info < (3, 11))' || die "Python ≥ 3.11 required, found $("$PY" -V)"
  say "Creating backend/.venv and installing the API"
  "$PY" -m venv "$BACKEND/.venv"
  "$BACKEND/.venv/bin/pip" install --quiet -e "$BACKEND[dev]"
fi

# ---- frontend: dependencies and build -------------------------------------------------------------
needs_build() {
  [ "$BUILD" = always ] && return 0
  [ "$BUILD" = never ] && return 1
  [ -f "$FRONTEND/dist/index.html" ] || return 0
  # rebuild only when a UI source is newer than the last build
  [ -n "$(find "$FRONTEND/src" "$FRONTEND/public" "$FRONTEND/index.html" "$FRONTEND/package.json" "$FRONTEND/vite.config.ts" \
          -newer "$FRONTEND/dist/index.html" -print -quit 2>/dev/null)" ]
}

if needs_build; then
  command -v npm >/dev/null || die "npm not found (TRACEFUSE needs Node ≥ 20 to build the UI)"
  if [ ! -d "$FRONTEND/node_modules" ]; then
    say "Installing UI dependencies (npm ci)"
    (cd "$FRONTEND" && npm ci --no-audit --no-fund)
  fi
  say "Building the web UI"
  (cd "$FRONTEND" && npm run --silent build >/dev/null) || die "UI build failed — run 'cd frontend && npm run build' to see why"
elif [ ! -f "$FRONTEND/dist/index.html" ]; then
  die "no UI build found in frontend/dist (drop --no-build)"
else
  say "Web UI is up to date"
fi

# ---- one process: UI + media + API ------------------------------------------------------------------
say "TRACEFUSE on http://$HOST:$PORT  (landing /, Investigation Room /app, API /api)${TRACEFUSE_OFFLINE:+ · offline}"
cd "$BACKEND"
exec "$BACKEND/.venv/bin/uvicorn" tracefuse.api.app:app --host "$HOST" --port "$PORT"
