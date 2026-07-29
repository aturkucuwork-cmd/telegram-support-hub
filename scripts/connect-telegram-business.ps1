$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$requirements = Join-Path $projectRoot "requirements-connect.txt"
$connector = Join-Path $PSScriptRoot "connect_telegram_business.py"

if (-not (Test-Path -LiteralPath $python)) {
  Write-Host "İzole Python ortamı hazırlanıyor..." -ForegroundColor Cyan
  python -m venv (Join-Path $projectRoot ".venv")
}

& $python -c "import telethon, truststore" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Telegram bağlantı bileşeni kuruluyor..." -ForegroundColor Cyan
  & $python -m pip install -r $requirements
}

& $python $connector
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
  Write-Host "`nBağlantı tamamlandı. Bu pencereyi kapatabilirsiniz." -ForegroundColor Green
} else {
  Write-Host "`nBağlantı tamamlanamadı (kod: $exitCode). Mesajı kontrol edip tekrar deneyin." -ForegroundColor Yellow
}

Read-Host "Pencereyi kapatmak için Enter'a basın"
exit $exitCode
