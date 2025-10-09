# Sprint 8 Notes

## Highlights
- Removed distributed sync mode after field issues; `SessionTimeoutService` now enforces leader-only coordination and ignores legacy `syncMode` values.
- Updated documentation and playground experience to reflect leader-only coordination and simplified shared-state diagnostics.
- Experience playground docs now reference leader-only workflows and document the archived distributed checklist for historical context.
- Hardened server-time synchronisation so `SessionTimeoutService` no longer requires `HttpClient` unless `timeSource: 'server'`, resolving `sessionTimeoutProviders` bootstrap failures.
- Added `createSessionTimeoutProviders` and `provideSessionTimeout` helpers (plus schematic updates) to keep configuration wiring consistent across standalone and NgModule apps.

## Testing
- npm run test --workspace=ng2-idle-timeout -- --runTestsByPath packages/ng2-idle-timeout/src/lib/services/session-timeout.service.spec.ts packages/ng2-idle-timeout/src/lib/services/shared-state-coordinator.service.spec.ts --runInBand
- npm run test --workspace=ng2-idle-timeout -- --runTestsByPath src/lib/services/session-timeout.service.spec.ts
- npm run test --workspace=ng2-idle-timeout -- --runTestsByPath src/lib/services/server-time.service.spec.ts
- npm run demo:test

## Patch 0.3.3 (2025-10-09)

### Highlights
- Ensured the provided config from `createSessionTimeoutProviders`/`provideSessionTimeout` is applied automatically at bootstrap so AppModule consumers no longer call `setConfig` manually.
- Fixed suppressed activity resets after manual extends when `resetOnWarningActivity` is disabled.

### Verification
- npm run test --workspace=ng2-idle-timeout -- --runTestsByPath src/lib/provide-session-timeout.spec.ts
- npm run test --workspace=ng2-idle-timeout -- --runTestsByPath src/lib/services/session-timeout.service.spec.ts

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
