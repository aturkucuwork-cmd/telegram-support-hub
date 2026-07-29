$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"

Write-Host ""
Write-Host "RelayDesk - Yerel Telegram yapılandırması" -ForegroundColor Cyan
Write-Host "BotFather token'ı yalnızca bu bilgisayardaki .env.local dosyasına kaydedilir."
Write-Host "Token ekranda görünmez ve kaynak koduna eklenmez."
Write-Host ""

$secureToken = Read-Host "BotFather bot token'ını girin" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$plainToken = $null

try {
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    if ($plainToken -notmatch '^\d{5,20}:[A-Za-z0-9_-]{20,}$') {
        throw "Bot token biçimi geçersiz. BotFather tarafından verilen token'ı eksiksiz girin."
    }

    try {
        $getMeUri = "https://api.telegram.org/bot$plainToken/getMe"
        $botInfo = Invoke-RestMethod -Method Get -Uri $getMeUri -TimeoutSec 20
        if (-not $botInfo.ok -or -not $botInfo.result.username) {
            throw "Telegram bot bilgisi doğrulanamadı."
        }
    }
    catch {
        throw "Token Telegram tarafından doğrulanamadı. Token'ı ve internet bağlantısını kontrol edin."
    }

    $randomBytes = New-Object byte[] 32
    $randomNumberGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $randomNumberGenerator.GetBytes($randomBytes)
        $webhookSecret = -join ($randomBytes | ForEach-Object { $_.ToString("x2") })
    }
    finally {
        $randomNumberGenerator.Dispose()
    }

    $preservedLines = @()
    if (Test-Path -LiteralPath $envPath) {
        $preservedLines = @(
            Get-Content -LiteralPath $envPath |
                Where-Object {
                    $_ -notmatch '^\s*(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|SUPPORT_ALLOWED_EMAILS)\s*='
                }
        )
    }

    $envLines = @(
        $preservedLines
        "TELEGRAM_BOT_TOKEN=$plainToken"
        "TELEGRAM_WEBHOOK_SECRET=$webhookSecret"
        "SUPPORT_ALLOWED_EMAILS=demo@relaydesk.local,indafelhayat@gmail.com"
    )
    [IO.File]::WriteAllLines($envPath, $envLines, [Text.UTF8Encoding]::new($false))

    Write-Host ""
    Write-Host "Token doğrulandı: @$($botInfo.result.username)" -ForegroundColor Green
    Write-Host "Yerel ayarlar güvenle kaydedildi." -ForegroundColor Green
}
finally {
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    $plainToken = $null
    $secureToken = $null
}
