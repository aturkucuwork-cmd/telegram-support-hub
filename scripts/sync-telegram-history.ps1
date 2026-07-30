$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot ".venv\Scripts\python.exe"
$requirementsPath = Join-Path $projectRoot "requirements-connect.txt"
$syncScript = Join-Path $PSScriptRoot "sync_telegram_history.py"

Set-Location -LiteralPath $projectRoot
$Host.UI.RawUI.WindowTitle = "RelayDesk Geçmiş Senkronizasyonu"

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "Python sanal ortamı bulunamadı. Önce connect-telegram-business.ps1 aracını çalıştırın."
}

& $pythonPath -c "import telethon, truststore" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Telegram senkronizasyon bileşenleri kuruluyor..." -ForegroundColor Cyan
    & $pythonPath -m pip install -r $requirementsPath
    if ($LASTEXITCODE -ne 0) {
        throw "Python bağımlılıkları kurulamadı."
    }
}

& $pythonPath $syncScript
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    Write-Host "`nGeçmiş senkronizasyonu tamamlandı. Paneli yenileyebilirsiniz." -ForegroundColor Green
} else {
    Write-Host "`nGeçmiş senkronizasyonu tamamlanamadı (kod: $exitCode)." -ForegroundColor Yellow
}

Read-Host "Pencereyi kapatmak için Enter'a basın"
$global:LASTEXITCODE = $exitCode
