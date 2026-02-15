# Contributing

Issues and PRs are welcome. Changes should maintain Trajectory's core engineering constraints:
- Local-first data handling
- Deterministic and debuggable automation behavior
- Minimal, explicit dependencies

## Development Setup
```powershell
cd apps/desktop
npm install
npm start
```

## Definition of Done (Desktop Changes)
Before opening a PR, run from `apps/desktop`:

```powershell
npm run format:check
npm run lint
npm test
```

A desktop change is done when:
- Formatting, lint, and tests all pass locally.
- Behavior changes are either intentional and covered by tests, or explicitly declared as no-behavior-change polish.
- Runtime/storage compatibility is preserved unless a migration is part of the task.
- Docs are updated when commands, workflows, or UX output materially change.

## Privacy and Safety Guardrails
- Never commit secrets (Canvas URLs, tokens, API keys, credentials).
- Never commit personal exports, local databases, or user-derived snapshots.
- Preserve local-first defaults and avoid adding telemetry by default.
- Avoid logging personally identifying activity data unless required for explicit debugging.

## Git Hygiene
- Do not commit build outputs, caches, local environment folders, or machine-specific artifacts.
- Keep PR scope focused; separate polish changes from behavior work when practical.
