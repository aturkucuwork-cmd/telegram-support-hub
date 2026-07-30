$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot ".venv\Scripts\python.exe"
$bridgeScript = Join-Path $PSScriptRoot "local_setup_bridge.py"

Set-Location -LiteralPath $projectRoot
& $pythonPath -u $bridgeScript
