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
- Coordinates leader election across tabs and keeps shared state consistent without relying on Angular zones.
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

   Use `createSessionTimeoutProviders` to bundle the service and configuration once and reuse the exported config with `provideSessionTimeout` when bootstrapping.

   ```ts
   // session-timeout.providers.ts
   import { createSessionTimeoutProviders } from 'ng2-idle-timeout';
   import type { SessionTimeoutPartialConfig } from 'ng2-idle-timeout';

   export const defaultSessionTimeoutConfig: SessionTimeoutPartialConfig = {
     storageKeyPrefix: 'app-session',
     idleGraceMs: 60_000,
     countdownMs: 300_000,
     warnBeforeMs: 60_000,
     resumeBehavior: 'autoOnServerSync'
   };

   export const sessionTimeoutProviders = createSessionTimeoutProviders(defaultSessionTimeoutConfig);
   ```


3. **Register providers with your bootstrap**

   **Standalone bootstrap (`main.ts`)**

   ```ts
   import { bootstrapApplication } from '@angular/platform-browser';
   import { provideRouter } from '@angular/router';
   import { AppComponent } from './app/app.component';
   import { routes } from './app/app.routes';
   import { provideSessionTimeout } from 'ng2-idle-timeout';

   bootstrapApplication(AppComponent, {
     providers: [
       provideRouter(routes),
       provideSessionTimeout(() => ({
         storageKeyPrefix: 'app-session',
         idleGraceMs: 60_000,
         countdownMs: 300_000,
         warnBeforeMs: 60_000,
         resumeBehavior: 'autoOnServerSync'
       }))
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

    // Signals for zone-less change detection or computed view models
    protected readonly state = this.sessionTimeout.stateSignal;
    protected readonly idleRemainingMs = this.sessionTimeout.idleRemainingMsSignal;
    protected readonly countdownRemainingMs = this.sessionTimeout.countdownRemainingMsSignal;
    protected readonly totalRemainingMs = this.sessionTimeout.totalRemainingMsSignal;
    protected readonly activityCooldownMs = this.sessionTimeout.activityCooldownRemainingMsSignal;

    // Observable mirrors for async pipe / RxJS composition
    protected readonly state$ = this.sessionTimeout.state$;
    protected readonly totalRemainingMs$ = this.sessionTimeout.totalRemainingMs$;
    protected readonly isWarn$ = this.sessionTimeout.isWarn$;
    protected readonly isExpired$ = this.sessionTimeout.isExpired$;
    protected readonly events$ = this.sessionTimeout.events$;
  }
  ```

  ```html
  <!-- session-status.component.html -->
  <section class="session-status">
    <p>State (signal): {{ state() }}</p>
    <p>State (observable): {{ (state$ | async) }}</p>
    <p>Idle window: {{ (idleRemainingMs() / 1000) | number:'1.0-0' }}s</p>
    <p>Countdown: {{ (countdownRemainingMs() / 1000) | number:'1.0-0' }}s</p>
    <p>Total remaining (signal): {{ (totalRemainingMs() / 1000) | number:'1.0-0' }}s</p>
    <p>Total remaining (observable): {{ (((totalRemainingMs$ | async) ?? 0) / 1000) | number:'1.0-0' }}s</p>
    <p>Activity cooldown: {{ (activityCooldownMs() / 1000) | number:'1.0-0' }}s</p>
    <p *ngIf="isWarn$ | async">Warn phase active</p>
    <p *ngIf="isExpired$ | async">Session expired</p>
    <ng-container *ngIf="(events$ | async) as event">
      <p>Last event: {{ event.type }}</p>
    </ng-container>
  </section>
  ```

  Call `sessionTimeout.start()` once (as shown above) before relying on the signals; they emit immediately after bootstrap.

  Every public signal on `SessionTimeoutService` has a matching `...$` observable that emits the same values in lockstep, so you can switch between signals and RxJS without custom bridges.

6. **Explore the demo**

   ```bash
   npm run demo:start
   # docs at http://localhost:4200, playground under /playground
   ```

   Adjust the sliders, emit activity, and watch the live snapshot to confirm timers behave as expected.

---

## Configuration Guide

| Key | Default | Description |
|-----|---------|-------------|
| `idleGraceMs` | `120000` | Milliseconds the session may remain idle before countdown begins. |
| `countdownMs` | `3600000` | Countdown window (in ms) for the user to extend or acknowledge before expiry. |
| `warnBeforeMs` | `300000` | Threshold inside the countdown that emits a WARN event and typically opens UI prompts. |
| `activityResetCooldownMs` | `0` | Minimum gap between automatic resets triggered by DOM/router activity noise. |
| `domActivityEvents` | `['mousedown','click','wheel','scroll','keydown','keyup','touchstart','touchend','visibilitychange']` | Events that count as user activity. Add `mousemove` or `touchmove` when you explicitly need high-frequency sources. |
| `storageKeyPrefix` | `'ng2-idle-timeout'` | Namespace applied to persisted configuration and snapshots across tabs. |
| `resumeBehavior` | `'manual'` | Keep manual resume (default) or enable `'autoOnServerSync'` when the backend confirms session validity. |
| `httpActivity.strategy` | `'allowlist'` | HTTP auto-reset mode (`'allowlist'`, `'headerFlag'`, or `'aggressive'`). |
| `logging` | `'warn'` | Emit verbose diagnostics when set to `'debug'` or `'trace'`. |
| `resetOnWarningActivity` | `true` | Automatically reset the session when keyboard, mouse, scroll, or HTTP activity occurs during the countdown/warn phase. Set to `false` to require manual intervention once a warning is visible. |
| `ignoreUserActivityWhenPaused` | `false` | Ignore DOM/router activity while paused to prevent accidental resumes. |
| `allowManualExtendWhenExpired` | `false` | Allow operators to extend even after expiry when business rules permit it. |

When the warning phase is active the service keeps a deterministic priority order: `manual` > `http` > `router` > `dom`/`cross-tab`. Lower-priority activity that gets ignored exposes `resetSuppressed` and `resetSuppressedReason` metadata through `activity$` so UIs and analytics can explain why a reset did not occur.

**Timing cheat sheet (example)**

```
Idle            Countdown            Warn              Expired
|<--120s-->||<-------------300s------------->|<--60s-->|
           ^ idleGraceMs                   ^ warnBeforeMs
           |<----- activity cooldown ----->|
```

**Configuration presets**

- **Call centre**: long idle (10 min), short warn (30 s), manual resume.
- **Banking**: short idle (2 min), tight warn (15 s), resume only after server sync.
- **Kiosk**: idle disabled, countdown only, auto resume when the POS heartbeat returns.

### Sync modes

- `'leader'`: default single-writer coordination. The elected tab owns persistence and rebroadcasts snapshots.
- `'distributed'`: active-active coordination using Lamport clocks. Any tab may publish updates; conflicts resolve by logical clock then writer id.


### Shared state metadata

Distributed snapshots embed metadata so tabs can order updates deterministically:

- `revision` and `logicalClock` track monotonic progress per snapshot.
- `writerId` identifies the tab that produced the update.
- `operation` clarifies whether the update came from activity, pause/resume, config changes, or expiry.
- `causalityToken` de-duplicates retries and unlocks expect-reply flows.

Version 3 of the shared state schema loads older persisted payloads and upgrades them automatically, but clearing storage during deployment avoids carrying stale Lamport clocks.

### DOM activity include list

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

| Signal | Observable | Type | Emits |
|--------|------------|------|-------|
| `stateSignal` | `state$` | `SessionState` | Current lifecycle state (`IDLE / COUNTDOWN / WARN / EXPIRED`). |
| `idleRemainingMsSignal` | `idleRemainingMs$` | `number` | Milliseconds left in the idle grace window (0 outside `IDLE`). |
| `countdownRemainingMsSignal` | `countdownRemainingMs$` | `number` | Countdown or warn phase remaining, frozen while paused. |
| `activityCooldownRemainingMsSignal` | `activityCooldownRemainingMs$` | `number` | Time until DOM/router activity may auto-reset again. |
| `totalRemainingMsSignal` | `totalRemainingMs$` | `number` | Remaining time in the active phase (idle + countdown). |
| `remainingMsSignal` | `remainingMs$` | `number` | Alias of total remaining time for legacy integrations. |
| `isWarnSignal` | `isWarn$` | `boolean` | `true` when the countdown has entered the warn window. |
| `isExpiredSignal` | `isExpired$` | `boolean` | `true` after expiry. |
| n/a | `events$` | `Observable<SessionEvent>` | Structured lifecycle events (Started, Warn, Extended, etc.). |
| n/a | `activity$` | `Observable<ActivityEvent>` | Activity resets originating from DOM/router/HTTP/manual triggers. |
| n/a | `crossTab$` | `Observable<CrossTabMessage>` | Broadcast payloads when cross-tab sync is enabled. |

`remainingMs$` is the same stream instance as `totalRemainingMs$`, preserving backwards compatibility while avoiding duplicate emissions.

### Tokens and supporting providers

| Token or helper | Type | Description |
|-----------------|------|-------------|
| `SESSION_TIMEOUT_CONFIG` | `InjectionToken<SessionTimeoutConfig>` | Primary configuration object (override per app or route). |
| `SESSION_TIMEOUT_HOOKS` | `InjectionToken<SessionTimeoutHooks>` | Supply `onExpire` or `onActivity` hooks without patching the service. |
| `SessionActivityHttpInterceptor` | Angular interceptor | Auto-reset idle based on HTTP allowlist/header strategies. |
| `SessionExpiredGuard` | Angular guard | Block or redirect routes when a session is expired. |
| Activity sources (DOM, router, custom) | Injectable services | Feed `resetIdle()` with metadata about where activity came from. |
| `TimeSourceService` | Injectable service | Exposes `offset`/`offset$` so you can monitor and reset server time offsets. |

---

## Recipes & Integration Guides

### UI patterns

- Modal warning with a live countdown banner bound to `countdownRemainingMsSignal` (or `countdownRemainingMs$` with `async`).
- Blocking expiry route using `SessionExpiredGuard` and a focused re-authentication screen.
- Toast notifications by streaming `events$` through your notification or analytics service.

### Cross-tab and multi-device coordination

- Share a `storageKeyPrefix` across tabs so extends and expiries propagate instantly.
- Subscribe to `LeaderElected` events to gate background sync jobs to a single primary tab.
- Use the playground diagnostics to rehearse failover and reconciliation flows before release.

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
- **Support & issues**: open tickets at https://github.com/ng2-idle-timeout.

**Maintainer scripts**

- `npm run build --workspace=ng2-idle-timeout` - build the library with ng-packagr.
- `npm run test --workspace=ng2-idle-timeout` - run the Jest suite for services, guards, and interceptors.
- `npm run demo:start` - launch the documentation and playground app locally.
- `npm run demo:build` - production build of the experience app.
- `npm run demo:test` - sanity-check that the demo compiles in development mode.

MIT licensed - happy idling!

