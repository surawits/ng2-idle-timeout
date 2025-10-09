import { EnvironmentInjector, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TestBed, fakeAsync, flushMicrotasks, discardPeriodicTasks } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';

import type { ActivityEvent } from '../models/activity-event';
import type { SessionSnapshot } from '../models/session-state';
import type { SessionTimeoutConfig, SessionTimeoutPartialConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';
import { SessionTimeoutService } from './session-timeout.service';
import type { CrossTabMessage } from '../models/cross-tab-message';
import { SHARED_STATE_VERSION, type SharedSessionState, type SharedStateMessage } from '../models/session-shared-state';
import { SharedStateCoordinatorService } from './shared-state-coordinator.service';
import { LeaderElectionService, HEARTBEAT_INTERVAL_MS, LEADER_TTL_MS } from './leader-election.service';
import type { BroadcastAdapter } from '../utils/broadcast-channel';
import { TimeSourceService } from './time-source.service';
import { ActivityDomService } from './activity-dom.service';
import { ActivityRouterService } from './activity-router.service';
import { ServerTimeService } from './server-time.service';
import { createSessionTimeoutProviders } from '../provide-session-timeout';


jest.mock('../utils/broadcast-channel', () => {
  class MockBroadcastAdapter {
    readonly messages: unknown[] = [];
    private readonly listeners = new Set<(message: MessageEvent) => void>();

    constructor(readonly name: string) {}

    publish(message: unknown): void {
      this.messages.push(message);
      this.listeners.forEach(listener => listener({ data: message } as MessageEvent));
    }

    close(): void {
      this.listeners.clear();
    }

    subscribe(callback: (message: MessageEvent) => void): void {
      this.listeners.add(callback);
    }

    emit(message: unknown): void {
      this.listeners.forEach(listener => listener({ data: message } as MessageEvent));
    }
  }

  const channels = new Map<string, MockBroadcastAdapter>();

  return {
    createBroadcastChannel: (name: string) => {
      const adapter = new MockBroadcastAdapter(name);
      channels.set(name, adapter);
      return adapter;
    },
    __getChannel: (name: string) => channels.get(name),
    __resetChannels: () => {
      channels.forEach(channel => channel.close());
      channels.clear();
    }
  };
});

type BroadcastMockModule = {
  __getChannel: (name: string) => (BroadcastAdapter & { messages: unknown[]; emit(message: unknown): void }) | undefined;
  __resetChannels: () => void;
};

class MockTimeSourceService {
  private current = 0;

  now(): number {
    return this.current;
  }

  setNow(value: number): void {
    this.current = value;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

class StubActivityDomService {
  private readonly subject = new Subject<ActivityEvent>();
  readonly events$ = this.subject.asObservable();
  updateConfig = jest.fn();

  emit(meta?: Record<string, unknown>): void {
    this.subject.next({ source: 'dom', at: Date.now(), meta });
  }
}

class StubActivityRouterService {
  private readonly subject = new Subject<ActivityEvent>();
  readonly events$ = this.subject.asObservable();
  updateConfig = jest.fn();

  emit(meta?: Record<string, unknown>): void {
    this.subject.next({ source: 'router', at: Date.now(), meta });
  }
}

class StubServerTimeService {
  configure = jest.fn();
  stop = jest.fn();
  private listener: (() => void) | null = null;

  registerSyncListener(listener: () => void): void {
    this.listener = listener;
  }

  unregisterSyncListener(listener: () => void): void {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  triggerSync(): void {
    this.listener?.();
  }
}

class SharedStateCoordinatorStub {
  updateConfig = jest.fn();
  publishState = jest.fn();
  requestSync = jest.fn();
  readPersistedState = jest.fn<SharedSessionState | null, []>(() => null);
  clearPersistedState = jest.fn();
  getSourceId = jest.fn(() => 'coordinator-stub');
  private readonly updatesSubject = new Subject<SharedStateMessage>();
  readonly updates$ = this.updatesSubject.asObservable();

  emit(message: SharedStateMessage): void {
    this.updatesSubject.next(message);
  }
}

class StubLeaderElectionService {
  readonly tabId = 'local-tab';
  private readonly leaderSignalInternal = signal<string | null>(null);
  private readonly isLeaderComputed = computed(() => this.leaderSignalInternal() === this.tabId);

  updateConfig = jest.fn();

  isLeader(): boolean {
    return this.isLeaderComputed();
  }

  leaderId(): string | null {
    return this.leaderSignalInternal();
  }

  electLeader(): void {
    const current = this.leaderSignalInternal();
    if (current == null || current === this.tabId) {
      this.leaderSignalInternal.set(this.tabId);
    }
  }

  stepDown(): void {
    this.leaderSignalInternal.set(null);
  }

  assumeLeader(id: string | null): void {
    this.leaderSignalInternal.set(id);
  }
}

describe('SessionTimeoutService', () => {
  let injector: EnvironmentInjector;
  let service: SessionTimeoutService;
  let time: MockTimeSourceService;
  let domService: StubActivityDomService;
  let routerService: StubActivityRouterService;
  let serverTime: StubServerTimeService;
  let sharedCoordinator: SharedStateCoordinatorStub;
  let leaderElection: StubLeaderElectionService;
  let broadcastMock: BroadcastMockModule;
  let requestSyncMock: jest.Mock;
  let publishStateMock: jest.Mock;
  const baseConfig: SessionTimeoutConfig = {
    idleGraceMs: 200,
    countdownMs: 1000,
    warnBeforeMs: 300,
    pollingMs: 50,
    activityResetCooldownMs: 0,
    storageKeyPrefix: 'test',
    appInstanceId: 'testApp',
    strategy: 'userOnly',
    httpActivity: {
      enabled: false,
      strategy: 'allowlist',
      allowlist: [],
      denylist: [],
      ignoreOnInitMs: 0,
      cooldownMs: 0,
      onlyWhenTabFocused: false,
      primaryTabOnly: false
    },
    actionDelays: {
      start: 0,
      stop: 0,
      resetIdle: 0,
      extend: 0,
      pause: 0,
      resume: 0,
      expire: 0
    },
    openNewTabBehavior: 'inherit',
    routerCountsAsActivity: true,
    domActivityEvents: DEFAULT_SESSION_TIMEOUT_CONFIG.domActivityEvents,
    debounceMouseMs: 800,
    debounceKeyMs: 200,
    maxExtendPerSession: 0,
    onExpire: 'emit',
    timeSource: 'client',
    serverTimeEndpoint: undefined,
    logging: 'silent',
    resetOnWarningActivity: true,
    ignoreUserActivityWhenPaused: false,
    allowManualExtendWhenExpired: false,
    resumeBehavior: 'manual'
  };

  beforeEach(() => {
    broadcastMock = jest.requireMock('../utils/broadcast-channel') as BroadcastMockModule;
    broadcastMock.__resetChannels();

    domService = new StubActivityDomService();
    routerService = new StubActivityRouterService();
    serverTime = new StubServerTimeService();

    TestBed.configureTestingModule({
      providers: [
        SessionTimeoutService,
        { provide: TimeSourceService, useClass: MockTimeSourceService },
        { provide: SESSION_TIMEOUT_CONFIG, useValue: baseConfig },
        { provide: ActivityDomService, useValue: domService },
        { provide: ActivityRouterService, useValue: routerService },
        { provide: ServerTimeService, useValue: serverTime },
        { provide: SharedStateCoordinatorService, useClass: SharedStateCoordinatorStub },
        { provide: LeaderElectionService, useClass: StubLeaderElectionService }
      ]
    });

    injector = TestBed.inject(EnvironmentInjector);
    service = TestBed.inject(SessionTimeoutService);
    time = TestBed.inject(TimeSourceService) as unknown as MockTimeSourceService;
    sharedCoordinator = TestBed.inject(SharedStateCoordinatorService) as unknown as SharedStateCoordinatorStub;
    leaderElection = TestBed.inject(LeaderElectionService) as unknown as StubLeaderElectionService;
    requestSyncMock = sharedCoordinator.requestSync;
    publishStateMock = sharedCoordinator.publishState;
  });

  afterEach(() => {
    requestSyncMock?.mockReset();
    publishStateMock?.mockReset();
    broadcastMock.__resetChannels();
    localStorage.clear();
  });

  function manualTick(): void {
    (service as unknown as { handleTick: () => void }).handleTick();
  }

  function snapshot(): SessionSnapshot {
    return service.getSnapshot();
  }

  function idleRemaining(): number {
    return service.idleRemainingMsSignal();
  }

  function countdownRemaining(): number {
    return service.countdownRemainingMsSignal();
  }

  function totalRemaining(): number {
    return service.totalRemainingMsSignal();
  }

  function cooldownRemaining(): number {
    return service.activityCooldownRemainingMsSignal();
  }

  function advanceAndTick(ms: number): void {
    time.advance(ms);
    manualTick();
  }

  async function flushAsync(iterations = 3): Promise<void> {
    for (let index = 0; index < iterations; index += 1) {
      await Promise.resolve();
    }
  }

  function setLatestSharedState(state: SharedSessionState | null): void {
    (service as unknown as { latestSharedState: SharedSessionState | null }).latestSharedState = state;
  }

  function setLastHiddenAt(timestamp: number | null): void {
    (service as unknown as { lastHiddenAt: number | null }).lastHiddenAt = timestamp;
  }

  function resumeVisibility(reason: string): void {
    (service as unknown as { handleVisibilityResume: (reason: string) => void }).handleVisibilityResume(reason);
  }

  function requestLeaderSync(reason: string, options?: { force?: boolean }): void {
    (service as unknown as { requestLeaderSync: (reason: string, options?: { force?: boolean }) => void }).requestLeaderSync(reason, options);
  }



  function buildSharedState(
    overrides?: Partial<Omit<SharedSessionState, 'config' | 'metadata'>> & {
      config?: Partial<SharedSessionState['config']>;
      metadata?: Partial<SharedSessionState['metadata']>;
    }
  ): SharedSessionState {
    const now = time.now();
    const writerId = overrides?.metadata?.writerId ?? 'remote-coord';
    const logicalClock = overrides?.metadata?.logicalClock ?? now;

    const metadata: SharedSessionState['metadata'] = {
      revision: overrides?.metadata?.revision ?? 1,
      logicalClock,
      writerId,
      operation: overrides?.metadata?.operation ?? 'bootstrap',
      causalityToken: overrides?.metadata?.causalityToken ?? writerId + ':' + logicalClock
    };

    const snapshot: SharedSessionState['snapshot'] = overrides?.snapshot ?? {
      state: 'IDLE',
      remainingMs: baseConfig.countdownMs,
      idleStartAt: now,
      countdownEndAt: now + baseConfig.countdownMs,
      lastActivityAt: now,
      paused: false
    };

    const configWriterId = overrides?.config?.writerId ?? writerId;
    const configLogicalClock = overrides?.config?.logicalClock ?? logicalClock;

    const config: SharedSessionState['config'] = {
      idleGraceMs: overrides?.config?.idleGraceMs ?? baseConfig.idleGraceMs,
      countdownMs: overrides?.config?.countdownMs ?? baseConfig.countdownMs,
      warnBeforeMs: overrides?.config?.warnBeforeMs ?? baseConfig.warnBeforeMs,
      activityResetCooldownMs:
        overrides?.config?.activityResetCooldownMs ?? baseConfig.activityResetCooldownMs,
      storageKeyPrefix: overrides?.config?.storageKeyPrefix ?? baseConfig.storageKeyPrefix,
      resumeBehavior: overrides?.config?.resumeBehavior ?? baseConfig.resumeBehavior,
      resetOnWarningActivity:
        overrides?.config?.resetOnWarningActivity ?? baseConfig.resetOnWarningActivity,
      ignoreUserActivityWhenPaused:
        overrides?.config?.ignoreUserActivityWhenPaused ?? baseConfig.ignoreUserActivityWhenPaused,
      allowManualExtendWhenExpired:
        overrides?.config?.allowManualExtendWhenExpired ?? baseConfig.allowManualExtendWhenExpired,
      revision: overrides?.config?.revision ?? 1,
      logicalClock: configLogicalClock,
      writerId: configWriterId
    };

    return {
      version: SHARED_STATE_VERSION,
      updatedAt: overrides?.updatedAt ?? now,
      leader: overrides?.leader ?? null,
      metadata,
      snapshot,
      config
    };
  }

  it('starts in IDLE and enters countdown after idle grace period', () => {
    service.start();
    expect(snapshot().state).toBe('IDLE');

    time.advance(199);
    manualTick();
    expect(snapshot().state).toBe('IDLE');

    time.advance(2);
    manualTick();
    expect(snapshot().state).toBe('COUNTDOWN');
    expect(snapshot().remainingMs).toBeLessThanOrEqual(baseConfig.countdownMs);
  });

  it('enters warn state before expiring', () => {
    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();

    time.advance(baseConfig.countdownMs - baseConfig.warnBeforeMs + 10);
    manualTick();
    expect(snapshot().state).toBe('WARN');
  });

  it('expires when countdown reaches zero', () => {
    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();

    time.advance(baseConfig.countdownMs + 1);
    manualTick();
    expect(snapshot().state).toBe('EXPIRED');
    expect(snapshot().remainingMs).toBe(0);
  });

  it('pause prevents state changes until resumed', () => {
    service.start();
    service.pause();
    time.advance(baseConfig.idleGraceMs + baseConfig.countdownMs + 200);
    manualTick();
    expect(snapshot().state).toBe('IDLE');

    service.resume();
    manualTick();
    expect(snapshot().state).toBe('COUNTDOWN');
  });

  it('auto resumes when server sync occurs in autoOnServerSync mode', () => {
    service.setConfig({ resumeBehavior: 'autoOnServerSync' });
    service.pause();
    expect(service.getSnapshot().paused).toBe(true);

    serverTime.triggerSync();

    expect(service.getSnapshot().paused).toBe(false);
  });

  it('extend refreshes countdown end', () => {
    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();

    time.advance(200);
    manualTick();

    const beforeExtend = snapshot().remainingMs;
    service.extend();
    const afterExtend = snapshot().remainingMs;
    expect(afterExtend).toBeGreaterThan(beforeExtend);
  });

  it('extend resets idle timer when invoked during idle phase', () => {
    service.start();
    expect(snapshot().state).toBe('IDLE');

    time.advance(75);
    manualTick();
    expect(snapshot().state).toBe('IDLE');
    const idleBeforeExtend = snapshot().idleStartAt;

    const extendTimestamp = time.now();
    service.extend();
    const afterExtend = snapshot();

    expect(afterExtend.state).toBe('IDLE');
    expect(afterExtend.countdownEndAt).toBeNull();
    expect(afterExtend.remainingMs).toBe(baseConfig.countdownMs);
    expect(afterExtend.idleStartAt).toBe(extendTimestamp);
    expect(afterExtend.lastActivityAt).toBe(extendTimestamp);
    expect(afterExtend.idleStartAt).not.toBe(idleBeforeExtend);
  });

  it('extend updates idle anchor while refreshing countdown during countdown phase', () => {
    service.start();
    advanceAndTick(baseConfig.idleGraceMs + 1);
    expect(snapshot().state).toBe('COUNTDOWN');

    time.advance(125);
    manualTick();
    const idleBeforeExtend = snapshot().idleStartAt;
    const previousCountdownEndAt = snapshot().countdownEndAt;
    const extendTimestamp = time.now();

    service.extend();
    const afterExtend = snapshot();

    expect(afterExtend.state).toBe('COUNTDOWN');
    expect(afterExtend.remainingMs).toBe(baseConfig.countdownMs);
    expect(previousCountdownEndAt).not.toBeNull();
    expect(afterExtend.countdownEndAt).not.toBeNull();
    expect(afterExtend.countdownEndAt as number).toBeGreaterThan(previousCountdownEndAt as number);
    expect(afterExtend.idleStartAt).toBe(extendTimestamp);
    expect(afterExtend.lastActivityAt).toBe(extendTimestamp);
    expect(afterExtend.idleStartAt).not.toBe(idleBeforeExtend);
  });

  it('only broadcasts auto-extend when the countdown anchor changes', () => {
    service.start();
    publishStateMock.mockClear();

    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();

    const operations = publishStateMock.mock.calls.map(call => {
      const state = call[0] as SharedSessionState;
      return state.metadata.operation;
    });
    expect(operations).toContain('auto-extend');

    publishStateMock.mockClear();
    time.advance(250);
    manualTick();

    expect(publishStateMock).not.toHaveBeenCalled();
  });
  it('resetIdle records HTTP activity metadata', () => {
    const activities: ActivityEvent[] = [];
    const events: Array<{ type: string; meta?: Record<string, unknown> }> = [];

    service.activity$.subscribe(activity => activities.push(activity));
    service.events$.subscribe(event => events.push({ type: event.type, meta: event.meta as Record<string, unknown> | undefined }));

    service.resetIdle({ method: 'GET', url: '/api/ping' }, { source: 'http' });

    expect(activities[0]?.source).toBe('http');
    expect(events[0]?.type).toBe('ResetByActivity');
    expect(events[0]?.meta).toMatchObject({ activitySource: 'http', method: 'GET', url: '/api/ping' });
  });

  it('resets idle on DOM activity events', () => {
    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();
    expect(snapshot().state).toBe('COUNTDOWN');

    domService.emit({ type: 'click' });

    expect(snapshot().state).toBe('IDLE');
    expect(snapshot().remainingMs).toBe(baseConfig.countdownMs);
  });
  it.each(['mousemove', 'keydown', 'scroll'])('resets warn state on %s activity when resetOnWarningActivity is true', eventType => {
    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();
    time.advance(baseConfig.countdownMs - baseConfig.warnBeforeMs + 10);
    manualTick();
    expect(snapshot().state).toBe('WARN');

    domService.emit({ type: eventType });

    expect(snapshot().state).toBe('IDLE');
    expect(snapshot().remainingMs).toBe(baseConfig.countdownMs);
  });

  it.each(['mousemove', 'keydown', 'scroll'])('suppresses %s activity during warn when resetOnWarningActivity is false', eventType => {
    service.setConfig({ resetOnWarningActivity: false });
    const activities: ActivityEvent[] = [];
    service.activity$.subscribe(activity => activities.push(activity));

    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();
    time.advance(baseConfig.countdownMs - baseConfig.warnBeforeMs + 10);
    manualTick();
    expect(snapshot().state).toBe('WARN');
    const idleStartBefore = snapshot().idleStartAt;

    domService.emit({ type: eventType });

    expect(snapshot().state).toBe('WARN');
    expect(snapshot().idleStartAt).toBe(idleStartBefore);
    const lastActivity = activities[activities.length - 1];
    expect(lastActivity?.meta).toMatchObject({
      resetSuppressed: true,
      resetSuppressedReason: 'warning-phase-disabled',
      activitySource: 'dom',
      stateAtActivity: 'WARN'
    });
  });

  it('resets warn state on HTTP activity when resetOnWarningActivity is true', () => {
    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();
    time.advance(baseConfig.countdownMs - baseConfig.warnBeforeMs + 10);
    manualTick();
    expect(snapshot().state).toBe('WARN');

    service.resetIdle({ method: 'GET', url: '/api/keepalive' }, { source: 'http' });

    expect(snapshot().state).toBe('IDLE');
  });

  it('suppresses http-triggered reset during warn when resetOnWarningActivity is false', () => {
    service.setConfig({ resetOnWarningActivity: false });
    const activities: ActivityEvent[] = [];
    const events: Array<{ type: string; meta?: Record<string, unknown> }> = [];
    service.activity$.subscribe(activity => activities.push(activity));
    service.events$.subscribe(event => events.push({ type: event.type, meta: event.meta as Record<string, unknown> | undefined }));

    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();
    time.advance(baseConfig.countdownMs - baseConfig.warnBeforeMs + 10);
    manualTick();
    expect(snapshot().state).toBe('WARN');
    const idleStartBefore = snapshot().idleStartAt;
    const resetEventsBefore = events.length;

    service.resetIdle({ method: 'POST', url: '/api/action' }, { source: 'http' });

    expect(snapshot().state).toBe('WARN');
    expect(snapshot().idleStartAt).toBe(idleStartBefore);
    expect(events.length).toBe(resetEventsBefore);
    const lastActivity = activities[activities.length - 1];
    expect(lastActivity?.meta).toMatchObject({
      resetSuppressed: true,
      resetSuppressedReason: 'warning-phase-disabled',
      activitySource: 'http'
    });
  });

  it('allows manual reset during warn when resetOnWarningActivity is false', () => {
    service.setConfig({ resetOnWarningActivity: false });
    const activities: ActivityEvent[] = [];
    const events: Array<{ type: string; meta?: Record<string, unknown> }> = [];
    service.activity$.subscribe(activity => activities.push(activity));
    service.events$.subscribe(event => events.push({ type: event.type, meta: event.meta as Record<string, unknown> | undefined }));

    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();
    time.advance(baseConfig.countdownMs - baseConfig.warnBeforeMs + 10);
    manualTick();
    expect(snapshot().state).toBe('WARN');

    service.resetIdle();

    expect(snapshot().state).toBe('IDLE');
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe('ResetByActivity');
    expect(lastEvent.meta).toMatchObject({ activitySource: 'manual' });
    const manualActivity = activities[activities.length - 1];
    expect(manualActivity?.source).toBe('manual');
    expect(manualActivity?.meta?.resetSuppressed).toBeUndefined();
  });

  it('allows activity resets after extending when resetOnWarningActivity is false', () => {
    service.setConfig({ resetOnWarningActivity: false });

    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();
    time.advance(baseConfig.countdownMs - baseConfig.warnBeforeMs + 10);
    manualTick();
    expect(snapshot().state).toBe('WARN');

    service.extend();
    manualTick();

    expect(snapshot().state).toBe('COUNTDOWN');

    domService.emit({ type: 'click' });

    expect(snapshot().state).toBe('IDLE');
    expect(snapshot().remainingMs).toBe(baseConfig.countdownMs);
  });

  it('gives manual reset priority over lower-priority activity', () => {
    jest.useFakeTimers();
    try {
      service.setConfig({
        actionDelays: {
          ...baseConfig.actionDelays,
          resetIdle: 25
        }
      });

      service.start();
      time.advance(baseConfig.idleGraceMs + 1);
      manualTick();
      time.advance(baseConfig.countdownMs - baseConfig.warnBeforeMs + 10);
      manualTick();
      expect(snapshot().state).toBe('WARN');

      const activities: ActivityEvent[] = [];
      service.activity$.subscribe(activity => activities.push(activity));

      service.resetIdle(undefined, { source: 'manual' });
      domService.emit({ type: 'click' });

      const suppressed = activities[activities.length - 1];
      expect(suppressed?.meta).toMatchObject({
        resetSuppressed: true,
        resetSuppressedReason: 'lower-priority',
        activitySource: 'dom'
      });

      jest.advanceTimersByTime(25);
      manualTick();

      expect(snapshot().state).toBe('IDLE');
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores DOM activity while paused when configured to do so', () => {
    service.start();
    service.pause();
    service.setConfig({ ignoreUserActivityWhenPaused: true });
    const before = snapshot();

    domService.emit({ type: 'mousemove' });

    const after = snapshot();
    expect(after.idleStartAt).toBe(before.idleStartAt);
    expect(after.remainingMs).toBe(before.remainingMs);
  });

  it('exposes separate phase signals for idle, countdown, and total remaining time', () => {
    service.start();

    expect(idleRemaining()).toBe(baseConfig.idleGraceMs);
    expect(countdownRemaining()).toBe(baseConfig.countdownMs);
    expect(totalRemaining()).toBe(baseConfig.idleGraceMs + baseConfig.countdownMs);
    expect(cooldownRemaining()).toBe(0);

    time.advance(100);
    manualTick();

    expect(idleRemaining()).toBe(baseConfig.idleGraceMs - 100);
    expect(countdownRemaining()).toBe(baseConfig.countdownMs);
    expect(totalRemaining()).toBe((baseConfig.idleGraceMs - 100) + baseConfig.countdownMs);

    time.advance(baseConfig.idleGraceMs - 100 + 1);
    manualTick();

    expect(snapshot().state).toBe('COUNTDOWN');
    expect(idleRemaining()).toBe(0);
    expect(countdownRemaining()).toBe(baseConfig.countdownMs);
    expect(totalRemaining()).toBe(baseConfig.countdownMs);
  });

  it('tracks activity cooldown remaining and suppresses resets within the window', () => {
    service.setConfig({ activityResetCooldownMs: 5000 });
    service.start();

    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();

    domService.emit({ type: 'click' });

    expect(idleRemaining()).toBe(baseConfig.idleGraceMs);
    expect(countdownRemaining()).toBe(baseConfig.countdownMs);
    expect(cooldownRemaining()).toBe(5000);

    const resetIdleStart = snapshot().idleStartAt;

    time.advance(2000);
    manualTick();
    expect(cooldownRemaining()).toBe(3000);

    domService.emit({ type: 'mousemove' });

    expect(snapshot().idleStartAt).toBe(resetIdleStart);
    expect(cooldownRemaining()).toBe(3000);

    time.advance(3000);
    manualTick();
    expect(cooldownRemaining()).toBe(0);

    domService.emit({ type: 'scroll' });

    expect(idleRemaining()).toBe(baseConfig.idleGraceMs);
    expect(countdownRemaining()).toBe(baseConfig.countdownMs);
    expect(cooldownRemaining()).toBe(5000);
  });

  it('reconfigures phase signals without requiring a restart', () => {
    service.start();

    service.setConfig({ idleGraceMs: 400, countdownMs: 1200, activityResetCooldownMs: 2000 });

    expect(idleRemaining()).toBe(400);
    expect(countdownRemaining()).toBe(1200);
    expect(totalRemaining()).toBe(1600);
    expect(cooldownRemaining()).toBe(0);
  });

  it('emits config-change shared-state metadata when shared config values update', () => {
    publishStateMock.mockClear();

    service.setConfig({ activityResetCooldownMs: 6000 });

    const operations = publishStateMock.mock.calls.map(call => {
      const state = call[0] as SharedSessionState;
      return state.metadata.operation;
    });
    expect(operations).toContain('config-change');
  });


  it('does not broadcast shared state for config changes that only affect local behavior', () => {
    publishStateMock.mockClear();

    service.setConfig({ pollingMs: baseConfig.pollingMs + 25 });

    expect(publishStateMock).not.toHaveBeenCalled();
  });


  it('keeps remaining time observables in sync with signals', fakeAsync(() => {
    service.setConfig({ activityResetCooldownMs: 1000 });
    flushMicrotasks();

    const idle$: Observable<number> = service.idleRemainingMs$;
    const countdown$: Observable<number> = service.countdownRemainingMs$;
    const total$: Observable<number> = service.totalRemainingMs$;
    const cooldown$: Observable<number> = service.activityCooldownRemainingMs$;

    const idleFrom$ = injector.runInContext(() =>
      toSignal(idle$, { initialValue: service.idleRemainingMsSignal() })
    );
    const countdownFrom$ = injector.runInContext(() =>
      toSignal(countdown$, { initialValue: service.countdownRemainingMsSignal() })
    );
    const totalFrom$ = injector.runInContext(() =>
      toSignal(total$, { initialValue: service.totalRemainingMsSignal() })
    );
    const cooldownFrom$ = injector.runInContext(() =>
      toSignal(cooldown$, { initialValue: service.activityCooldownRemainingMsSignal() })
    );

    const assertParity = () => {
      expect(idleFrom$()).toBe(service.idleRemainingMsSignal());
      expect(countdownFrom$()).toBe(service.countdownRemainingMsSignal());
      expect(totalFrom$()).toBe(service.totalRemainingMsSignal());
      expect(cooldownFrom$()).toBe(service.activityCooldownRemainingMsSignal());
    };

    assertParity();

    service.start();
    flushMicrotasks();
    assertParity();

    advanceAndTick(100);
    flushMicrotasks();
    assertParity();

    domService.emit({ type: 'click' });
    flushMicrotasks();
    assertParity();

    advanceAndTick(500);
    flushMicrotasks();
    assertParity();

    advanceAndTick(600);
    flushMicrotasks();
    assertParity();

    service.stop();
    flushMicrotasks();
    discardPeriodicTasks();
  }));

  it('syncs warn and expired observables with their signal counterparts', fakeAsync(() => {
    const warn$: Observable<boolean> = service.isWarn$;
    const expired$: Observable<boolean> = service.isExpired$;

    const warnFrom$ = injector.runInContext(() =>
      toSignal(warn$, { initialValue: service.isWarnSignal() })
    );
    const expiredFrom$ = injector.runInContext(() =>
      toSignal(expired$, { initialValue: service.isExpiredSignal() })
    );

    const assertParity = () => {
      expect(warnFrom$()).toBe(service.isWarnSignal());
      expect(expiredFrom$()).toBe(service.isExpiredSignal());
    };

    assertParity();

    service.start();
    flushMicrotasks();
    assertParity();

    advanceAndTick(baseConfig.idleGraceMs + 1);
    flushMicrotasks();
    assertParity();

    advanceAndTick(baseConfig.countdownMs - baseConfig.warnBeforeMs + 1);
    flushMicrotasks();
    assertParity();

    advanceAndTick(baseConfig.warnBeforeMs + 5);
    flushMicrotasks();
    assertParity();

    service.stop();
    flushMicrotasks();
    discardPeriodicTasks();
  }));

  it('throttles DOM activity resets using activityResetCooldownMs', () => {
    service.setConfig({ activityResetCooldownMs: 5000 });
    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();
    expect(snapshot().state).toBe('COUNTDOWN');

    domService.emit({ type: 'click' });

    const firstActivityCandidate = snapshot().lastActivityAt;
    expect(firstActivityCandidate).not.toBeNull();
    if (firstActivityCandidate == null) {
      throw new Error('Expected lastActivityAt after DOM activity');
    }
    const firstActivity = firstActivityCandidate;

    time.advance(1000);
    domService.emit({ type: 'mousemove' });

    expect(snapshot().lastActivityAt).toBe(firstActivity);

    time.advance(5000);
    domService.emit({ type: 'scroll' });

    const thirdActivityCandidate = snapshot().lastActivityAt;
    expect(thirdActivityCandidate).not.toBeNull();
    if (thirdActivityCandidate == null) {
      throw new Error('Expected lastActivityAt after cooldown elapsed');
    }
    expect(thirdActivityCandidate).toBeGreaterThan(firstActivity);
  });

  it('restores persisted countdown state across instances', () => {
    service.start();
    time.advance(baseConfig.idleGraceMs + 1);
    manualTick();
    time.advance(200);
    manualTick();

    const persistedRaw = localStorage.getItem(`${baseConfig.storageKeyPrefix}:snapshot`);
    expect(persistedRaw).not.toBeNull();
    const persistedSnapshot = JSON.parse(persistedRaw!);
    const targetNow = (persistedSnapshot.countdownEndAt as number) - (baseConfig.warnBeforeMs - 50);

    TestBed.resetTestingModule();

    const newDomService = new StubActivityDomService();
    const newRouterService = new StubActivityRouterService();
    const newServerTime = new StubServerTimeService();

    TestBed.configureTestingModule({
      providers: [
        SessionTimeoutService,
        {
          provide: TimeSourceService,
          useFactory: () => {
            const instance = new MockTimeSourceService();
            instance.setNow(targetNow);
            return instance;
          }
        },
        { provide: SESSION_TIMEOUT_CONFIG, useValue: baseConfig },
        { provide: ActivityDomService, useValue: newDomService },
        { provide: ActivityRouterService, useValue: newRouterService },
        { provide: ServerTimeService, useValue: newServerTime }
      ]
    });




    const restoredService = TestBed.inject(SessionTimeoutService);
    const restoredSnapshot = restoredService.getSnapshot();

    expect(['COUNTDOWN', 'WARN', 'EXPIRED']).toContain(restoredSnapshot.state);
    if (restoredSnapshot.state === 'WARN') {
      expect(restoredSnapshot.remainingMs).toBeLessThanOrEqual(baseConfig.warnBeforeMs);
    }
  });


  it('requests leader sync when no leader is known on init', () => {
    const reasons = requestSyncMock.mock.calls.map(call => call[0]);
    expect(reasons).toContain('leader-missing');
  });

  it('requests sync and notifies followers when stepping down from leadership', async () => {
    const messages: CrossTabMessage[] = [];
    service.crossTab$.subscribe(message => messages.push(message));

    await flushAsync();
    leaderElection.electLeader();
    await flushAsync();
    requestSyncMock.mockClear();
    messages.length = 0;

    leaderElection.stepDown();
    await flushAsync();

    expect(requestSyncMock).toHaveBeenCalledWith('leader-changed');
    expect(messages.some(message => message.type === 'sync-request')).toBe(true);
  });

  it('requests sync when visibility resumes after extended hidden period', async () => {
    await flushAsync();
    leaderElection.assumeLeader('remote-tab');
    const remoteState = buildSharedState({
      leader: { id: 'remote-tab', heartbeatAt: time.now() - (LEADER_TTL_MS + 50), epoch: 3 }
    });
    setLatestSharedState(remoteState);
    setLastHiddenAt(time.now() - (LEADER_TTL_MS + 10));

    requestSyncMock.mockClear();
    resumeVisibility('visibilitychange');

    expect(requestSyncMock).toHaveBeenCalledWith('visibilitychange');
  });

  it('throttles leader sync requests when not forced', async () => {
    const outbound: CrossTabMessage[] = [];
    service.crossTab$.subscribe(message => outbound.push(message));

    await flushAsync();
    requestSyncMock.mockClear();
    outbound.length = 0;

    time.advance(HEARTBEAT_INTERVAL_MS + 1);
    requestLeaderSync('manual-first');
    expect(requestSyncMock).toHaveBeenCalledWith('manual-first');
    const firstSyncRequest = outbound.find(message => message.type === 'sync-request');
    expect(firstSyncRequest).toBeDefined();

    requestSyncMock.mockClear();
    outbound.length = 0;

    requestLeaderSync('manual-repeat');
    expect(requestSyncMock).not.toHaveBeenCalled();
    expect(outbound.length).toBe(0);

    time.advance(HEARTBEAT_INTERVAL_MS + 1);
    requestLeaderSync('manual-after-wait');
    expect(requestSyncMock).toHaveBeenCalledWith('manual-after-wait');
  });

  it('increments leader epoch when taking leadership after remote shared state', async () => {
    await flushAsync();
    leaderElection.assumeLeader('remote-tab');
    const remoteState = buildSharedState({
      leader: { id: 'remote-tab', heartbeatAt: time.now(), epoch: 4 }
    });
    sharedCoordinator.emit({
      type: 'state',
      sourceId: 'remote-tab',
      at: time.now(),
      state: remoteState
    });

    await flushAsync();
    publishStateMock.mockClear();

    leaderElection.stepDown();
    await flushAsync();
    leaderElection.electLeader();
    await flushAsync();

    const leaderStates = publishStateMock.mock.calls
      .map(call => call[0] as SharedSessionState)
      .filter(state => state.leader?.id === leaderElection.tabId);

    expect(leaderStates.length).toBeGreaterThan(0);
    expect(leaderStates.pop()?.leader?.epoch).toBe(5);
  });

});

describe('SessionTimeoutService provider bootstrap', () => {
  let broadcastMock: BroadcastMockModule;

  beforeEach(() => {
    broadcastMock = jest.requireMock('../utils/broadcast-channel') as BroadcastMockModule;
    broadcastMock.__resetChannels();
    localStorage.clear();
  });

  afterEach(() => {
    broadcastMock.__resetChannels();
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('applies partial config from providers without calling setConfig()', () => {
    const partial: SessionTimeoutPartialConfig = {
      storageKeyPrefix: 'app-session',
      idleGraceMs: 60_000,
      countdownMs: 300_000,
      warnBeforeMs: 60_000,
      resumeBehavior: 'autoOnServerSync'
    };

    const domService = new StubActivityDomService();
    const routerService = new StubActivityRouterService();
    const serverTime = new StubServerTimeService();

    TestBed.configureTestingModule({
      providers: [
        ...createSessionTimeoutProviders(partial),
        { provide: TimeSourceService, useClass: MockTimeSourceService },
        { provide: SharedStateCoordinatorService, useClass: SharedStateCoordinatorStub },
        { provide: ActivityDomService, useValue: domService },
        { provide: ActivityRouterService, useValue: routerService },
        { provide: ServerTimeService, useValue: serverTime },
        { provide: LeaderElectionService, useClass: StubLeaderElectionService }
      ]
    });

    const configuredService = TestBed.inject(SessionTimeoutService);
    const config = configuredService.getConfig();

    expect(config.storageKeyPrefix).toBe('app-session');
    expect(config.idleGraceMs).toBe(60_000);
    expect(config.countdownMs).toBe(300_000);
    expect(config.warnBeforeMs).toBe(60_000);
    expect(config.resumeBehavior).toBe('autoOnServerSync');
  });
});







