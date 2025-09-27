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
- npm run test --workspace=demo-app\n---\n\n# Sprint 7 Notes\n\n## Highlights\n- Angular 18 PrimeNG experience app delivers documentation and an interactive playground.\n- Live playground lets you tweak idle/countdown thresholds, emit activity, and trigger server-sync auto resume.\n- Workspace scripts (demo:start, demo:build, demo:test) make it easy to run and verify the demo.\n\n## Testing\n- npm run demo:start (manual spot check)\n- npm run demo:build\n- npm run demo:test\n
