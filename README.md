# ng2-idle-timeout

> Zoneless-friendly session timeout orchestration for Angular 16-20.

> Crafted by Codex.

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

| Package            | Angular | Node    | RxJS      |
|--------------------|---------|---------|-----------|
| `ng2-idle-timeout` | 16-20   | >=18.13 | >=7.5 < 9 |

---

## Quick Start

Your application might be bootstrapped with the standalone APIs (`bootstrapApplication`) or with an NgModule. If you do not have `app.config.ts`, register the `sessionTimeoutProviders` directly where you bootstrap (for example in `main.ts` or `AppModule`). The library works the same in both setups.

1. **Install**

   ```bash
   npm install ng2-idle-timeout
   ```

   Or scaffold everything:

   ```bash
   ng add ng2-idle-timeout
   ```

2. **Define shared providers**

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

3. **Register providers with your bootstrap**

   **Standalone bootstrap (`main.ts`)**

   ```ts
   import { bootstrapApplication } from '@angular/platform-browser';
   import { provideRouter } from '@angular/router';
   import { AppComponent } from './app/app.component';
   import { routes } from './app/app.routes';
   import { sessionTimeoutProviders } from './app/session-timeout.providers';

   bootstrapApplication(AppComponent, {
     providers: [
       provideRouter(routes),
       ...sessionTimeoutProviders
     ]
   });
   ```

   **NgModule bootstrap (`app.module.ts`)**

   ```ts
   import { NgModule } from '@angular/core';
   import { BrowserModule } from '@angular/platform-browser';
   import { AppComponent } from './app.component';
   import { sessionTimeoutProviders } from './session-timeout.providers';

   @NgModule({
     declarations: [AppComponent],
     imports: [BrowserModule /* other modules */],
     providers: [...sessionTimeoutProviders],
     bootstrap: [AppComponent]
   })
   export class AppModule {}
   ```

   > If you plan to use the HTTP activity helpers, also add `provideHttpClient(withInterceptorsFromDi())` in the standalone bootstrap or import `HttpClientModule` and register `SessionActivityHttpInterceptor` in your NgModule.

4. **Start the engine once dependencies are ready**

   ```ts
   // app.component.ts (or another shell service)
   constructor(private readonly sessionTimeout: SessionTimeoutService) {}

   ngOnInit(): void {
     this.sessionTimeout.start();
   }
   ```

5. **Sample usage (inject the service)**

   ```ts
   // session-status.component.ts
   import { Component, inject } from '@angular/core';
   import { DecimalPipe } from '@angular/common';
   import { SessionTimeoutService } from 'ng2-idle-timeout';

   @Component({
     selector: 'app-session-status',
     standalone: true,
     imports: [DecimalPipe],
     templateUrl: './session-status.component.html'
   })
    export class SessionStatusComponent {
      private readonly sessionTimeout = inject(SessionTimeoutService);
      protected readonly state = this.sessionTimeout.stateSignal;
      protected readonly idleRemainingMs = this.sessionTimeout.idleRemainingMsSignal;
      protected readonly countdownRemainingMs = this.sessionTimeout.countdownRemainingMsSignal;
      protected readonly totalRemainingMs = this.sessionTimeout.totalRemainingMsSignal;
      protected readonly activityCooldownMs = this.sessionTimeout.activityCooldownRemainingMsSignal;
      protected readonly events$ = this.sessionTimeout.events$;
    }
   ```

   ```html
   <!-- session-status.component.html -->
   <section class="session-status">
     <p>State: {{ state() }}</p>
     <p>Idle window: {{ (idleRemainingMs() / 1000) | number:'1.0-0' }}s</p>
     <p>Countdown: {{ (countdownRemainingMs() / 1000) | number:'1.0-0' }}s</p>
     <p>Total remaining: {{ (totalRemainingMs() / 1000) | number:'1.0-0' }}s</p>
     <p>Activity cooldown: {{ (activityCooldownMs() / 1000) | number:'1.0-0' }}s</p>
     <ng-container *ngIf="(events$ | async) as event">
       <p>Last event: {{ event.type }}</p>
     </ng-container>
   </section>
   ```

   Call `sessionTimeout.start()` once (as shown above) before relying on the signals; they emit immediately after bootstrap.

6. **Explore the demo**

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
| `domActivityEvents`       | `[ 'mousedown', 'click', 'wheel', 'scroll', 'keydown', 'keyup', 'touchstart', 'touchend', 'visibilitychange' ]` | DOM events that reset idle; add `mousemove`/`touchmove` when you explicitly want high-frequency sources. |
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
- **Kiosk**: idle disabled, countdown only, auto resume when the POS heartbeat returns.\n\n### DOM activity include list

`domActivityEvents` controls which DOM events count as user activity. The default set listens for clicks, wheel/scroll, key presses, touch start/end, and `visibilitychange` while leaving high-frequency sources such as `mousemove` and `touchmove` disabled to avoid noise. Add or remove events at bootstrap or at runtime:

```ts
import { DEFAULT_DOM_ACTIVITY_EVENTS } from 'ng2-idle-timeout';

sessionTimeoutService.setConfig({
  domActivityEvents: [...DEFAULT_DOM_ACTIVITY_EVENTS, 'mousemove']
});
```

Calling `setConfig` applies the change immediately, so you can toggle listeners when opening immersive flows (video, games) without restarting the countdown logic.



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
| `idleRemainingMsSignal` | `Signal<number>` | Milliseconds left in the idle grace window (0 outside `IDLE`). |
| `countdownRemainingMsSignal` | `Signal<number>` | Countdown or warn phase remaining, frozen while paused. |
| `activityCooldownRemainingMsSignal` | `Signal<number>` | Time until DOM/router activity may auto-reset again. |
| `totalRemainingMsSignal` | `Signal<number>` | Remaining time in the active phase (idle + countdown). |
| `remainingMsSignal` | `Signal<number>` | Alias of `totalRemainingMsSignal` for backward compatibility. |
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

- Modal warning with a live countdown banner bound to `countdownRemainingMsSignal`.
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
- **Release notes**: see `RELEASE_NOTES.md` for breaking changes and upgrade hints.
- **Support & issues**: open tickets at https://github.com/ng2-idle-timeout/ng2-idle-timeout.

**Maintainer scripts**

- `npm run build --workspace=ng2-idle-timeout` - build the library with ng-packagr.
- `npm run test --workspace=ng2-idle-timeout` - run the Jest suite for services, guards, and interceptors.
- `npm run demo:start` - launch the documentation and playground app locally.
- `npm run demo:build` - production build of the experience app.
- `npm run demo:test` - sanity-check that the demo compiles in development mode.

MIT licensed - happy idling!
