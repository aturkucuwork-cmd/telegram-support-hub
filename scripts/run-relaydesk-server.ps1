$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$currentNodeOptions = [string]$env:NODE_OPTIONS
if ($currentNodeOptions -notmatch '(^|\s)--use-system-ca(\s|$)') {
    $env:NODE_OPTIONS = ($currentNodeOptions + " --use-system-ca").Trim()
}

$Host.UI.RawUI.WindowTitle = "RelayDesk Yerel Sunucu"

Write-Host "RelayDesk yerel sunucusu başlatılıyor..." -ForegroundColor Cyan
& npm.cmd run dev
