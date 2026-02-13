<p align="center">
  <img src="assets/branding/trajectory-logo.svg?raw=1" width="140" alt="Trajectory logo" />
</p>

<h1 align="center">Trajectory</h1>

<p align="center">
  A local-first Windows desktop app for planning your week, time-blocking your day, and enforcing focus.
</p>

<p align="center">
  <strong>Status:</strong> Beta (v0.0.1-beta.1)
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#privacy--data">Privacy</a> ·
  <a href="#tech">Tech</a> ·
  <a href="#run-locally">Run Locally</a>
</p>

## Product
Trajectory is a local-first productivity system that tightens the loop between planning and execution.
You set a weekly sprint objective and time budget, capture tasks into an Inbox, schedule them onto a calendar, then time-block the day in the Plan timeline.
While you're working, Trajectory can enforce focus by monitoring active windows and applying blocker rules (including hard-block rules for sensitive content).

## How It Works
1. Start the day with Morning Gate (3 goals).
2. Capture tasks in the Inbox, then turn them into commitments with an estimate and next action.
3. Schedule commitments on the Calendar and Plan timeline.
4. Execute, mark done, and build momentum and XP over time.

## Features
- **Home dashboard** with an Inbox, weekly snapshot, and a "Today's Focus" card that can start/stop a timer.
- **Sprint planning**: set a weekly objective and a time budget, then track planned vs done.
- **Commitments** with estimates, notes, next action, proof URL, stat tag, color, and optional icon.
- **Calendar (month view)** with quick-add, class filters, and overbook warnings.
- **Plan timeline** for time-blocking your day (drag to move/resize blocks, schedule unscheduled work).
- **Recurring tasks** (daily/weekly/monthly) with per-occurrence edits and deletions.
- **Long-term goals** with dedicated tracking for degree progress (credits/classes) and health targets (measurements).
- **Stats/XP system** with attribute progression (INT/STR/DISC/MONEY), momentum, and top-goal breakdowns.
- **Morning Gate**: forces 3 daily goals before the app "boots" your day.
- **Focus blocker (Windows)**: scheduled focus windows, allowlist/blocklist rules, YouTube intent gating, and hard-block rules for sensitive content.
- **Canvas integration (optional)**: paste your Canvas Calendar Feed URL to sync assignments, plus autopilot that generates work blocks from upcoming due dates.
- **Workout sync (optional)**: pull training data from a Google Sheet (Apps Script) and browse sessions/sets inside the app.

## Privacy & Data
- No accounts and no backend required.
- Commitments, goals, settings, and stats are stored locally (in `localStorage`).
- Optional integrations (Canvas feed, Workout sync) only run if you configure them.

## Tech
- Electron wrapper around a static SPA (`index.html`, `app.js`, `styles.css`).
- Windows focus enforcement uses OS-level process/window inspection (PowerShell) and can run with a background daemon/watchdog.
- Built for Windows first (the blocker components are Windows-specific).

## Run Locally
Prereqs
- Windows
- Node.js + npm

Development
```powershell
npm install
npm start
```

## Package (Windows)
Quick unsigned build (recommended)
```powershell
.\make-exe.ps1
```

Installer (NSIS via electron-builder)
```powershell
npm install
npm run dist
```

Notes
- Builds are unsigned by default; Windows SmartScreen may warn on first run.

## License
MIT
