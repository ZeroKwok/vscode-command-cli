#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-}"
URI_SCHEME="${VSCODE_COMMAND_CLI_URI_SCHEME:-vscode}"
EXTENSION_ID="zero.vscode-command-cli"

if [ -z "$COMMAND" ]; then
  echo "Usage: vscode-command-cli <vscode.commandId> [arg...]" >&2
  echo "Example: vscode-command-cli workbench.action.showCommands" >&2
  echo "Example: vscode-command-cli git.openRepository 'fsPath:H:\\Sandbox\\Development\\repo'" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node must be available to encode the command payload." >&2
  exit 1
fi

shift
PAYLOAD="$(node -e 'const [command, ...args] = process.argv.slice(1); process.stdout.write(Buffer.from(JSON.stringify({ command, args })).toString("base64url"));' "$COMMAND" "$@")"
URI="${URI_SCHEME}://${EXTENSION_ID}/v1/execute?p=${PAYLOAD}"

case "${OSTYPE:-}" in
  darwin*) open "$URI" ;;
  msys*|cygwin*|win32*) powershell.exe -NoProfile -NonInteractive -Command "Start-Process -FilePath '$URI'" ;;
  *) xdg-open "$URI" >/dev/null 2>&1 & ;;
esac
