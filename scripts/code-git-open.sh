#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_CLIENT="$SCRIPT_DIR/../bin/code-cli.exe"
REPOSITORY_PATH="$(cygpath -w -- "$(pwd)")"

if command -v code-cli.exe >/dev/null 2>&1; then
  exec code-cli.exe git.openRepository "fsPath:${REPOSITORY_PATH}"
fi

if [ -f "$LOCAL_CLIENT" ]; then
  exec "$LOCAL_CLIENT" git.openRepository "fsPath:${REPOSITORY_PATH}"
fi

echo "Error: code-cli.exe not found in PATH or $LOCAL_CLIENT. Run just build-cli first." >&2
exit 1
