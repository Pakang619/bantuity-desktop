# Build Plotex + Copilot static frontends into bantuity-desktop/apps/
$ErrorActionPreference = "Stop"
$Desktop = Split-Path $PSScriptRoot -Parent
$Root = $Desktop
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = "C:\Users\Deriv\Desktop\bantuity-desktop"
}

$PlotexFe = "C:\Users\Deriv\Desktop\figure-studio\frontend"
$CopilotFe = "C:\Users\Deriv\Desktop\stata-copilot\frontend"
$Apps = Join-Path $Root "apps"

Write-Host "Building static Plotex..." -ForegroundColor Cyan
Push-Location $PlotexFe
$env:STATIC_EXPORT = "1"
$env:NEXT_PUBLIC_API_URL = "https://plotex-api.onrender.com"
$env:NEXT_PUBLIC_COPILOT_URL = "https://copilot.bantuity.com"
$env:NEXT_PUBLIC_ADMIN_API_KEY = "123456"
npm run build
if (-not (Test-Path "out")) { throw "Plotex out/ missing" }
Pop-Location

Write-Host "Building static Copilot..." -ForegroundColor Cyan
Push-Location $CopilotFe
$env:STATIC_EXPORT = "1"
$env:NEXT_PUBLIC_API_URL = "https://stata-copilot-api.onrender.com"
$env:NEXT_PUBLIC_PLOTEX_URL = "https://plotex.bantuity.com"
$env:NEXT_PUBLIC_ADMIN_API_KEY = "123456"
npm run build
if (-not (Test-Path "out")) { throw "Copilot out/ missing" }
Pop-Location

Write-Host "Copying into desktop apps/..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Join-Path $Apps "plotex") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Apps "copilot") | Out-Null
Remove-Item (Join-Path $Apps "plotex\*") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Apps "copilot\*") -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $PlotexFe "out\*") (Join-Path $Apps "plotex") -Recurse -Force
Copy-Item (Join-Path $CopilotFe "out\*") (Join-Path $Apps "copilot") -Recurse -Force

Write-Host "Done." -ForegroundColor Green
Write-Host "  $Apps\plotex"
Write-Host "  $Apps\copilot"
