#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${VSCODE_COMMAND_CLI_URL:-http://127.0.0.1:${VSCODE_COMMAND_CLI_PORT:-3005}}"
COMMAND="${1:-}"

if [ -z "$COMMAND" ]; then
  echo "Usage: vscode-command-cli <vscode.commandId> [arg...]" >&2
  echo "Example: vscode-command-cli workbench.action.showCommands" >&2
  echo "Example: vscode-command-cli git.openRepository 'fsPath:H:\\Sandbox\\Development\\repo'" >&2
  exit 1
fi

shift

curl_args=(-sS --get --data-urlencode "command=${COMMAND}")
for arg in "$@"; do
  curl_args+=(--data-urlencode "arg=${arg}")
done

curl "${curl_args[@]}" "${BASE_URL}/execute"
