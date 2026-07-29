$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$Host.UI.RawUI.WindowTitle = "RelayDesk Yerel Sunucu"

Write-Host "RelayDesk yerel sunucusu başlatılıyor..." -ForegroundColor Cyan
& npm.cmd run dev
