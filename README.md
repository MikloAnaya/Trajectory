# Trajectory

Trajectory is a local-first Electron planner built for execution, not just capture.
It turns deadlines into concrete work blocks, tracks drift, and runs deterministic recovery loops when plans slip.

## Current Release Line
- Desktop: `0.1.1-beta.1`
- Extension: `1.0.1` (`version_name: 1.0.1-beta.1`)
- Tag: `v0.1.1-beta.1`

## What Problem It Solves
Most student productivity tools stop at task lists. Trajectory focuses on daily execution by converting deadlines into time blocks and continuously recalculating what to do next.

## Why It Is Technically Interesting
- Deterministic block generation and forward-rescheduling with quiet-hour constraints.
- Local-first persistence using SQLite (`better-sqlite3`) with guarded fallback handling for development-edge cases.
- Optional integration surfaces for Canvas, browser activity sync, and workout tracking without forcing cloud accounts.
- Execution diagnostics (confidence, drift, recovery) computed from local behavioral data.

## Architecture Snapshot
- Product code: `apps/desktop/`
- Main process: `apps/desktop/main.js`
- Renderer SPA: `apps/desktop/index.html`, `apps/desktop/app.js`, `apps/desktop/styles.css`
- Core modules: `apps/desktop/src/lib/**`
- Persistence:
- Primary: `%APPDATA%\\trajectory-desktop\\data\\trajectory.db`
- Dev fallback: constrained legacy `localStorage` context only when SQLite is unavailable

Deep dive: `docs/ARCHITECTURE.md`.

## Engineering Rigor
- CI pipeline (`.github/workflows/ci.yml`) enforces:
- `npm run format:check`
- `npm run lint`
- `npm test`
- `node --check app.js` and `node --check main.js`
- Desktop test harness currently contains 112 checks in `apps/desktop/test/run-tests.js`.
- Lint and format scopes are intentionally strict on library/test modules for deterministic iteration.

## Quickstart
```powershell
cd apps/desktop
npm install
npm start
```

## Packaging (Windows)
```powershell
cd apps/desktop
npm run pack-win
```

Helper path:
```powershell
cd apps/desktop
.\make-exe.ps1
```

## Demo and Media Capture
- Recruiter-facing demo flow: `docs/DEMO.md`
- Screenshot/GIF capture checklist with exact filenames: `docs/assets/README.md`

The root README intentionally avoids inline image links until those assets are captured.

## Documentation Index
- Architecture: `docs/ARCHITECTURE.md`
- Privacy model: `docs/PRIVACY.md`
- Demo walkthrough: `docs/DEMO.md`
- Media capture checklist: `docs/assets/README.md`
- Release checklist: `docs/RELEASE_CHECKLIST.md`
- Release notes (current): `docs/RELEASE_NOTES_v0.1.1-beta.1.md`
- Desktop dev workflow: `apps/desktop/README.md`
- Contribution policy: `CONTRIBUTING.md`

## Repository Layout
- `apps/desktop/`: Electron app source, storage/runtime modules, tests
- `apps/browser-extension/`: optional browser integration for activity and focus signals
- `apps/workout-sync-appscript/`: optional Google Apps Script sync integration
- `docs/`: architecture, privacy, demo, and media planning

## Privacy by Default
Trajectory is local-first by design. The default desktop build has no account system and no analytics telemetry.
Integration-specific data behavior is documented in `docs/PRIVACY.md`.
