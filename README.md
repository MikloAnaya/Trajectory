# Trajectory — Stage 2 (Electron scaffold)

This folder contains an Electron wrapper so you can run the Stage 2 static SPA as a desktop app on Windows.

Prerequisites
- Node.js (16+ recommended) and `npm` installed on Windows
- PowerShell (default on Windows) to run the commands below

Quick start (development)
1. Open a PowerShell terminal in the `Stage 2` folder.
2. Install dev deps:

```powershell
npm install
```

3. Start the app (opens an Electron window):

```powershell
npm start
```

Package a Windows executable (quick, unsigned)
1. Run the helper script (recommended). By default it writes builds outside OneDrive to:
   - `Downloads\Trajectory\Builds`

```powershell
.\make-exe.ps1
```

It will also create a Desktop shortcut (`Trajectory.lnk`) to the packaged exe.

2. Alternatively, you can run the npm pack script (writes to `Stage 2\dist\`):

```powershell
npm run pack-win
```

This will create a `dist/` folder with a packaged `TrajectoryApp` for `win32` x64. To clean it up later:

```powershell
npm run clean
```

Notes
- The package is unsigned; for distribution you will likely want to create an installer (NSIS, Squirrel, or `electron-builder`) and sign the binary.
- The app loads `index.html` from the same folder — all changes you make to the SPA files (`index.html`, `app.js`, `styles.css`) will be visible in the Electron window after restart.

Installer (recommended for production quality)
-------------------------------------------
To create a native Windows installer that sets up Start Menu and Desktop shortcuts, use `electron-builder` (NSIS).

1. Build:

```powershell
cd 'C:\Users\miklo\OneDrive\Programming\Trajectroy Development\Stage 2'
npm install
npm run dist
```

3. After the build completes, the installer will be in `dist\` (look for an `-Setup.exe`). Run that installer to install Trajectory — it will create Start Menu and Desktop shortcuts.

Notes about signing and SmartScreen
- The generated installer and exe are unsigned; Windows SmartScreen may warn on first run. For distribution, obtain a code-signing certificate and configure `electron-builder` to sign the artifacts.

Configuration
- The project `package.json` includes a `dist` script that runs `electron-builder`. You can customize `build` options (appId, productName, icon path) in `package.json` under a `build` field — see `electron-builder` docs for details.

