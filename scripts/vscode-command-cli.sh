#!/usr/bin/env bash
set -euo pipefail

PORT="${VSCODE_COMMAND_CLI_PORT:-3005}"
COMMAND="${1:-}"

if [ -z "$COMMAND" ]; then
  echo "Usage: vscode-command-cli <vscode.commandId> [jsonArgsArray]" >&2
  echo "Example: vscode-command-cli workbench.action.showCommands" >&2
  exit 1
fi

if [ "${2:-}" != "" ]; then
  curl -sS -X POST "http://127.0.0.1:${PORT}/execute" \
    -H "Content-Type: application/json" \
    -d "{\"command\":\"${COMMAND}\",\"args\":${2}}"
else
  curl -sS "http://127.0.0.1:${PORT}/execute?command=${COMMAND}"
fi
