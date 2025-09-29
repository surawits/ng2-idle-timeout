# Repository Guidelines
Reference for predictable ng2-idle-timeout work.

## Project Structure & Module Organization
- `packages/ng2-idle-timeout`: Angular library plus bundled schematics (including `schematics/ng-add`) and Jest specs in `src/lib/**/*.spec.ts`.
- `apps/experience`: demo app for manual validation.

## Build, Test, and Development Commands
- `npm install`: install workspace dependencies.
- `npm run build --workspace=ng2-idle-timeout`: bundle the library.
- `npm run lint --workspace=ng2-idle-timeout`: run ESLint on sources.
- `npm run test --workspace=ng2-idle-timeout`: run Jest.

## Coding Style & Naming Conventions
- Run `npm run format` (Prettier) for two-space indent, single quotes, trailing commas.
- Use PascalCase for types and camelCase for members.
- Expose public types via `src/lib/models/` interfaces; comment only when logic is non-obvious.

## Testing Guidelines
- Keep tests beside sources using the `.spec.ts` suffix and mirror the folder layout.
- Cover each public method or observable; mock timers/storage with helpers from `src/lib/utils/`.

## Commit & Pull Request Guidelines
- Follow Conventional Commit prefixes (`build:`, `chore:`, `docs:`, etc.) from `git log --oneline`.
- Messages must state intent, flag breaking changes, reference issues with `#123`, and include a body summarizing touched areas.
- Pull requests list verification performed and attach UX screenshots or GIFs when relevant.

## Agent Workflow Expectations
- At session start reread the conversation plan, `docs/planning/` records, and `git status` to regain context.
- Publish a multi-step plan via the planning tool, update statuses as work proceeds, and clear it when finished.
- Issue commands with explicit `workdir`, prefer `rg` for searches, and avoid hidden shell state.
- Surface blockers immediately; do not retry blindly.
- Run focused tests or linters when possible, flag skipped checks, and summarize outcomes with `path:line` references plus next steps.

## Troubleshooting & Escalation
- If formatting, newline, or similar tooling errors recur, rewrite the file cleanly instead of layering patches.
- When rewrites fail or data loss risk is high, pause and ask the maintainer for direction.
- Record persistent issues and outcomes in `docs/planning/sprint-progress.md` so future sessions avoid loops.

## Planning & Progress Records
- Document sprint objectives (goal, scope, timeline, checkpoints) in `docs/planning/sprint-plan.md`.
- Maintain an agent-readable plan in `docs/planning/sprint-plan.yaml` with work items, owners, dependencies.
- Sync the conversation plan tool and mirror statuses (`Done`, `In Progress`, `Next`) in `docs/planning/sprint-progress.md`; log blockers, approvals, and follow-ups for successors.

## Maintenance & Updates
- Keep this guide aligned with `.github/workflows/`, `scripts/control/`, and tool changes; capture new tooling decisions or release steps in `RELEASE_NOTES.md`.
