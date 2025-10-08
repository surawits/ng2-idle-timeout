import { TestBed } from '@angular/core/testing';

import { APP_INITIALIZER, ApplicationInitStatus } from '@angular/core';
import { Subject } from 'rxjs';

import { SessionTimeoutService } from './services/session-timeout.service';
import { TimeSourceService } from './services/time-source.service';
import { SharedStateCoordinatorService } from './services/shared-state-coordinator.service';
import { createSessionTimeoutProviders, provideSessionTimeout } from './provide-session-timeout';
import type { SessionTimeoutConfig } from './models/session-timeout-config';
import type { SharedSessionState, SharedStateMessage } from './models/session-shared-state';

class StubTimeSourceService {
  private nowValue = Date.now();

  now(): number {
    return this.nowValue;
  }

  advance(ms: number): void {
    this.nowValue += ms;
  }

  setOffset(): void {
    // noop for tests
  }

  resetOffset(): void {
    // noop for tests
  }
}

class StubSharedStateCoordinatorService {
  private currentConfig: SessionTimeoutConfig | null = null;
  private readonly updatesSubject = new Subject<SharedStateMessage>();
  readonly updates$ = this.updatesSubject.asObservable();

  updateConfig(config: SessionTimeoutConfig): void {
    this.currentConfig = config;
  }

  publishState(_state: SharedSessionState, _options?: unknown): void {
    // noop for tests
  }

  requestSync(_reason?: string, _expectReply?: boolean): void {
    // noop for tests
  }

  readPersistedState(): SharedSessionState | null {
    return null;
  }

  clearPersistedState(): void {
    // noop for tests
  }

  getSourceId(): string {
    return 'stub-source';
  }

  getConfig(): SessionTimeoutConfig | null {
    return this.currentConfig;
  }

  emit(_message: SharedStateMessage): void {
    this.updatesSubject.next(_message);
  }
}

describe('createSessionTimeoutProviders', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ...createSessionTimeoutProviders({
          storageKeyPrefix: 'spec-app',
          idleGraceMs: 1000,
          countdownMs: 15000,
          warnBeforeMs: 5000,
          syncMode: 'leader'
        }),
        { provide: TimeSourceService, useClass: StubTimeSourceService },
        { provide: SharedStateCoordinatorService, useClass: StubSharedStateCoordinatorService }
      ]
    });
  });

  it('applies provided config during root injector construction', () => {
    const service = TestBed.inject(SessionTimeoutService);
    const coordinator = TestBed.inject(SharedStateCoordinatorService) as unknown as StubSharedStateCoordinatorService;

    const config = service.getConfig();
    expect(config.storageKeyPrefix).toBe('spec-app');
    expect(config.countdownMs).toBe(15000);
    expect(config.idleGraceMs).toBe(1000);
    expect(coordinator.getConfig()?.storageKeyPrefix).toBe('spec-app');
  });
});

describe('provideSessionTimeout in NgModule providers', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideSessionTimeout(() => ({
          storageKeyPrefix: 'ngmodule-app',
          idleGraceMs: 2000,
          countdownMs: 42000,
          warnBeforeMs: 7000,
          syncMode: 'distributed'
        })),
        { provide: TimeSourceService, useClass: StubTimeSourceService },
        { provide: SharedStateCoordinatorService, useClass: StubSharedStateCoordinatorService }
      ]
    });
  });

  it('applies provided config when used via NgModule providers array', () => {
    const service = TestBed.inject(SessionTimeoutService);
    const config = service.getConfig();

    expect(config.storageKeyPrefix).toBe('ngmodule-app');
    expect(config.countdownMs).toBe(42000);
    expect(config.idleGraceMs).toBe(2000);
    expect(config.syncMode).toBe('distributed');
  });
});

describe('APP_INITIALIZER ordering', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('exposes configured values during initialization', async () => {
    let configAtInit: SessionTimeoutConfig | null = null;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: APP_INITIALIZER,
          multi: true,
          useFactory: (service: SessionTimeoutService) => () => {
            configAtInit = service.getConfig();
          },
          deps: [SessionTimeoutService]
        },
        ...createSessionTimeoutProviders({
          storageKeyPrefix: 'initializer-app',
          idleGraceMs: 3000,
          countdownMs: 18000,
          warnBeforeMs: 6000,
          syncMode: 'leader'
        }),
        { provide: TimeSourceService, useClass: StubTimeSourceService },
        { provide: SharedStateCoordinatorService, useClass: StubSharedStateCoordinatorService }
      ]
    });

    await TestBed.inject(ApplicationInitStatus).donePromise;

    const config = configAtInit as SessionTimeoutConfig | null;
    expect(config?.storageKeyPrefix).toBe('initializer-app');
    expect(config?.countdownMs).toBe(18000);
  });
});
