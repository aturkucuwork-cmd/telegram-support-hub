$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot ".venv\Scripts\python.exe"
$requirementsPath = Join-Path $projectRoot "requirements-connect.txt"
$configureScript = Join-Path $PSScriptRoot "configure_telegram_user_listener.py"
$runnerScript = Join-Path $PSScriptRoot "run-telegram-user-listener.ps1"
$sessionPath = Join-Path $projectRoot ".telegram-user-session.dpapi"

Set-Location -LiteralPath $projectRoot
$Host.UI.RawUI.WindowTitle = "RelayDesk Telegram Kullanıcı Kurulumu"

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "Python sanal ortamı bulunamadı. Önce RelayDesk Telegram bağlantısını kurun."
}

& $pythonPath -c "import telethon, truststore" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Telegram bağlantı bileşenleri kuruluyor..." -ForegroundColor Cyan
    & $pythonPath -m pip install -r $requirementsPath
    if ($LASTEXITCODE -ne 0) {
        throw "Python bağımlılıkları kurulamadı."
    }
}

& $pythonPath $configureScript
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Kurulum tamamlanamadı." -ForegroundColor Red
    Read-Host "Pencereyi kapatmak için Enter"
    exit $LASTEXITCODE
}

$sessionItem = Get-Item -LiteralPath $sessionPath -Force
if (-not ($sessionItem.Attributes -band [IO.FileAttributes]::Hidden)) {
    $sessionItem.Attributes = $sessionItem.Attributes -bor [IO.FileAttributes]::Hidden
}

$listenerProcess = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { ([string]$_.CommandLine).Contains("telegram_user_long_poll.py") } |
    Select-Object -First 1
$serverReady = $false
try {
    $health = Invoke-WebRequest -Method Get -Uri "http://localhost:3000/api/auth/setup" -UseBasicParsing -TimeoutSec 3
    $serverReady = $health.StatusCode -eq 200
}
catch {
    $serverReady = $false
}

if (-not $listenerProcess -and $serverReady) {
    Start-Process powershell.exe `
        -WorkingDirectory $projectRoot `
        -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", $runnerScript)
    Write-Host "Grup ve kanal dinleyicisi ayrı pencerede başlatıldı." -ForegroundColor Green
}
elseif (-not $serverReady) {
    Write-Host "Oturum kaydedildi. Dinleyiciyi açmak için RelayDesk'i başlatın." -ForegroundColor Yellow
}
else {
    Write-Host "Grup ve kanal dinleyicisi zaten çalışıyor." -ForegroundColor Green
}
