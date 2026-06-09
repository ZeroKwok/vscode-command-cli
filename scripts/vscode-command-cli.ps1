param(
  [Parameter(Mandatory = $true)]
  [string] $Command,

  [string] $ArgsJson = "[]",

  [int] $Port = $(if ($env:VSCODE_COMMAND_CLI_PORT) { [int]$env:VSCODE_COMMAND_CLI_PORT } else { 3005 })
)

$body = @{
  command = $Command
  args = $ArgsJson | ConvertFrom-Json
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/execute" -ContentType "application/json" -Body $body
