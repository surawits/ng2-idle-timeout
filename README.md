# ng2-idle-timeout

Production-ready, zoneless-friendly session timeout orchestration for Angular 16 through 20.

## Current sprint snapshot
Sprint 5 adds server-time awareness and smarter resume controls:
- ServerTimeService keeps client clocks aligned with retry/backoff and hands offsets to the time source.
- `resumeBehavior: "autoOnServerSync"` can resume paused sessions after the next successful sync (overridable per route).
- SessionExpiredGuard accepts route data overrides to tweak config, allow expired routes, or auto-resume when entering a view.

Sprint 4 extends the multi-tab work with HTTP awareness:
- SessionActivityHttpInterceptor supports allowlist and header-flag strategies with cooldowns, tab-focus, and leader gating.
- HTTP-triggered resets surface as `activitySource: "http"` so downstream listeners can coordinate with user actions.
- Context tokens let you flag ad-hoc requests without mutating headers when the backend already knows about the session.

Sprint 3 layers cross-tab awareness on top of the Sprint 1-2 groundwork:
- BroadcastChannel sync (with localStorage fallback) keeps extend/expire decisions in lock-step across tabs.
- LeaderElectionService heartbeats ensure one primary tab at a time and surface `LeaderElected` / `LeaderLost` session events.
- New Jest coverage exercises cross-tab extend/expire flows and leadership failover so regressions are caught early.

Earlier sprints stay green:
- Sprint 2 delivered DOM/router activity detectors plus persistence so new tabs inherit state without auto-extending.
- Sprint 1 established the core finite-state machine, persistence, and logging utilities.

## Multi-tab recipe (Sprint 3)
1. Provide `SESSION_TIMEOUT_CONFIG` with a shared `storageKeyPrefix` and optional `appInstanceId` for the product you want to coordinate across tabs.
2. Inject `SessionTimeoutService` in each bootstrapped tab and call `start()` once global services are ready.
3. Subscribe to `sessionTimeout.events$` and watch for `LeaderElected` / `LeaderLost` to gate primary-tab-only work (for example, HTTP activity syncing in later sprints).
4. Listen to `sessionTimeout.crossTab$` if you need to react immediately when another tab extends or forces expiry.
5. Each tab automatically falls back to localStorage sync when BroadcastChannel is not available, so SPA and legacy browsers stay in step.

## HTTP activity recipe (Sprint 4)
1. Provide `SessionActivityHttpInterceptor` in your app module alongside `SESSION_TIMEOUT_CONFIG`.
2. Configure `httpActivity` with either `strategy: "allowlist"` (regex-driven) or `strategy: "headerFlag"` (backend-marked) as fits your deployment.
3. When using header flags, set `headerFlag` (defaults to `X-Session-Activity`) or set a boolean on `req.context` with `getSessionActivityContextToken(name)`.
4. Tune `cooldownMs`, `ignoreOnInitMs`, `onlyWhenTabFocused`, and `primaryTabOnly` to avoid runaway activity when polling or running in background tabs.
5. Subscribe to `sessionTimeout.events$` to observe `ResetByActivity` metadata for auditing or telemetry.

## Pause/resume recipe (Sprint 5)
1. Set `resumeBehavior: 'autoOnServerSync'` in `SESSION_TIMEOUT_CONFIG` (or via `sessionTimeout.setConfig`) to resume paused sessions after the next successful server-time sync.
2. Use `SessionExpiredGuard` route data (`{ sessionTimeout: { config: { resumeBehavior: 'autoOnServerSync' }, allowWhenExpired, autoResume } }`) to tailor behavior per navigation.
3. The session stays paused when using the default `'manual'` behavior—call `sessionTimeout.resume()` or provide route overrides when you want to unblock the flow.

More documentation, recipes, and schematics will land in Sprint 6.

## ng add schematic (Sprint 6)
1. Run `ng add ng2-idle-timeout-ng-add` inside your Angular workspace.
2. The schematic adds `ng2-idle-timeout` to `package.json`, scaffolds `session-timeout.providers.ts` (exporting `sessionTimeoutProviders`), and connects the providers to `app.config.ts`.
3. Tweak the generated config as needed (for example, adjust `storageKeyPrefix`, `warnBeforeMs`, or `resumeBehavior`) before bootstrapping the app.


