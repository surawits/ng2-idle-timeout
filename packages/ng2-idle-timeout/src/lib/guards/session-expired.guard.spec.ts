import { EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

import { SessionExpiredGuard, SESSION_TIMEOUT_ROUTE_KEY, type SessionTimeoutRouteConfig } from './session-expired.guard';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import type { SessionSnapshot, SessionState } from '../models/session-state';
import { SessionTimeoutService } from '../services/session-timeout.service';

class MockSessionTimeoutService {
  snapshot: SessionSnapshot = {
    state: 'IDLE',
    remainingMs: 1000,
    warnBeforeMs: 100,
    countdownMs: 1000,
    idleGraceMs: 200,
    idleStartAt: null,
    countdownEndAt: null,
    lastActivityAt: null,
    paused: false
  };
  setConfig = jest.fn();
  resume = jest.fn();

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }
}

describe('SessionExpiredGuard', () => {
  let service: MockSessionTimeoutService;
  let injector: EnvironmentInjector;
  let routerState: RouterStateSnapshot;

  beforeEach(() => {
    service = new MockSessionTimeoutService();
    routerState = {} as RouterStateSnapshot;

    TestBed.configureTestingModule({
      providers: [{ provide: SessionTimeoutService, useValue: service }]
    });

    injector = TestBed.inject(EnvironmentInjector);
  });

  function runGuard(routeData?: Record<string, unknown>): boolean {
    const route = new ActivatedRouteSnapshot();
    route.data = routeData ?? {};
    let result = false;
    injector.runInContext(() => {
      result = SessionExpiredGuard(route, routerState) as boolean;
    });
    return result;
  }

  it('blocks navigation when session is expired by default', () => {
    service.snapshot = { ...service.snapshot, state: 'EXPIRED' as SessionState };
    expect(runGuard()).toBe(false);
  });

  it('allows navigation when override permits expired sessions', () => {
    service.snapshot = { ...service.snapshot, state: 'EXPIRED' as SessionState };
    const override: SessionTimeoutRouteConfig = { allowWhenExpired: true };
    expect(runGuard({ [SESSION_TIMEOUT_ROUTE_KEY]: override })).toBe(true);
  });

  it('applies configuration overrides when provided', () => {
    const override: SessionTimeoutRouteConfig = {
      config: { countdownMs: 500 } as Partial<SessionTimeoutConfig>
    };
    runGuard({ [SESSION_TIMEOUT_ROUTE_KEY]: override });
    expect(service.setConfig).toHaveBeenCalledWith(override.config);
  });

  it('resumes the session when autoResume is set and snapshot is paused', () => {
    service.snapshot = { ...service.snapshot, paused: true };
    const override: SessionTimeoutRouteConfig = { autoResume: true };
    runGuard({ [SESSION_TIMEOUT_ROUTE_KEY]: override });
    expect(service.resume).toHaveBeenCalled();
  });
});
