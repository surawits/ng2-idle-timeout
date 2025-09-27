# ng2-idle-timeout

> Zoneless-friendly session timeout orchestration for Angular 16-20.

`ng2-idle-timeout` keeps every tab of your Angular application in sync while tracking user activity, coordinating
leader election, and handling server-aligned countdowns — all without relying on Angular zones.

## Features
- Session engine built on signals (IDLE -> COUNTDOWN -> WARN -> EXPIRED) with persistence and structured events.
- DOM, router, and HTTP activity detectors designed to be zone-safe.
- Cross-tab coordination via BroadcastChannel fallback and a leader election service.
- Optional server time offset service with retry/backoff and auto-resume behaviour.
- Route-level overrides and pause/resume helpers for fine-grained UX.
- Tooling package that includes an `ng add` schematic, docs/playground app, and CI workflow.

## Documentation & playground
Run `npm run demo:start` to open the Angular 18 experience app (docs + live playground) at http://localhost:4200.

- Navigate to **Docs** for installation, quick start, and recipes.
- Switch to **Playground** to tweak idle durations, emit mock activity, and observe the live session snapshot.

## Compatibility
| Package | Angular | Node | RxJS |
|---------|---------|------|------|
| ng2-idle-timeout | 16-20 | >= 18.13 | >= 7.5 < 9 |

## Installation
```bash
npm install ng2-idle-timeout
```
Or let the schematic handle the wiring:
```bash
ng add ng2-idle-timeout-ng-add
```
The schematic adds the dependency, scaffolds `session-timeout.providers.ts`, and spreads the providers into
`app.config.ts` so the service is ready at bootstrap.

## Quick start
```ts
// session-timeout.providers.ts
import { SESSION_TIMEOUT_CONFIG, SessionTimeoutService } from 'ng2-idle-timeout';

export const sessionTimeoutProviders = [
  SessionTimeoutService,
  {
    provide: SESSION_TIMEOUT_CONFIG,
    useValue: {
      storageKeyPrefix: 'app-session',
      warnBeforeMs: 60_000,
      resumeBehavior: 'autoOnServerSync'
    }
  }
];
```
```ts
// app.config.ts
import { provideRouter } from '@angular/router';
import { sessionTimeoutProviders } from './session-timeout.providers';

export const appConfig = {
  providers: [
    provideRouter(routes),
    ...sessionTimeoutProviders
  ]
};
```
Call `sessionTimeout.start()` once your shell-level services are ready so the initial snapshot is persisted.

## Recipes
### Multi-tab coordination
1. Share `storageKeyPrefix` (and optionally `appInstanceId`) across tabs.
2. Inject `SessionTimeoutService` in every bootstrap flow and call `start()` once global services initialise.
3. Listen to `sessionTimeout.events$` for `LeaderElected`/`LeaderLost` to gate primary-tab work.
4. Subscribe to `sessionTimeout.crossTab$` to react when other tabs extend or expire a session.

### HTTP activity integration
1. Provide `SessionActivityHttpInterceptor` alongside `SESSION_TIMEOUT_CONFIG`.
2. Configure `httpActivity` with `strategy: 'allowlist'` or `strategy: 'headerFlag'`.
3. Tune `cooldownMs`, `ignoreOnInitMs`, `onlyWhenTabFocused`, and `primaryTabOnly` to avoid noisy polling.
4. Observe `sessionTimeout.events$` metadata to understand which requests reset the idle timer.

### Pause & resume with server sync
1. Set `resumeBehavior: 'autoOnServerSync'` globally or per route.
2. Use `SessionExpiredGuard` data overrides to allow/deny routes when expired or to auto-resume on navigation.
3. Manual `sessionTimeout.resume()` remains available when you prefer explicit control.

## Scripts & testing
| Command | Purpose |
|---------|---------|
| `npm run build --workspace=ng2-idle-timeout` | Build the library with ng-packagr. |
| `npm run test --workspace=ng2-idle-timeout` | Run the Jest suite for services, guards, and interceptors. |
| `npm run test --workspace=schematics/ng-add` | Execute schematic unit tests. |
| `npm run demo:start` | Launch the Angular 18 documentation & playground app. |
| `npm run demo:build` | Production build for the documentation & playground app. |
| `npm run demo:test` | Ensure the demo compiles (development build). |

Release highlights are tracked in [`RELEASE_NOTES.md`](./RELEASE_NOTES.md).

## Contributing
1. Fork the repository and create a feature branch.
2. Run the relevant `npm run test --workspace=…` commands before opening a PR.
3. Update README/RELEASE_NOTES when behaviour changes.
4. Follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.).

Bug reports and feature requests are welcome. Please include reproduction steps and environment details.

## License
MIT (c) the ng2-idle-timeout contributors.
