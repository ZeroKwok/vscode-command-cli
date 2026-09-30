set shell := ["powershell.exe", "-NoProfile", "-Command"]

vscode_cli := env_var_or_default("VSCODE_CLI", "code")
test_cli_dir := "G:\\Local\\bin"
test_script_dir := "G:\\Local\\sbin\\scripts"

default:
    @just --list --unsorted

check:
    npm run lint
    go test ./cli

build-extension:
    npm run package

build-cli:
    npm run build:client

build: build-extension build-cli

install-extension: build-extension
    & '{{vscode_cli}}' --install-extension bin\vscode-command-cli.vsix --force
    Write-Host 'VS Code extension installed. Reload VS Code windows to activate it.'

install: install-extension 

test-install: install-extension build-cli
    New-Item -ItemType Directory -Force -Path '{{test_cli_dir}}', '{{test_script_dir}}' | Out-Null
    Copy-Item -LiteralPath bin\code-cli.exe -Destination '{{test_cli_dir}}\code-cli.exe' -Force
    Copy-Item -LiteralPath scripts\code-git-open.sh -Destination '{{test_script_dir}}\code-git-open.sh' -Force
    Write-Host 'Test CLI installed to {{test_cli_dir}} and test scripts installed to {{test_script_dir}}'
