import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { SessionSnapshot } from '../models/session-state';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';
import { SessionTimeoutService } from './session-timeout.service';
import { TimeSourceService } from './time-source.service';
import type { ActivityEvent } from '../models/activity-event';
import { ActivityDomService } from './activity-dom.service';
import { ActivityRouterService } from './activity-router.service';

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

describe('SessionTimeoutService', () => {
  let service: SessionTimeoutService;
  let time: MockTimeSourceService;
  let domService: StubActivityDomService;
  let routerService: StubActivityRouterService;
  const baseConfig: SessionTimeoutConfig = {
    idleGraceMs: 200,
    countdownMs: 1000,
    warnBeforeMs: 300,
    pollingMs: 50,
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
    openNewTabBehavior: 'inherit',
    routerCountsAsActivity: true,
    debounceMouseMs: 800,
    debounceKeyMs: 200,
    maxExtendPerSession: 0,
    onExpire: 'emit',
    timeSource: 'client',
    serverTimeEndpoint: undefined,
    logging: 'silent',
    ignoreUserActivityWhenPaused: false,
    allowManualExtendWhenExpired: false
  };

  beforeEach(() => {
    domService = new StubActivityDomService();
    routerService = new StubActivityRouterService();
    TestBed.configureTestingModule({
      providers: [
        SessionTimeoutService,
        { provide: TimeSourceService, useClass: MockTimeSourceService },
        { provide: SESSION_TIMEOUT_CONFIG, useValue: baseConfig },
        { provide: ActivityDomService, useValue: domService },
        { provide: ActivityRouterService, useValue: routerService }
      ]
    });
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
        { provide: ActivityRouterService, useValue: newRouterService }
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
