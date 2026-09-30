param(
  [Parameter(Position = 0)]
  [string] $Command,

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]] $Arg = @(),

  [string] $UriScheme = $(if ($env:VSCODE_COMMAND_CLI_URI_SCHEME) { $env:VSCODE_COMMAND_CLI_URI_SCHEME } else { 'vscode' })
)

if (-not $Command) {
  Write-Error "Usage: .\vscode-command-cli.ps1 <vscode.commandId> [arg...]"
  exit 1
}

$payload = @{ command = $Command; args = [string[]] $Arg } | ConvertTo-Json -Compress -Depth 100
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$uri = "${UriScheme}://zero.vscode-command-cli/v1/execute?p=$encoded"

Start-Process -FilePath $uri
