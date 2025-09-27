import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'experience-docs',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './docs.component.html',
  styleUrl: './docs.component.scss'
})
export class DocsComponent {
  readonly installCommands = [
    'npm install ng2-idle-timeout',
    'ng add ng2-idle-timeout'
  ];

  readonly craftedByLabel = 'Crafted by Codex';

  readonly heroBadges = ['Signals ready', 'Cross-tab safe', 'Server aligned'];

  readonly sectionNav = [
    { label: 'Overview & Concepts', href: '#overview' },
    { label: 'Quick Start', href: '#quick-start' },
    { label: 'Configuration', href: '#configuration' },
    { label: 'Service & API Reference', href: '#api' },
    { label: 'Recipes & Integration', href: '#recipes' }
  ];

  readonly overviewHighlights = [
    'Coordinate idle, countdown, warn, and expire flows with Angular signals.',
    'Synchronise state across tabs with BroadcastChannel, local storage, and leader election.',
    'Remain zoneless-friendly thanks to DOM, router, and HTTP detectors that operate outside NgZone.'
  ];

  readonly architectureDiagram = `+--------------+    activity$     +--------------------+
| Activity DOM | ----------------> |                    |
|--------------|                   |                    |
| Activity     |    router$        |  SessionTimeout    |   snapshot()   +--------------+
| Router       | ----------------> |    Service         | --------------> | UI / Guards  |
|--------------|                   |                    |                +--------------+
| Activity HTTP|    http$          |                    |
+--------------+                   |                    | events$ / FX
                                   +--------------------+
                                                |
                                BroadcastChannel | storage
                                        cross-tab | persistence`;

  readonly compatibilityMatrix = [
    { package: 'ng2-idle-timeout', angular: '16-20', node: '>=18.13', rxjs: '>=7.5 < 9' }
  ];

  readonly providerSnippet = `// session-timeout.providers.ts
import { SESSION_TIMEOUT_CONFIG, SessionTimeoutService } from 'ng2-idle-timeout';

export const sessionTimeoutProviders = [
  SessionTimeoutService,
  {
    provide: SESSION_TIMEOUT_CONFIG,
    useValue: {
      storageKeyPrefix: 'app-session',
      idleGraceMs: 60000,
      countdownMs: 300000,
      warnBeforeMs: 60000,
      activityResetCooldownMs: 5000,
      resumeBehavior: 'autoOnServerSync'
    }
  }
];`;

  readonly configSnippet = `// app.config.ts
import { provideRouter } from '@angular/router';
import { sessionTimeoutProviders } from './session-timeout.providers';

export const appConfig = {
  providers: [
    provideRouter(routes),
    ...sessionTimeoutProviders
  ]
};`;

  readonly configOptions = [
    { key: 'idleGraceMs', defaultValue: '60000', description: 'How long the session may idle before countdown starts.' },
    { key: 'countdownMs', defaultValue: '300000', description: 'Time window for the user to extend or acknowledge before expiry.' },
    { key: 'warnBeforeMs', defaultValue: '60000', description: 'Threshold inside the countdown when WARN state triggers.' },
    { key: 'activityResetCooldownMs', defaultValue: '5000', description: 'Minimum gap between automatic resets triggered by DOM/router noise.' },
    { key: 'resumeBehavior', defaultValue: 'manual', description: 'Choose manual resume or automatic resume on the next server sync.' },
    { key: 'storageKeyPrefix', defaultValue: 'session', description: 'Namespacing for persisted configuration and snapshots.' },
    { key: 'httpActivity.strategy', defaultValue: 'none', description: 'Control how HTTP requests reset idle (`allowlist`, `headerFlag`, or `none`).' },
    { key: 'actionDelays.start', defaultValue: '0', description: 'Debounce for throttling start/stop/pause/resume actions.' },
    { key: 'logLevel', defaultValue: 'warn', description: 'Enable debug-level logging when set to `debug`.' }
  ];

  readonly timingDiagram = `Idle            Countdown            Warn              Expired
|<--60s-->||<-------------300s------------->|<--60s-->|
           ^ idleGraceMs                   ^ warnBeforeMs
           |<----- activity cooldown ----->|`;

  readonly timingPresets = [
    { name: 'Call centre', description: 'Long idle (10 min), short warn (30 s), manual resume.' },
    { name: 'Banking', description: 'Short idle (2 min), tight warn (15 s), resume only after server sync.' },
    { name: 'Kiosk', description: 'Idle disabled, countdown only, auto resume when point-of-sale heartbeat returns.' }
  ];

  readonly serviceMethods = [
    { name: 'start()', signature: 'start(): void', description: 'Initialise timers, persist a fresh snapshot, and elect a leader if needed.' },
    { name: 'stop()', signature: 'stop(): void', description: 'Reset to the initial IDLE state and clear idle/countdown timestamps.' },
    { name: 'pause()', signature: 'pause(): void', description: 'Freeze remaining time until `resume()` is invoked.' },
    { name: 'resume()', signature: 'resume(): void', description: 'Resume a paused countdown or idle cycle.' },
    { name: 'extend()', signature: 'extend(meta?): void', description: 'Restart the countdown window (ignores expired sessions).' },
    { name: 'resetIdle()', signature: 'resetIdle(meta?, options?): void', description: 'Record activity and restart the idle grace window.' },
    { name: 'expireNow()', signature: 'expireNow(reason?): void', description: 'Force an immediate expiry and emit `Expired`.' },
    { name: 'setConfig()', signature: 'setConfig(partial: SessionTimeoutPartialConfig): void', description: 'Merge and validate configuration updates at runtime.' },
    { name: 'getSnapshot()', signature: 'getSnapshot(): SessionSnapshot', description: 'Retrieve an immutable snapshot of the current state.' },
    { name: 'registerOnExpireCallback()', signature: 'registerOnExpireCallback(fn): void', description: 'Attach additional async logic when expiry happens.' }
  ];

  readonly signalRows = [
    { name: 'stateSignal', type: 'Signal<SessionState>', description: 'Current lifecycle state (IDLE / COUNTDOWN / WARN / EXPIRED).' },
    { name: 'remainingMsSignal', type: 'Signal<number>', description: 'Milliseconds until expiry, respecting pause/resume.' },
    { name: 'events$', type: 'Observable<SessionEvent>', description: 'Structured lifecycle events (Started, Warn, Extended, etc.).' },
    { name: 'activity$', type: 'Observable<ActivityEvent>', description: 'Activity resets originating from DOM/router/HTTP/manual triggers.' },
    { name: 'crossTab$', type: 'Observable<CrossTabMessage>', description: 'Broadcast payloads when cross-tab sync is enabled.' }
  ];

  readonly tokenRows = [
    { name: 'SESSION_TIMEOUT_CONFIG', type: 'InjectionToken<SessionTimeoutConfig>', description: 'Primary configuration object (override per app or route).' },
    { name: 'SESSION_TIMEOUT_HOOKS', type: 'InjectionToken<SessionTimeoutHooks>', description: 'Supply `onExpire` / `onActivity` hooks without patching the service.' },
    { name: 'SessionActivityHttpInterceptor', type: 'Angular interceptor', description: 'Auto-reset idle based on HTTP allowlist/header strategies.' },
    { name: 'SessionExpiredGuard', type: 'Angular guard', description: 'Block or redirect routes when a session is expired.' },
    { name: 'Activity sources', type: 'Injectable services', description: 'DOM, router, and custom sources that feed `resetIdle()` with metadata.' }
  ];

  readonly eventRows = [
    { type: 'Started', when: 'Engine initialised or restarted', meta: 'Snapshot persisted, leader asserted.' },
    { type: 'Extended', when: 'Countdown extended manually/automatically', meta: 'Includes new remainingMs and source metadata.' },
    { type: 'Warn', when: 'WARN threshold reached', meta: 'States leader tab id and remaining time.' },
    { type: 'Expired', when: 'Countdown reached zero', meta: 'Indicates if expire callbacks resolved.' },
    { type: 'Paused / Resumed', when: 'Manual or auto resume via server sync', meta: 'Carries previous state details.' },
    { type: 'LeaderElected', when: 'Cross-tab election updated', meta: 'Leader tab id to gate primary-only work.' }
  ];

  readonly uiPatterns = [
    { title: 'Modal warning with banner', description: 'Display a modal in WARN while keeping a slim countdown banner bound to `remainingMsSignal`.' },
    { title: 'Blocking expiry route', description: 'Use `SessionExpiredGuard` and a dedicated route to guide users through re-authentication.' },
    { title: 'Toast notifications', description: 'Stream `events$` through your notification service to alert on WARN, EXTENDED, and EXPIRED.' }
  ];

  readonly crossTabTips = [
    'Share a `storageKeyPrefix` across tabs so extends and expiries propagate instantly.',
    'Observe `LeaderElected` events to gate background sync jobs to a single primary tab.'
  ];

  readonly httpTips = [
    'Register `SessionActivityHttpInterceptor` and configure `httpActivity` allowlists for safe resets.',
    'Enable `resumeBehavior: "autoOnServerSync"` when the backend confirms the session is still valid.'
  ];

  readonly customActivityTips = [
    'Build domain-specific activity sources (websocket heartbeats, service worker messages, analytics beacons).',
    'Emit analytics whenever `Warn` or `Expired` occurs to understand dwell time and churn.',
    'In tests, override `TimeSourceService` to deterministically advance timers and assert lifecycle events.'
  ];

  readonly scripts = [
    { command: 'npm run build --workspace=ng2-idle-timeout', description: 'Build the library with ng-packagr.' },
    { command: 'npm run test --workspace=ng2-idle-timeout', description: 'Run the Jest suite for services, guards, and interceptors.' },
    { command: 'npm run demo:start', description: 'Launch the documentation and playground app locally.' },
    { command: 'npm run demo:build', description: 'Create a production build of the experience app.' },
    { command: 'npm run demo:test', description: 'Sanity-check that the demo compiles in development mode.' }
  ];

  async copy(command: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(command);
      } catch (error) {
        console.warn('Clipboard API rejected copy request', error);
      }
    }
  }
}
