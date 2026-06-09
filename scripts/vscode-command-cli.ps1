param(
  [Parameter(Position = 0)]
  [string] $Command,

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]] $Arg = @(),

  [int] $Port = $(if ($env:VSCODE_COMMAND_CLI_PORT) { [int]$env:VSCODE_COMMAND_CLI_PORT } else { 3005 })
)

if (-not $Command) {
  Write-Error "Usage: .\vscode-command-cli.ps1 <vscode.commandId> [arg...]"
  exit 1
}

$query = @("command=$([uri]::EscapeDataString($Command))")
foreach ($item in $Arg) {
  $query += "arg=$([uri]::EscapeDataString($item))"
}

Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/execute?$($query -join '&')"
