# create-icons.ps1
# Creates icons folder and resizes/converts the generated logo image to PNG.

Add-Type -AssemblyName System.Drawing

$SourceImage = "C:\Users\INTEL\.gemini\antigravity\brain\58a62c0c-21b0-4e4a-b510-9fd58338c0b4\ghost_form_logo_1784908466046.jpg"
$IconsDir = "icons"

if (-not (Test-Path $SourceImage)) {
    Write-Error "Source image not found!"
    exit 1
}

if (-not (Test-Path $IconsDir)) {
    New-Item -ItemType Directory -Path $IconsDir | Out-Null
    Write-Host "Created icons directory."
}

# Function to resize and save as PNG
function Resize-Image {
    param (
        [string]$SourcePath,
        [string]$DestPath,
        [int]$Width,
        [int]$Height
    )
    
    $Source = [System.Drawing.Image]::FromFile($SourcePath)
    $Bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
    $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
    
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $Graphics.DrawImage($Source, 0, 0, $Width, $Height)
    
    $Bitmap.Save($DestPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $Graphics.Dispose()
    $Bitmap.Dispose()
    $Source.Dispose()
    
    Write-Host "Generated icon: $DestPath ($Width x $Height)" -ForegroundColor Green
}

Resize-Image -SourcePath $SourceImage -DestPath "$IconsDir/icon16.png" -Width 16 -Height 16
Resize-Image -SourcePath $SourceImage -DestPath "$IconsDir/icon48.png" -Width 48 -Height 48
Resize-Image -SourcePath $SourceImage -DestPath "$IconsDir/icon128.png" -Width 128 -Height 128

Write-Host "Icons generation completed successfully!" -ForegroundColor Green
