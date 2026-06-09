param(
  [Parameter(Position = 0)]
  [string] $Command,

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]] $Arg = @(),

  [string] $BaseUrl = $(if ($env:VSCODE_COMMAND_CLI_URL) { $env:VSCODE_COMMAND_CLI_URL } elseif ($env:VSCODE_COMMAND_CLI_PORT) { "http://127.0.0.1:$env:VSCODE_COMMAND_CLI_PORT" } else { "http://127.0.0.1:3005" })
)

if (-not $Command) {
  Write-Error "Usage: .\vscode-command-cli.ps1 <vscode.commandId> [arg...]"
  exit 1
}

$query = @("command=$([uri]::EscapeDataString($Command))")
foreach ($item in $Arg) {
  $query += "arg=$([uri]::EscapeDataString($item))"
}

Invoke-RestMethod -Method Get -Uri "$BaseUrl/execute?$($query -join '&')"
