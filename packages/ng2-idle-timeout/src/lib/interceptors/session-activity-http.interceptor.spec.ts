import { DOCUMENT } from '@angular/common';
import { HttpContext, HttpHeaders, HttpRequest as AngularHttpRequest } from '@angular/common/http';
import type { HttpEvent, HttpHandler, HttpRequest } from '@angular/common/http';
import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';

import { SessionActivityHttpInterceptor } from './session-activity-http.interceptor';
import { getSessionActivityContextToken } from './session-activity-http.context';
import { LeaderElectionService } from '../services/leader-election.service';
import { SessionTimeoutService } from '../services/session-timeout.service';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';

class MockHttpHandler implements HttpHandler {
  handle = jest.fn(() => of({} as HttpEvent<unknown>));
}

describe('SessionActivityHttpInterceptor', () => {
  let interceptor: SessionActivityHttpInterceptor;
  let sessionTimeout: { getConfig: jest.Mock; resetIdle: jest.Mock };
  let leaderElection: { isLeader: jest.Mock };
  let handler: MockHttpHandler;
  let documentMock: Document;
  let createInterceptor: () => SessionActivityHttpInterceptor;

  const baseConfig: SessionTimeoutConfig = {
    idleGraceMs: 200,
    countdownMs: 1000,
    warnBeforeMs: 300,
    pollingMs: 50,
    activityResetCooldownMs: 0,
    storageKeyPrefix: 'test',
    appInstanceId: 'testApp',
    strategy: 'userAndHttpAllowlist',
    httpActivity: {
      enabled: true,
      strategy: 'allowlist',
      allowlist: [/\/keepalive/],
      denylist: [],
      headerFlag: undefined,
      contextToken: undefined,
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
    allowManualExtendWhenExpired: false
  };

  function createRequest(
    url: string,
    init?: { headers?: Record<string, string>; context?: HttpContext }
  ): HttpRequest<unknown> {
    const options: {
      headers?: HttpHeaders;
      context?: HttpContext;
    } = {};
    if (init?.headers) {
      options.headers = new HttpHeaders(init.headers);
    }
    if (init?.context) {
      options.context = init.context;
    }
    return new AngularHttpRequest('GET', url, options);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    sessionTimeout = {
      getConfig: jest.fn().mockReturnValue(baseConfig),
      resetIdle: jest.fn()
    };

    leaderElection = {
      isLeader: jest.fn().mockReturnValue(true)
    };

    documentMock = {
      visibilityState: 'visible',
      hasFocus: jest.fn().mockReturnValue(true),
      querySelectorAll: jest.fn().mockReturnValue([])
    } as unknown as Document;

    handler = new MockHttpHandler();

    TestBed.configureTestingModule({
      providers: [
        { provide: SessionTimeoutService, useValue: sessionTimeout },
        { provide: LeaderElectionService, useValue: leaderElection },
        { provide: DOCUMENT, useValue: documentMock }
      ]
    });

    createInterceptor = () => TestBed.runInInjectionContext(() => new SessionActivityHttpInterceptor());
    interceptor = createInterceptor();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing when HTTP activity is disabled', () => {
    sessionTimeout.getConfig.mockReturnValue({
      ...baseConfig,
      httpActivity: { ...baseConfig.httpActivity, enabled: false }
    });

    interceptor.intercept(createRequest('/keepalive'), handler);

    expect(sessionTimeout.resetIdle).not.toHaveBeenCalled();
    expect(handler.handle).toHaveBeenCalled();
  });

  it('resets idle when allowlist matches the URL', () => {
    interceptor.intercept(createRequest('https://example.com/api/keepalive'), handler);

    expect(sessionTimeout.resetIdle).toHaveBeenCalledTimes(1);
    expect(sessionTimeout.resetIdle).toHaveBeenCalledWith(
      { method: 'GET', url: 'https://example.com/api/keepalive', strategy: 'allowlist' },
      { source: 'http' }
    );
  });

  it('skips when URL is denylisted', () => {
    sessionTimeout.getConfig.mockReturnValue({
      ...baseConfig,
      httpActivity: {
        ...baseConfig.httpActivity,
        denylist: [/\/keepalive/]
      }
    });

    interceptor.intercept(createRequest('https://example.com/api/keepalive'), handler);

    expect(sessionTimeout.resetIdle).not.toHaveBeenCalled();
  });

  it('resets idle when header flag is present', () => {
    sessionTimeout.getConfig.mockReturnValue({
      ...baseConfig,
      httpActivity: {
        ...baseConfig.httpActivity,
        strategy: 'headerFlag',
        headerFlag: 'X-Session-Activity'
      }
    });

    interceptor.intercept(
      createRequest('https://example.com/api/resource', {
        headers: { 'X-Session-Activity': 'true' }
      }),
      handler
    );

    expect(sessionTimeout.resetIdle).toHaveBeenCalledWith(
      { method: 'GET', url: 'https://example.com/api/resource', strategy: 'headerFlag' },
      { source: 'http' }
    );
  });

  it('skips when header flag value is falsey', () => {
    sessionTimeout.getConfig.mockReturnValue({
      ...baseConfig,
      httpActivity: {
        ...baseConfig.httpActivity,
        strategy: 'headerFlag',
        headerFlag: 'X-Session-Activity'
      }
    });

    interceptor.intercept(
      createRequest('https://example.com/api/resource', {
        headers: { 'X-Session-Activity': 'false' }
      }),
      handler
    );

    expect(sessionTimeout.resetIdle).not.toHaveBeenCalled();
  });

  it('uses context token when header is absent', () => {
    const tokenName = 'session';
    const context = new HttpContext().set(getSessionActivityContextToken(tokenName), true);

    sessionTimeout.getConfig.mockReturnValue({
      ...baseConfig,
      httpActivity: {
        ...baseConfig.httpActivity,
        strategy: 'headerFlag',
        contextToken: tokenName
      }
    });

    interceptor.intercept(
      createRequest('https://example.com/api/context', { context }),
      handler
    );

    expect(sessionTimeout.resetIdle).toHaveBeenCalledWith(
      { method: 'GET', url: 'https://example.com/api/context', strategy: 'headerFlag' },
      { source: 'http' }
    );
  });

  it('enforces cooldown windows between successive activity resets', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(5_000);
    interceptor = createInterceptor();

    sessionTimeout.getConfig.mockReturnValue({
      ...baseConfig,
      httpActivity: {
        ...baseConfig.httpActivity,
        strategy: 'headerFlag',
        headerFlag: 'X-Session-Activity',
        cooldownMs: 1_000
      }
    });

    const request = createRequest('https://example.com/api/ping', {
      headers: { 'X-Session-Activity': '1' }
    });

    nowSpy.mockReturnValue(6_000);
    interceptor.intercept(request, handler);
    expect(sessionTimeout.resetIdle).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(6_500);
    interceptor.intercept(request, handler);
    expect(sessionTimeout.resetIdle).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(7_100);
    interceptor.intercept(request, handler);
    expect(sessionTimeout.resetIdle).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('treats aggressive strategy as activity unless denylisted', () => {
    sessionTimeout.getConfig.mockReturnValue({
      ...baseConfig,
      httpActivity: {
        ...baseConfig.httpActivity,
        strategy: 'aggressive'
      }
    });

    interceptor.intercept(createRequest('https://example.com/api/data'), handler);

    expect(sessionTimeout.resetIdle).toHaveBeenCalledWith(
      { method: 'GET', url: 'https://example.com/api/data', strategy: 'aggressive' },
      { source: 'http' }
    );
  });
});

