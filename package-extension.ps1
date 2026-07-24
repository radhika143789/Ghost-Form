# package-extension.ps1
# Build and package the Ghost Form extension into a ZIP file for download.

Write-Host "1. Building Vite bundles..." -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed!"
    exit 1
}

Write-Host "2. Creating temporary packaging folder..." -ForegroundColor Cyan
$TempDir = "ghost-form-unpacked"
if (Test-Path $TempDir) {
    Remove-Item -Path $TempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $TempDir | Out-Null
New-Item -ItemType Directory -Path "$TempDir/dist" | Out-Null
New-Item -ItemType Directory -Path "$TempDir/src" | Out-Null

Write-Host "3. Copying extension assets..." -ForegroundColor Cyan
# Root files
$Files = @(
    "manifest.json",
    "content.css",
    "content.js",
    "popup.html",
    "popup.js",
    "popup.css",
    "options.html",
    "options.js",
    "options.css",
    "report.html",
    "report.js",
    "dashboard.html",
    "dashboard.js",
    "analysis.html",
    "analysis.js",
    "auth.html",
    "auth.js",
    "auth.css",
    "offscreen.html"
)

foreach ($File in $Files) {
    if (Test-Path $File) {
        Copy-Item -Path $File -Destination "$TempDir/$File" -Force
    }
}

# Dist files
if (Test-Path "dist") {
    Copy-Item -Path "dist/*" -Destination "$TempDir/dist/" -Recurse -Force
}

# Icons files
if (Test-Path "icons") {
    Copy-Item -Path "icons" -Destination "$TempDir/icons/" -Recurse -Force
}

# Src runtime dependencies
if (Test-Path "src/popup_ui_state.js") {
    Copy-Item -Path "src/popup_ui_state.js" -Destination "$TempDir/src/popup_ui_state.js" -Force
}

Write-Host "4. Compressing archive..." -ForegroundColor Cyan
$ZipFile = "ghost-form-extension.zip"
if (Test-Path $ZipFile) {
    Remove-Item -Path $ZipFile -Force
}

Compress-Archive -Path "$TempDir/*" -DestinationPath $ZipFile -Force

Write-Host "5. Cleaning up temporary folder..." -ForegroundColor Cyan
Remove-Item -Path $TempDir -Recurse -Force

Write-Host "Success! Extension packaged to $ZipFile" -ForegroundColor Green
