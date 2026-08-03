$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot ".venv\Scripts\python.exe"
$listenerScript = Join-Path $PSScriptRoot "telegram_user_long_poll.py"
$sessionPath = Join-Path $projectRoot ".telegram-user-session.enc"

Set-Location -LiteralPath $projectRoot
$Host.UI.RawUI.WindowTitle = "RelayDesk Grup ve Kanal Akışı"

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "Python sanal ortamı bulunamadı."
}
if (-not (Test-Path -LiteralPath $sessionPath)) {
    throw "Şifreli Telegram kullanıcı oturumu bulunamadı. Önce kurulum aracını çalıştırın."
}

Write-Host "RelayDesk grup ve kanal akışı başlatılıyor..." -ForegroundColor Cyan
& $pythonPath -u $listenerScript
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Dinleyici hata ile durdu. Yukarıdaki açıklamayı kontrol edin." -ForegroundColor Red
    Read-Host "Pencereyi kapatmak için Enter"
}
