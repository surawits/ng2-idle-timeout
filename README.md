# ng2-idle-timeout

> Zoneless-friendly session timeout orchestration for Angular 16-20.

`ng2-idle-timeout` keeps every tab of your Angular application in sync while tracking user activity, coordinating leader election, and handling server-aligned countdowns without relying on Angular zones.

---

## Contents

- [Overview & Concepts](#overview--concepts)
- [Quick Start](#quick-start)
- [Configuration Guide](#configuration-guide)
- [Service & API Reference](#service--api-reference)
- [Recipes & Integration Guides](#recipes--integration-guides)
- [Additional Resources](#additional-resources)

---

## Overview & Concepts

**What it solves**

- Consolidates idle detection, countdown warnings, and expiry flows across tabs and windows.
- Survives reloads by persisting snapshots and configuration so state is restored instantly.
- Remains zoneless-friendly; activity sources are built on Angular signals.

**How it fits together**

```
+--------------+    activity$     +--------------------+
| Activity DOM | ----------------> |                    |
+--------------+                  |                    |
| Activity     |    router$       |  SessionTimeout    |   snapshot()   +--------------+
| Router       | ----------------> |    Service         | --------------> | UI / Guards  |
+--------------+                  |                    |                +--------------+
| Activity HTTP|    http$         |                    |
+--------------+                  |                    | events$ / FX
                                   +--------------------+
                                                |
                                BroadcastChannel | storage
                                        cross-tab | persistence
```

**Compatibility matrix**

| Package            | Angular | Node   | RxJS      |
|--------------------|---------|--------|-----------|
| `ng2-idle-timeout` | 16-20   | >=18.13| >=7.5 < 9 |

---

## Quick Start

1. **Install**

   ```bash
   npm install ng2-idle-timeout
   ```

   or scaffold everything:

   ```bash
   ng add ng2-idle-timeout
   ```

2. **Provide configuration**

   ```ts
   // session-timeout.providers.ts
   import { SESSION_TIMEOUT_CONFIG, SessionTimeoutService } from 'ng2-idle-timeout';

   export const sessionTimeoutProviders = [
     SessionTimeoutService,
     {
       provide: SESSION_TIMEOUT_CONFIG,
       useValue: {
         storageKeyPrefix: 'app-session',
         idleGraceMs: 60_000,
         countdownMs: 300_000,
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
     providers: [provideRouter(routes), ...sessionTimeoutProviders]
   };
   ```

3. **Start the engine once shell services are ready**

   ```ts
   sessionTimeout.start();
   ```

4. **Verify with the experience app playground**

   ```bash
   npm run demo:start
   # docs at http://localhost:4200, playground under /playground
   ```

   Adjust the sliders, emit activity, and watch the live snapshot to confirm timers behave as expected.

---

## Configuration Guide

| Key                        | Default  | Description |
|---------------------------|----------|-------------|
| `idleGraceMs`             | `60000`  | How long a session may remain idle before the countdown starts. |
| `countdownMs`             | `300000` | Time window for the user to extend or acknowledge before expiry. |
| `warnBeforeMs`            | `60000`  | Threshold inside the countdown when WARN state triggers. |
| `activityResetCooldownMs` | `5000`   | Minimum gap between automatic resets triggered by DOM/router noise. |
| `resumeBehavior`          | `'manual'` | `'manual'` or `'autoOnServerSync'` for post-expiry recovery. |
| `storageKeyPrefix`        | `'session'` | Namespacing prefix for persisted config and snapshots. |
| `httpActivity.strategy`   | `'none'` | HTTP auto reset mode (`allowlist`, `headerFlag`, or `none`). |
| `actionDelays.start`      | `0`      | Debounce for throttling start/stop/pause/resume actions. |
| `logLevel`                | `'warn'` | Emit verbose diagnostics when set to `'debug'`. |

**Timing cheat sheet**

```
Idle            Countdown            Warn              Expired
|<--60s-->||<-------------300s------------->|<--60s-->|
           ^ idleGraceMs                   ^ warnBeforeMs
           |<----- activity cooldown ----->|
```

**Configuration presets**

- **Call centre**: long idle (10 min), short warn (30 s), manual resume.
- **Banking**: short idle (2 min), tight warn (15 s), resume only after server sync.
- **Kiosk**: idle disabled, countdown only, auto resume when the POS heartbeat returns.

---

## Service & API Reference

### SessionTimeoutService methods

| Method | Signature | Purpose |
|--------|-----------|---------|
| `start` | `start(): void` | Initialise timers, persist a fresh snapshot, and elect a leader if needed. |
| `stop` | `stop(): void` | Reset to the initial IDLE state and clear idle/countdown timestamps. |
| `pause` | `pause(): void` | Freeze remaining time until `resume()` is invoked. |
| `resume` | `resume(): void` | Resume a paused countdown or idle cycle. |
| `extend` | `extend(meta?): void` | Restart the countdown window (ignores expired sessions). |
| `resetIdle` | `resetIdle(meta?, options?): void` | Record activity and restart the idle grace window. |
| `expireNow` | `expireNow(reason?): void` | Force an immediate expiry and emit `Expired`. |
| `setConfig` | `setConfig(partial: SessionTimeoutPartialConfig): void` | Merge and validate configuration updates at runtime. |
| `getSnapshot` | `getSnapshot(): SessionSnapshot` | Retrieve an immutable snapshot of the current state. |
| `registerOnExpireCallback` | `registerOnExpireCallback(handler): void` | Attach additional async logic when expiry happens. |

### Signals and streams

| Name | Type | Emits |
|------|------|-------|
| `stateSignal` | `Signal<SessionState>` | Current lifecycle state (`IDLE / COUNTDOWN / WARN / EXPIRED`). |
| `remainingMsSignal` | `Signal<number>` | Milliseconds until expiry, respecting pause/resume. |
| `events$` | `Observable<SessionEvent>` | Structured lifecycle events (Started, Warn, Extended, etc.). |
| `activity$` | `Observable<ActivityEvent>` | Activity resets originating from DOM/router/HTTP/manual triggers. |
| `crossTab$` | `Observable<CrossTabMessage>` | Broadcast payloads when cross-tab sync is enabled. |

### Tokens and supporting providers

| Token or helper | Type | Description |
|-----------------|------|-------------|
| `SESSION_TIMEOUT_CONFIG` | `InjectionToken<SessionTimeoutConfig>` | Primary configuration object (override per app or route). |
| `SESSION_TIMEOUT_HOOKS` | `InjectionToken<SessionTimeoutHooks>` | Supply `onExpire` or `onActivity` hooks without patching the service. |
| `SessionActivityHttpInterceptor` | Angular interceptor | Auto-reset idle based on HTTP allowlist/header strategies. |
| `SessionExpiredGuard` | Angular guard | Block or redirect routes when a session is expired. |
| Activity sources (DOM, router, custom) | Injectable services | Feed `resetIdle()` with metadata about where activity came from. |

---

## Recipes & Integration Guides

### UI patterns

- Modal warning with a live countdown banner bound to `remainingMsSignal`.
- Blocking expiry route using `SessionExpiredGuard` and a focused re-authentication screen.
- Toast notifications by streaming `events$` through your notification or analytics service.

### Cross-tab and multi-device coordination

- Share a `storageKeyPrefix` across tabs so extends and expiries propagate instantly.
- Subscribe to `LeaderElected` events to gate background sync jobs to a single primary tab.

### HTTP and server alignment

- Register `SessionActivityHttpInterceptor` and configure `httpActivity` allowlists for safe auto-resets.
- Enable `resumeBehavior: 'autoOnServerSync'` when the backend can confirm the session is still valid.
- Pair `ServerTimeService` with jitter/backoff if backend TTL is authoritative.

### Custom activity and instrumentation

- Build domain-specific activity sources (websocket heartbeats, service worker messages, analytics beacons).
- Emit analytics whenever `Warn` or `Expired` occurs to understand dwell time versus active time.
- In tests, override `TimeSourceService` to deterministically advance timers and assert lifecycle events.

---

## Additional Resources

- **Docs & playground**: `npm run demo:start` (Angular 18 experience app at http://localhost:4200).
- **Release notes**: see [`RELEASE_NOTES.md`](./RELEASE_NOTES.md) for breaking changes and upgrade hints.
- **Support & issues**: open tickets at [github.com/ng2-idle-timeout/ng2-idle-timeout](https://github.com/ng2-idle-timeout/ng2-idle-timeout).

**Maintainer scripts**

- `npm run build --workspace=ng2-idle-timeout` – build the library with ng-packagr.
- `npm run test --workspace=ng2-idle-timeout` – run the Jest suite for services, guards, and interceptors.
- `npm run demo:start` – launch the documentation and playground app locally.
- `npm run demo:build` – production build of the experience app.
- `npm run demo:test` – sanity-check that the demo compiles in development mode.

MIT licensed – happy idling!
