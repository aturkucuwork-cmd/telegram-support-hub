# setup-other-ai.ps1
# Ajans ajan dosyalarini opencode formatindan diger AI araclarinin formatina cevirir.
# Claude Code ve GitHub Copilot icin subagent/agent dosyalari olusturur.
#
# Calistirma:
#   .\setup-other-ai.ps1
#
# Opsiyonel parametreler:
#   -SourceDir ".opencode\agent"   Kaynak ajan dosyalari
#   -ProjectRoot "."               Hedef proje kok

[CmdletBinding()]
param(
    [string]$SourceDir = ".opencode\agent",
    [string]$ProjectRoot = "."
)

$ErrorActionPreference = "Stop"

# Mutlak yola cevir
$resolved = Resolve-Path -LiteralPath $SourceDir -ErrorAction SilentlyContinue
if (-not $resolved) {
    Write-Error "Kaynak dizin bulunamadi: $SourceDir. Lutfen proje kokunde calistirdiginizdan emin olun."
    exit 1
}
$SourceDir = $resolved.Path

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

Write-Host "Kaynak  : $SourceDir" -ForegroundColor Cyan
Write-Host "Hedef   : $ProjectRoot" -ForegroundColor Cyan
Write-Host ""

# === Frontmatter'dan description ve body ayir ===
function Get-AgentParts {
    param([string]$Path)
    $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($text -match '(?s)^---\s*\n(.*?)\n---\s*\n(.*)$') {
        $fm = $matches[1]
        $body = $matches[2].TrimStart("`r","`n")
        $desc = if ($fm -match '(?ms)description:\s*"(.*?)"') { $matches[1] } else { "" }
        return [pscustomobject]@{ Description = $desc; Body = $body }
    }
    return $null
}

# === 1) Claude Code subagentlari ===
$claudeDir = Join-Path $ProjectRoot ".claude\agents"
New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null

$roleTools = @{
    'takim-lideri'      = 'Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch, TodoWrite, Task'
    'creative-director' = 'Read, Write, Edit, Glob, Grep'
    'veri-analisti'     = 'Read, Write, Edit, WebFetch, WebSearch'
    'ux-tasarimci'      = 'Read, Write, Edit, Glob, Grep'
    'seo-uzmani'        = 'Read, Write, Edit, WebFetch, WebSearch'
    'icerik-editoru'    = 'Read, Write, Edit, Glob, Grep'
    'yazilim-uzmani'    = 'Read, Write, Edit, Bash, Grep, Glob'
    'yazilim-muhendisi' = 'Read, Write, Edit, Bash, Grep, Glob, WebFetch'
    'test-uzmani'       = 'Read, Write, Edit, Bash, Grep, Glob, WebFetch'
    'yayin-uzmani'      = 'Read, Write, WebFetch, WebSearch'
}

$claudeCount = 0
foreach ($file in Get-ChildItem -Path $SourceDir -Filter "*.md") {
    $name = $file.BaseName
    $parts = Get-AgentParts -Path $file.FullName
    if (-not $parts) { continue }
    $tools = if ($roleTools.ContainsKey($name)) { $roleTools[$name] } else { 'Read, Write' }
    $content = @"
---
name: $name
description: "$($parts.Description)"
tools: $tools
---

$($parts.Body)
"@
    Set-Content -LiteralPath (Join-Path $claudeDir "$name.md") -Value $content -Encoding UTF8
    $claudeCount++
}
Write-Host "Claude Code subagents : $claudeCount dosya -> $claudeDir" -ForegroundColor Green

# === 2) GitHub Copilot chat agents ===
$copilotDir = Join-Path $ProjectRoot ".github\agents"
New-Item -ItemType Directory -Force -Path $copilotDir | Out-Null

$displayNames = @{
    'takim-lideri'      = 'Takim Lideri (Baris)'
    'creative-director' = 'Kreatif Direktor (Cem)'
    'veri-analisti'     = 'Veri Analisti (Asli)'
    'ux-tasarimci'      = 'UX UI Tasarimci (Zeynep)'
    'seo-uzmani'        = 'SEO Uzmani (Burak)'
    'icerik-editoru'    = 'Icerik Editoru (Defne)'
    'yazilim-uzmani'    = 'Yazilim Uzmani Mimari (Selim)'
    'yazilim-muhendisi' = 'Yazilim Muhendisi (Mert)'
    'test-uzmani'       = 'Test Uzmani (Eda)'
    'yayin-uzmani'      = 'Yayin Uzmani (Murat)'
}

$copilotCount = 0
foreach ($file in Get-ChildItem -Path $SourceDir -Filter "*.md") {
    $name = $file.BaseName
    $parts = Get-AgentParts -Path $file.FullName
    if (-not $parts) { continue }
    $display = if ($displayNames.ContainsKey($name)) { $displayNames[$name] } else { $name }
    $content = @"
---
name: $display
description: "$($parts.Description)"
---

$($parts.Body)
"@
    Set-Content -LiteralPath (Join-Path $copilotDir "$name.md") -Value $content -Encoding UTF8
    $copilotCount++
}
Write-Host "GitHub Copilot agents : $copilotCount dosya -> $copilotDir" -ForegroundColor Green

Write-Host ""
Write-Host "Tamamlandi. Olusan dosyalar:" -ForegroundColor Yellow
Write-Host "  Claude Code   : $claudeDir" -ForegroundColor White
Write-Host "  GitHub Copilot: $copilotDir" -ForegroundColor White
Write-Host ""
Write-Host "Notlar:" -ForegroundColor Yellow
Write-Host "  - Claude Code subagent'larinda 'tools' alani Claude Code'un izin modeline gore ayarlandi."
Write-Host "  - GitHub Copilot chat agent dosyalari .github\agents\ altinda; Copilot sohbetinde @ ile secilebilir."
Write-Host "  - Bu script idempotent. Ajan dosyalarini guncelledikten sonra tekrar calistirabilirsiniz."
