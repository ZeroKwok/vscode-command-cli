set shell := ["powershell.exe", "-NoProfile", "-Command"]

vscode_cli := env_var_or_default("VSCODE_CLI", "code")

default:
    @just --list --unsorted

check:
    npm run lint
    go test ./cli

build-extension:
    npm run package

build-cli:
    New-Item -ItemType Directory -Force -Path bin | Out-Null
    go build -o bin/code-cli.exe ./cli

build: build-extension build-cli

install-extension: build-extension
    & '{{vscode_cli}}' --install-extension bin\vscode-command-cli.vsix --force
    Write-Host 'VS Code extension installed. Reload VS Code windows to activate it.'

install: install-extension
