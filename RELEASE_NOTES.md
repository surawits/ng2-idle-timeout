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
