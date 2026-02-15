# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Trajectory is a local-first Electron desktop app for students that turns school deadlines into scheduled work blocks with execution enforcement. No backend, no accounts — all state lives on-device in SQLite.

## Commands

All commands run from `apps/desktop/`:

```bash
npm install          # Install deps (runs electron-builder install-app-deps via postinstall)
npm start            # Launch Electron dev app
npm test             # Run unit tests (node test/run-tests.js)
npm run lint         # ESLint with zero-warning enforcement
npm run format       # Prettier auto-format
npm run format:check # Prettier check only
```

Packaging (Windows only):
```bash
npm run pack-win           # NSIS installer via make-exe.ps1
npm run pack-win:portable  # Portable exe (dev only)
npm run release:win        # Full release: setup + dist + verify
```

Lint scope: `src/lib/**/*.js` and `test/**/*.js`. ESLint 8.57 with `eslint:recommended`, zero warnings allowed. Prettier 3.2.5 for formatting.

## Architecture

### Monorepo Layout (no workspace tooling — each app is independent)

- **`apps/desktop/`** — Main Electron app (the core product)
- **`apps/browser-extension/`** — Chrome/Edge MV3 distraction blocker (optional)
- **`apps/workout-sync-appscript/`** — Google Apps Script workout logger (optional)

### Desktop App — Key Files

| File | Role |
|------|------|
| `app.js` (~21K lines) | All renderer logic: domain logic, UI events, rendering, modal handling, AI assistant |
| `index.html` | SPA markup + modal definitions |
| `styles.css` | Design system, components, responsive layout |
| `main.js` | Electron main process: window lifecycle, native OS integration |
| `src/lib/trajectory-core.js` | Pure functions (ICS parsing, scheduling) shared by renderer and tests |
| `src/lib/execution/` | Execution Drift Score engine (score.js, policy.js, metrics.js, engine.js) |
| `src/lib/assistant/` | AI assistant subsystem (Claude API, personalization, operator) |
| `src/lib/storage/` | SQLite persistence layer, migrations, repos |
| `test/run-tests.js` | Custom test harness with unit tests for core modules |
| `blocker-daemon.js` | Background process monitor for distraction blocking |

### Data Flow

UI events → mutate global `state` object → `compute()` → `render()` (re-renders DOM via `innerHTML` + `wireHandlers()`) → `saveState()` persists to SQLite.

### Persistence

- **Primary:** SQLite via `better-sqlite3` at `%APPDATA%\trajectory-desktop\data\trajectory.db`
- **Fallback:** `localStorage` (dev-only when SQLite unavailable)
- Single `state` JSON payload is the source of truth (planner-state repo)

### Core Systems

- **Canvas Sync:** Fetches ICS feeds → parses RFC 5545 → normalizes → dedupes → upserts as commitments
- **School Autopilot:** Generates prep blocks, schedules into open slots collision-free, reschedules missed blocks
- **Execution Drift Score (EDS):** Computed every 15 min (0-100), drives progressive interventions L0→L4 with cooldown/daily cap
- **Morning Gate:** 6 AM day boundary trigger, forces 3-goal startup flow, runs daily boot pipeline
- **Collision-Free Scheduling:** Sorted block list, cursor-based search for open slots, deterministic

## Conventions

- Monday is week start. Dates use `toISO()` / `fromISO()`. Commitments use `dayIndex` 0-6 (0=Monday), normalized via `clampDay()`.
- UI events wire via `data-*` attributes (`data-add-day`, `data-toggle-done`, `data-edit`, `data-delete`). New UI elements must match these or update `wireHandlers()`.
- Modal fields use stable IDs (`#cTitle`, `#cDeliverable`, `#cHours`, `#cDay`, `#cNext`).
- `done` is a boolean toggle on commitments — marking done only flips the flag.
- All automation must be deterministic and debuggable.
- Keep dependencies minimal. No frameworks.
- CSS tokens/classes to reuse: `card`, `pill--good|warn|bad`, `.calendar`, `.calitem`, `.modal`, `.input`, `.grid`, `.container`.

## Adding a Commitment Field

1. Add input to modal in `index.html` with an id (e.g., `<input id="cTag" />`).
2. Populate in `openCommitModal()` (set value when editing, default when adding).
3. Read/write in `#commitForm` submit handler; include in commitment objects.
4. Update `renderCalendarItem()` and other render functions to display it.
5. `saveState()` serializes automatically (plain objects).

## Debugging

- DevTools Console: inspect `localStorage.getItem(STORAGE_KEY)` or `state`
- Useful console functions: `render()`, `saveState()`, `getActiveSprint()`, `compute()`
- `STORAGE_KEY` is defined in `app.js` (e.g., `"trajectory_stage2_v1"`)

## CI

- Push/PR triggers lint + tests on Node 18 (`.github/workflows/ci.yml`)
- Tags matching `v*` trigger Windows installer build (`.github/workflows/release.yml`)
- CI sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1` for speed

## Security

Do not commit Canvas feed URLs, API tokens, `.env` files, or localStorage dumps.
