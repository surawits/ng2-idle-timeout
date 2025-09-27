# ng2-idle-timeout

> Zoneless-friendly session timeout orchestration for Angular 16-20.

`ng2-idle-timeout` keeps every tab of your Angular application in sync while tracking user activity, coordinating
leader election, and handling server-aligned countdowns - all without relying on Angular zones.

---

## 1. Overview & Concepts

**What it solves**
- Consolidates idle detection, countdown warnings, and expiry flows across tabs and windows.
- Survives page reloads by persisting snapshots and configuration to storage providers.
- Plays nicely with zoneless Angular (signals everywhere) and progressive hydration.

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
                                        cross-tab  | persistence
```

**Compatible stacks**
| Package            | Angular | Node  | RxJS         |
|--------------------|---------|-------|--------------|
| `ng2-idle-timeout` | 16-20   | >=18.13 | >=7.5 < 9 |

---

## 2. Quick Start

1. **Install**
   ```bash
   npm install ng2-idle-timeout
   ```
   or scaffold everything:
   ```bash
   ng add ng2-idle-timeout-ng-add
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

3. **Start the engine** once shell services are ready:
   ```ts
   sessionTimeout.start();
   ```

4. **Verify** with the experience app:
   ```bash
   npm run demo:start
   # docs at http://localhost:4200 (playground under /playground)
   ```

---

## 3. Configuration Reference

| Key                         | Default  | Description |
|----------------------------|----------|-------------|
| `idleGraceMs`              | `60000`  | How long a session can stay idle before countdown begins. |
| `countdownMs`              | `300000` | Time window for user response before expiry. |
| `warnBeforeMs`             | `60000`  | Threshold inside the countdown when WARN state fires. |
| `activityResetCooldownMs`  | `5000`   | Minimum gap between auto resets triggered by DOM/router. |
| `resumeBehavior`           | `'manual'` | `'manual'` or `'autoOnServerSync'` for post-expiry recovery. |
| `storageKeyPrefix`         | `'session'` | Namespacing for persisted config and snapshots. |
| `httpActivity.strategy`    | `'none'` | HTTP auto reset mode (`allowlist`, `headerFlag`, `none`). |
| `actionDelays.start`       | `0`      | Debounce for throttling start/stop/pause/resume actions. |
| `logLevel`                 | `'warn'` | Emits verbose diagnostics when set to `'debug'`. |

**Timing cheat sheet**
```
Idle            Countdown            Warn              Expired
|<--60s-->||<-------------300s------------->|<--60s-->|
           ^ idleGraceMs                   ^ warnBeforeMs
           |<---- activity cooldown ---->|
```

Example presets:
- **Call centre** - long idle (10 min), short warn (30 s), manual resume.
- **Banking** - short idle (2 min), aggressive warn (15 s), server sync required.
- **Kiosk** - idle disabled, countdown only, auto resume when POS heartbeat returns.

---

## 4. Lifecycle & Events

**States**: `IDLE -> COUNTDOWN -> WARN -> EXPIRED`, with `PAUSED` overlay.

| Event Type           | When it fires                               | Metadata highlights |
|----------------------|----------------------------------------------|---------------------|
| `Started`            | Engine initialised or restarted              | Snapshot at start.  |
| `Extended`           | Countdown extended manually or automatically | Remaining ms, source. |
| `Warn`               | Entered WARN threshold                       | Current tab leader. |
| `Expired`            | Countdown reached zero                       | Whether callbacks resolved. |
| `Paused` / `Resumed` | Manual controls or server-sync auto resume   | Previous state. |
| `LeaderElected`      | Cross-tab election result                    | Leader tab id. |

Use `sessionTimeout.events$` for a log, `activity$` to understand reset sources, and `getSnapshot()`/signals (`stateSignal`, `remainingMsSignal`) to bind UI.

---

## 5. UI Integration Recipes

- **Modal warning + banner** - show a modal in WARN while keeping a slim banner/countdown visible; supply snippets for Angular Material, ng-zorro, and Bootstrap.
- **Blocking expiry screen** - redirect to an "expired" route using `SessionExpiredGuard` with custom copy/actions.
- **Toast or notification** - pipe `events$` through a store to push toast notifications on `Warn`, `LeaderLost`, or `Extended` events.
- **Analytics hook** - forward `events$` into observability tooling to track idle vs engaged time.

Each recipe in docs includes copy/paste snippets, styling tokens, and suggested UX copy.

---

## 6. Advanced Topics

- **Cross-tab coordination** - enable broadcast channels, customise storage, and respond to leader election callbacks.
- **Server time alignment** - inject `ServerTimeService`, configure jitter/backoff, and allow `autoOnServerSync` to revive WARN sessions.
- **Custom activity sources** - extend the activity interface to plug in domain-specific signals (websocket heartbeats, service worker messages).
- **Action delays and throttling** - use `actionDelays` to smooth aggressive UI controls or high-frequency automation.

---

## 7. Testing & Troubleshooting

**Testing helpers**
- Fake time source (`TimeSourceService` override) to deterministically advance timers.
- Ephemeral storage adapters to isolate state between tests.
- Marble tests for `events$` and `activity$` streams.

**Troubleshooting checklist**
- Inspect `sessionTimeout.getSnapshot()` in DevTools to confirm state transitions.
- Enable `logLevel: 'debug'` to print lifecycle events and cross-tab messages.
- Watch for clock drift if `ServerTimeService` is disabled but your backend enforces strict TTL.
- Ensure primary tab election is stable inside private browsing (BroadcastChannel limitations).

Common issues and remedies are captured in the FAQ on the docs site.

---

## 8. Migration & Versioning

- Release notes live in [`RELEASE_NOTES.md`](./RELEASE_NOTES.md).
- Follow the compatibility matrix above when upgrading Angular.
- Major releases ship schematics to migrate providers and config names (for example, `idleMs` -> `idleGraceMs`).
- Changelogs highlight breaking changes and opt-in feature flags.

---

## 9. Community & Support

| Resource    | Purpose |
|-------------|---------|
| Issues      | Report bugs, request features (include repro + environment). |
| Discussions | Share patterns, ask design questions. |
| Roadmap     | `.github/ISSUE_TEMPLATE/roadmap.md` outlines upcoming milestones. |
| Releases    | GitHub releases with tagged packages and playground deploys. |

**Contribution guide**
1. Fork and create a feature branch.
2. Run `npm run build --workspace=ng2-idle-timeout` and relevant tests before a PR.
3. Follow Conventional Commits (`feat:`, `fix:`, `chore:` ...).
4. Update docs/examples when behaviour changes.

**Maintainer scripts**
| Command | Purpose |
|---------|---------|
| `npm run build --workspace=ng2-idle-timeout` | Build the library with ng-packagr. |
| `npm run test --workspace=ng2-idle-timeout`  | Jest suite for services, guards, interceptors. |
| `npm run demo:start`                         | Launch docs + playground locally. |
| `npm run demo:build`                         | Production build of the experience app. |
| `npm run demo:test`                          | Basic sanity check for the demo build. |

MIT licensed - happy idling!
