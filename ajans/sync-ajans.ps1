# sync-ajans.ps1
# Bir uygulama klasöründe çalıştırılır.
# GitHub'daki ajans-system reposundan son versiyonu kontrol eder,
# delta'yı (sadece değişen dosyaları) gösterir, onay alır, uygular,
# otomatik git commit + push yapar.
#
# Kullanım:
#   .\sync-ajans.ps1
#   .\sync-ajans.ps1 -Repo "kullanici/ajans-system"
#   $env:GH_TOKEN = "ghp_xxx"; .\sync-ajans.ps1   # private repo için

[CmdletBinding()]
param(
    [string]$Repo = "aturkucuwork-cmd/ajans-system",
    [string]$Branch = "main",
    [string]$ProjectRoot = "."
)

$ErrorActionPreference = "Stop"

# Proje köküne geç
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
Set-Location $ProjectRoot

Write-Host ""
Write-Host "Ajans sync - $Repo" -ForegroundColor Cyan
Write-Host ("  Proje klasörü : {0}" -f $ProjectRoot)

# === 1) Projedeki mevcut versiyonu oku ===
$versionFile = Join-Path $ProjectRoot ".ajans-version"
$current = "v0.0.0"
if (Test-Path $versionFile) {
    $current = (Get-Content $versionFile -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($current)) { $current = "v0.0.0" }
}
Write-Host ("  Mevcut       : {0}" -f $current)

# === 2) GitHub'dan latest tag/release bilgisi çek ===
$headers = @{
    "User-Agent" = "ajans-sync/1.0"
    "Accept"     = "application/vnd.github+json"
}
if ($env:GH_TOKEN) {
    $headers["Authorization"] = "token $env:GH_TOKEN"
    Write-Host "  Auth         : GH_TOKEN kullanılıyor" -ForegroundColor Gray
} else {
    Write-Host "  Auth         : public (token yok)" -ForegroundColor Gray
}

# Önce releases API dene
$apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
$latest = $null
$source = ""
try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers $headers -ErrorAction Stop
    $latest = $release.tag_name
    $source = "releases API"
} catch {
    # releases boş olabilir; tags API dene
    $tagsUrl = "https://api.github.com/repos/$Repo/tags?per_page=1"
    try {
        $tags = Invoke-RestMethod -Uri $tagsUrl -Headers $headers -ErrorAction Stop
        if ($tags -and $tags.Count -gt 0) {
            $latest = $tags[0].name
            $source = "tags API"
        }
    } catch {
        Write-Host ""
        Write-Host "GitHub'dan versiyon bilgisi alınamadı." -ForegroundColor Red
        Write-Host "Repo public ise: repo mevcut mu, internet var mı kontrol et." -ForegroundColor Red
        Write-Host "Repo private ise: `$env:GH_TOKEN = '<token>' ayarla, sonra tekrar dene." -ForegroundColor Red
        Write-Host ("Hata: {0}" -f $_.Exception.Message) -ForegroundColor DarkRed
        exit 1
    }
}

if (-not $latest) {
    Write-Host "Hiç tag bulunamadı. Repo boş olabilir." -ForegroundColor Yellow
    exit 1
}
Write-Host ("  Son sürüm    : {0} ({1})" -f $latest, $source)

# === 3) Versiyon karşılaştır ===
if ($current -eq $latest) {
    Write-Host ""
    Write-Host ("Zaten güncel ({0})." -f $current) -ForegroundColor Green
    return
}

# === 4) Delta hesapla ===
Write-Host ""
Write-Host ("Delta hesaplanıyor: {0} → {1}" -f $current, $latest) -ForegroundColor Gray

$compareUrl = "https://api.github.com/repos/$Repo/compare/$current...$latest"
try {
    $diff = Invoke-RestMethod -Uri $compareUrl -Headers $headers -ErrorAction Stop
} catch {
    Write-Host "Diff alınamadı." -ForegroundColor Red
    Write-Host ("Hata: {0}" -f $_.Exception.Message) -ForegroundColor DarkRed
    exit 1
}

$addedFiles    = @($diff.files | Where-Object { $_.status -eq "added" }    | ForEach-Object { $_.filename })
$modifiedFiles = @($diff.files | Where-Object { $_.status -eq "modified" } | ForEach-Object { $_.filename })
$removedFiles  = @($diff.files | Where-Object { $_.status -eq "removed" }  | ForEach-Object { $_.filename })

# === 5) Onay ekranı ===
Write-Host ""
Write-Host ("Ajans {0} → {1} senkronizasyonu" -f $current, $latest) -ForegroundColor Yellow
Write-Host ""

if ($addedFiles.Count -gt 0) {
    Write-Host ("  Eklenecek ({0}):" -f $addedFiles.Count) -ForegroundColor Green
    $addedFiles | ForEach-Object { Write-Host ("    + {0}" -f $_) -ForegroundColor Green }
}
if ($modifiedFiles.Count -gt 0) {
    Write-Host ("  Güncellenecek ({0}):" -f $modifiedFiles.Count) -ForegroundColor Yellow
    $modifiedFiles | ForEach-Object { Write-Host ("    ~ {0}" -f $_) }
}
if ($removedFiles.Count -gt 0) {
    Write-Host ("  Silinecek ({0}):" -f $removedFiles.Count) -ForegroundColor Red
    $removedFiles | ForEach-Object { Write-Host ("    - {0}" -f $_) -ForegroundColor Red }
}
if ($addedFiles.Count -eq 0 -and $modifiedFiles.Count -eq 0 -and $removedFiles.Count -eq 0) {
    Write-Host "  (Hiç dosya değişikliği yok — metadata değişikliği olabilir)" -ForegroundColor Gray
}

$toBeBackedUp = $modifiedFiles.Count + $removedFiles.Count
if ($toBeBackedUp -gt 0) {
    Write-Host ("  Yedeklenecek: {0} dosya (backup/ klasorune)" -f $toBeBackedUp) -ForegroundColor DarkGray
}

Write-Host ""
$confirm = Read-Host "Devam edeyim mi? [E/h]"
if ($confirm -ne "E") {
    Write-Host "İptal edildi." -ForegroundColor Yellow
    return
}

# === 5b) Yedek mekanizmasi ===
# Yerelde degisecek/silinecek dosyalari once yedekle
# Eger ajan dosyalarinda ozel bir duzenleme yaptiysan, sync sonrasi geri alabilirsin
$toBackup = @($modifiedFiles) + @($removedFiles)
if ($toBackup.Count -gt 0) {
    $date = Get-Date -Format "yyyy-MM-dd"
    $backupRoot = Join-Path $ProjectRoot "backup"
    $backupDir = Join-Path $backupRoot $date
    $n = 1
    while (Test-Path $backupDir) {
        $n++
        $backupDir = Join-Path $backupRoot "${date}-${n}"
    }
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    foreach ($file in $toBackup) {
        $localPath = Join-Path $ProjectRoot $file
        if (Test-Path $localPath) {
            $dest = Join-Path $backupDir $file
            $destDir = Split-Path $dest -Parent
            if ($destDir -and -not (Test-Path $destDir)) {
                New-Item -ItemType Directory -Force -Path $destDir | Out-Null
            }
            Copy-Item -LiteralPath $localPath -Destination $dest -Force
        }
    }
    Write-Host ("  Yedek olusturuldu: {0} ({1} dosya)" -f $backupDir, $toBackup.Count) -ForegroundColor Gray
}

# === 6) Delta uygula ===
Write-Host ""
Write-Host "Dosyalar indiriliyor..." -ForegroundColor Cyan

$rawBase = "https://raw.githubusercontent.com/$Repo/$latest"
$allChanged = @($addedFiles + $modifiedFiles)

$successCount = 0
$failCount = 0
foreach ($file in $allChanged) {
    $dir = Split-Path $file -Parent
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $url = "$rawBase/$($file -replace '\\','/')"
    try {
        Invoke-WebRequest -Uri $url -Headers $headers -OutFile $file -ErrorAction Stop
        Write-Host ("  [+] {0}" -f $file) -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host ("  [!] {0} indirilemedi: {1}" -f $file, $_.Exception.Message) -ForegroundColor Red
        $failCount++
    }
}

foreach ($file in $removedFiles) {
    $path = Join-Path $ProjectRoot $file
    if (Test-Path $path) {
        Remove-Item -LiteralPath $path -Force
        Write-Host ("  [-] {0}" -f $file) -ForegroundColor Red
    }
}

# === 7) Versiyon dosyasını güncelle ===
Set-Content -LiteralPath $versionFile -Value $latest -Encoding UTF8 -NoNewline
Write-Host ""
Write-Host ("Versiyon güncellendi: {0} → {1}" -f $current, $latest) -ForegroundColor Cyan
Write-Host ("  Başarılı: {0}, Başarısız: {1}" -f $successCount, $failCount) -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Yellow" })

# === 8) Otomatik git commit + push ===
if (Test-Path ".git") {
    Write-Host ""
    Write-Host "Git commit + push..." -ForegroundColor Cyan

    # Bilinçli stage: sadece ajans dosyaları
    $stagePatterns = @(".opencode", "AGENTS.md", "CLAUDE.md", "opencode.json", "setup-other-ai.ps1", ".ajans-version", ".github", ".claude", ".cursor", ".gitignore", "README.md", "VERSION", "CHANGELOG.md", "sync-ajans.ps1")
    foreach ($p in $stagePatterns) {
        if (Test-Path $p) {
            git add -- "$p" 2>&1 | Out-Null
        }
    }

    # Removed dosyalar
    foreach ($file in $removedFiles) {
        git rm -- "$file" 2>&1 | Out-Null
    }

    # Değişiklik var mı kontrol et
    $stagedDiff = git diff --cached --name-only 2>&1
    if ($stagedDiff -and $stagedDiff.Count -gt 0) {
        $commitMsg = "chore: ajans sync $current → $latest"
        git commit -m $commitMsg 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            git push 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  [OK] Commit + push tamamlandı" -ForegroundColor Green
            } else {
                Write-Host "  [!] Push başarısız — git push komutunu elle çalıştır" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  [!] Commit başarısız" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  (Stage edilecek değişiklik yok, commit atlandı)" -ForegroundColor Gray
    }
} else {
    Write-Host ""
    Write-Host "Bu klasör Git repo'su değil, commit atlanıyor." -ForegroundColor Yellow
    Write-Host "İsterseniz:" -ForegroundColor Gray
    Write-Host "  git init" -ForegroundColor Gray
    Write-Host "  git add -A" -ForegroundColor Gray
    Write-Host "  git commit -m 'ajans sync'" -ForegroundColor Gray
}

Write-Host ""
Write-Host ("Sync tamamlandı: {0}" -f $latest) -ForegroundColor Green
