<#
make-exe.ps1
Helper script to package the app. Usage:
  - Quick package (builds to Downloads\\Trajectory\\Builds and creates a Desktop shortcut):
      .\make-exe.ps1
  - Build installer (NSIS) and leave installer in dist:\
      .\make-exe.ps1 -Installer

This script calls npm.cmd to avoid PowerShell script execution policy issues.
#>

param(
    [string]$OutDir,
    [switch]$Installer
)

Write-Host ("Packaging Trajectory (folder: " + (Get-Location) + ")")

# ensure we're in script dir
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Definition)

if (-not $OutDir) {
    $OutDir = Join-Path ([Environment]::GetFolderPath('Downloads')) 'Trajectory\\Builds'
}

function Run-Command($cmd, $args) {
    Write-Host "> $cmd $args"
    & $cmd $args
    if ($LASTEXITCODE -ne 0) {
        Write-Error "$cmd failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
}

# check npm
Write-Host "Checking npm..."
& npm.cmd -v > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm not found on PATH. Install Node.js first: https://nodejs.org/"
    exit 1
}

# Only run npm install if node_modules is missing to avoid redundant installs
if (-not (Test-Path (Join-Path (Get-Location) 'node_modules'))) {
    Write-Host "Installing dependencies (this may take a few minutes)..."
    Run-Command npm.cmd 'install'
} else {
    Write-Host "Detected existing 'node_modules' - skipping 'npm install'."
}

if ($Installer) {
    Write-Host "Building Windows installer via electron-builder..."
    Run-Command npm.cmd 'run dist'
    Write-Host "Build complete. Look in the 'dist' folder for the installer (NSIS)."
    exit 0
} else {
    Write-Host "Creating quick packaged exe (electron-packager)..."
    # Use npx to invoke electron-packager on-demand (keeps node_modules small).
    # ASAR is enabled, but we unpack the browser extension folder so Chrome can "Load unpacked" from disk.
    $iconArgs = @()
    $iconPath = Join-Path (Get-Location) 'build\\icon.ico'
    if (Test-Path $iconPath) {
        $iconArgs = @('--icon', $iconPath)
    } else {
        Write-Host "No build\\icon.ico found; packaging with default icon."
    }

    $packArgs = @(
        '--yes',
        'electron-packager@17.1.0',
        '.',
        'TrajectoryApp',
        '--platform=win32',
        '--arch=x64',
        '--out', $OutDir,
        '--overwrite'
    ) + $iconArgs + @(
        '--asar',
        '--asar.unpackDir=browser-extension'
    )
    Write-Host "> npx $($packArgs -join ' ')"
    & npx @packArgs
    if ($LASTEXITCODE -ne 0) { Write-Error "npx electron-packager failed with exit code $LASTEXITCODE"; exit $LASTEXITCODE }

    $appDir = Join-Path $OutDir 'TrajectoryApp-win32-x64'

    # Trim Electron locales for quick builds (keep only en-US.pak).
    $localesDir = Join-Path $appDir 'locales'
    if (Test-Path $localesDir) {
        Get-ChildItem -Path $localesDir -Filter '*.pak' -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne 'en-US.pak' } |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }

    $exePath = Join-Path $appDir 'TrajectoryApp.exe'
    if (Test-Path $exePath) {
        # create a Desktop shortcut that points to the exe inside the packaged folder
        $desktop = [Environment]::GetFolderPath('Desktop')
        $shortcutPath = Join-Path $desktop 'Trajectory.lnk'
        $WshShell = New-Object -ComObject WScript.Shell
        $shortcut = $WshShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $exePath
        $shortcut.WorkingDirectory = Split-Path $exePath
        $shortcut.IconLocation = "$exePath,0"
        $shortcut.Save()
        Write-Host "Created Desktop shortcut: $shortcutPath -> $exePath"
    } else {
        Write-Host "Pack succeeded but could not locate $exePath. Check the output folder: $OutDir"
    }
    exit 0
}
