import { EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import type { ActivityEvent } from '../models/activity-event';
import type { SessionSnapshot } from '../models/session-state';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';
import { SessionTimeoutService } from './session-timeout.service';
import { TimeSourceService } from './time-source.service';
import { ActivityDomService } from './activity-dom.service';
import { ActivityRouterService } from './activity-router.service';
import { ServerTimeService } from './server-time.service';

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

describe('SessionTimeoutService', () => {
  let injector: EnvironmentInjector;
  let service: SessionTimeoutService;
  let time: MockTimeSourceService;
  let domService: StubActivityDomService;
  let routerService: StubActivityRouterService;
  let serverTime: StubServerTimeService;
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
    ignoreUserActivityWhenPaused: false,
    allowManualExtendWhenExpired: false,
    resumeBehavior: 'manual'
  };

  beforeEach(() => {
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
        { provide: ServerTimeService, useValue: serverTime }
      ]
    });

    injector = TestBed.inject(EnvironmentInjector);
    service = TestBed.inject(SessionTimeoutService);
    time = TestBed.inject(TimeSourceService) as unknown as MockTimeSourceService;
  });

  afterEach(() => {
    localStorage.clear();
  });

  function manualTick(): void {
    (service as unknown as { handleTick: () => void }).handleTick();
  }

  function snapshot(): SessionSnapshot {
    return service.getSnapshot();
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
});







