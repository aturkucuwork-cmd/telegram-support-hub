$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"
$serverScript = Join-Path $PSScriptRoot "run-relaydesk-server.ps1"
$pollerScript = Join-Path $PSScriptRoot "telegram_long_poll.py"
$userListenerRunner = Join-Path $PSScriptRoot "run-telegram-user-listener.ps1"
$setupBridgeRunner = Join-Path $PSScriptRoot "run-local-setup-bridge.ps1"
$userSessionPath = Join-Path $projectRoot ".telegram-user-session.enc"
$pythonPath = Join-Path $projectRoot ".venv\Scripts\python.exe"
$requirementsPath = Join-Path $projectRoot "requirements-connect.txt"

Set-Location -LiteralPath $projectRoot
$Host.UI.RawUI.WindowTitle = "RelayDesk Telegram Bağlantısı"

if (-not (Test-Path -LiteralPath $envPath)) {
    [IO.File]::WriteAllLines(
        $envPath,
        @("TELEGRAM_BOT_TOKEN=", "TELEGRAM_WEBHOOK_SECRET=", "SUPPORT_ALLOWED_EMAILS=", "LOCAL_SETUP_TOKEN="),
        [Text.UTF8Encoding]::new($false)
    )
}

# localhost istekleri uygulama içinde demo@relaydesk.local kimliğiyle doğrulanır.
$envLines = @(Get-Content -LiteralPath $envPath)
$localAllowlist = "SUPPORT_ALLOWED_EMAILS=demo@relaydesk.local,indafelhayat@gmail.com"
$allowlistUpdated = $false
$setupTokenUpdated = $false
$existingSetupToken = $envLines |
    Where-Object { $_ -match '^\s*LOCAL_SETUP_TOKEN\s*=\s*(.+)\s*$' } |
    Select-Object -First 1
if ($existingSetupToken -match '^\s*LOCAL_SETUP_TOKEN\s*=\s*(.+)\s*$') {
    $localSetupToken = $matches[1].Trim()
}
else {
    $localSetupToken = & node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
}
$envLines = @(
    $envLines | ForEach-Object {
        if ($_ -match '^\s*SUPPORT_ALLOWED_EMAILS\s*=') {
            $allowlistUpdated = $true
            $localAllowlist
        }
        elseif ($_ -match '^\s*LOCAL_SETUP_TOKEN\s*=') {
            $setupTokenUpdated = $true
            "LOCAL_SETUP_TOKEN=$localSetupToken"
        }
        else {
            $_
        }
    }
)
if (-not $allowlistUpdated) {
    $envLines += $localAllowlist
}
if (-not $setupTokenUpdated) {
    $envLines += "LOCAL_SETUP_TOKEN=$localSetupToken"
}
[IO.File]::WriteAllLines($envPath, $envLines, [Text.UTF8Encoding]::new($false))

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "Python sanal ortamı bulunamadı. Önce connect-telegram-business.ps1 aracını çalıştırın."
}

& $pythonPath -c "import truststore" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Windows sertifika desteği kuruluyor..." -ForegroundColor Cyan
    & $pythonPath -m pip install -r $requirementsPath
    if ($LASTEXITCODE -ne 0) {
        throw "Python bağımlılıkları kurulamadı."
    }
}

$bridgeListener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $bridgeListener) {
    Start-Process powershell.exe `
        -WindowStyle Hidden `
        -WorkingDirectory $projectRoot `
        -ArgumentList @("-ExecutionPolicy", "Bypass", "-File", $setupBridgeRunner)
    Start-Sleep -Seconds 1
}
else {
    $bridgeProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($bridgeListener.OwningProcess)"
    if (-not ([string]$bridgeProcess.CommandLine).Contains("local_setup_bridge.py")) {
        throw "8765 portu başka bir uygulama tarafından kullanılıyor."
    }
}

$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    $commandLine = [string]$listenerProcess.CommandLine
    $normalizedRoot = $projectRoot.ToLowerInvariant()
    if (-not $commandLine.ToLowerInvariant().Contains($normalizedRoot)) {
        throw "3000 portu başka bir uygulama tarafından kullanılıyor (PID $($listener.OwningProcess))."
    }

    Write-Host "Eski RelayDesk sunucusu yeni ayarları yüklemek için yeniden başlatılıyor..."
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Seconds 2
}

Start-Process powershell.exe `
    -WorkingDirectory $projectRoot `
    -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", $serverScript)

Write-Host "RelayDesk sunucusunun hazır olması bekleniyor..."
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $health = Invoke-WebRequest -Method Get -Uri "http://localhost:3000/api/auth/setup" -UseBasicParsing -TimeoutSec 3
        if ($health.StatusCode -eq 200) {
            $ready = $true
            break
        }
    }
    catch {
        # Sunucu henüz açılmadı; beklemeye devam et.
    }
}
if (-not $ready) {
    throw "RelayDesk 30 saniye içinde hazır olmadı. 'RelayDesk Yerel Sunucu' penceresini kontrol edin."
}

Write-Host ""
Write-Host "RelayDesk hazır: http://localhost:3000" -ForegroundColor Green
Write-Host "Bu pencere açık kaldığı sürece Telegram mesajları alınır." -ForegroundColor Cyan
Write-Host ""

if (Test-Path -LiteralPath $userSessionPath) {
    $userListenerProcess = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { ([string]$_.CommandLine).Contains("telegram_user_long_poll.py") } |
        Select-Object -First 1
    if (-not $userListenerProcess) {
        Start-Process powershell.exe `
            -WorkingDirectory $projectRoot `
            -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", $userListenerRunner)
        Write-Host "Takip edilen grup ve kanal akışı ayrı pencerede başlatıldı." -ForegroundColor Green
    }
    else {
        Write-Host "Takip edilen grup ve kanal akışı zaten çalışıyor." -ForegroundColor Green
    }
}
else {
    Write-Host "Takip edilen gruplar, ilk kurulum ekranından bağlanacaktır." -ForegroundColor Yellow
}

while ($true) {
    $currentEnv = @(Get-Content -LiteralPath $envPath)
    $hasBotToken = [bool]($currentEnv | Where-Object { $_ -match '^TELEGRAM_BOT_TOKEN=.+$' } | Select-Object -First 1)
    $hasWebhookSecret = [bool]($currentEnv | Where-Object { $_ -match '^TELEGRAM_WEBHOOK_SECRET=.+$' } | Select-Object -First 1)
    if ($hasBotToken -and $hasWebhookSecret) {
        break
    }
    Write-Host "Bot ayarı bekleniyor: http://localhost:3000" -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}

& $pythonPath $pollerScript
