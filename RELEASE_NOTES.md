# Sprint 8 Notes

## Highlights
- Introduced distributed sync mode with Lamport metadata and conflict resolution inside `SessionTimeoutService` and the shared-state coordinator.
- Documented the new `syncMode` configuration, shared metadata fields, and manual validation workflow.
- Experience playground docs explain distributed diagnostics and link to the migration guide.

## Testing
- npm run test --workspace=ng2-idle-timeout -- --runTestsByPath packages/ng2-idle-timeout/src/lib/services/session-timeout.service.spec.ts packages/ng2-idle-timeout/src/lib/services/shared-state-coordinator.service.spec.ts --runInBand
- npm run demo:test

# Sprint 6 Release Notes

## Highlights
- ng-packagr build is clean with the official schema and auto-generated manifest.
- Added `ng add` schematic wiring session-timeout providers and covered by Jest tests.
- README now includes Sprint 6 guidance and demo instructions.
- New GitHub Actions workflow runs lint/build/test across Node 18/20/22 plus schematic and demo checks.
- Demo workspace smoke test keeps documentation and schematic aligned.

## Testing
- npm run build --workspace=ng2-idle-timeout
- npm run test --workspace=ng2-idle-timeout
- npm run test --workspace=schematics/ng-add
- npm run test --workspace=demo-app
---

# Sprint 7 Notes

## Highlights
- Published to npm as `ng2-idle-timeout@0.1.0`.
- Angular 18 PrimeNG experience app delivers documentation and an interactive playground.
- Live playground lets you tweak idle/countdown thresholds, emit activity, and trigger server-sync auto resume.
- Workspace scripts (demo:start, demo:build, demo:test) make it easy to run and verify the demo.

## Testing
- npm run demo:start (manual spot check)
- npm run demo:build
- npm run demo:test
