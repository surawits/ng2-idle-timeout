import { HttpClient } from '@angular/common/http';
import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ServerTimeService } from './server-time.service';
import { TimeSourceService } from './time-source.service';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';

const baseConfig: SessionTimeoutConfig = {
  idleGraceMs: 200,
  countdownMs: 1000,
  warnBeforeMs: 300,
  pollingMs: 50,
  activityResetCooldownMs: 0,
  storageKeyPrefix: 'test',
  appInstanceId: 'testApp',
  syncMode: 'leader',
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
  allowManualExtendWhenExpired: false
};

describe('ServerTimeService', () => {
  let service: ServerTimeService;
  let httpClient: { get: jest.Mock };
  let timeSource: { setOffset: jest.Mock; resetOffset: jest.Mock };

  beforeEach(() => {
    httpClient = { get: jest.fn() };
    timeSource = {
      setOffset: jest.fn(),
      resetOffset: jest.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        ServerTimeService,
        { provide: HttpClient, useValue: httpClient },
        { provide: TimeSourceService, useValue: timeSource },
        { provide: NgZone, useFactory: () => new NgZone({ enableLongStackTrace: false }) }
      ]
    });

    service = TestBed.inject(ServerTimeService);
  });

  afterEach(() => {
    service?.stop(true);
    jest.restoreAllMocks();
  });

  it('resets offset when configured for client time', () => {
    service.configure(baseConfig);
    expect(timeSource.resetOffset).toHaveBeenCalled();
  });

  it('fetches server time and applies offset when configured', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000);
    nowSpy.mockReturnValueOnce(1_500);

    httpClient.get.mockReturnValue(of({ epochMs: 4_000 }));

    service.configure({
      ...baseConfig,
      timeSource: 'server',
      serverTimeEndpoint: '/api/time'
    });

    expect(httpClient.get).toHaveBeenCalledWith('/api/time');
    expect(timeSource.setOffset).toHaveBeenCalledWith(2_750);

    nowSpy.mockRestore();
  });
  it('notifies sync listeners on successful fetch', () => {
    const listener = jest.fn();
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000);
    nowSpy.mockReturnValueOnce(1_500);

    httpClient.get.mockReturnValue(of({ epochMs: 4_000 }));
    service.registerSyncListener(listener);

    service.configure({
      ...baseConfig,
      timeSource: 'server',
      serverTimeEndpoint: '/api/time'
    });

    expect(listener).toHaveBeenCalledTimes(1);

    service.unregisterSyncListener(listener);
    nowSpy.mockRestore();
  });

  it('applies retry backoff on failure and recovers on success', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const internal = service as unknown as { fetchServerOffset: () => void };

    httpClient.get
      .mockReturnValueOnce(throwError(() => new Error('fail')))
      .mockReturnValueOnce(of({ epochMs: 3_000 }))
      .mockReturnValue(of({ epochMs: 3_500 }));

    service.configure({
      ...baseConfig,
      timeSource: 'server',
      serverTimeEndpoint: '/api/time',
      pollingMs: 120_000
    });

    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2_000);

    internal.fetchServerOffset();
    expect(httpClient.get).toHaveBeenCalledTimes(2);

    nowSpy.mockReturnValueOnce(1_500);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 120_000);

    internal.fetchServerOffset();
    expect(httpClient.get).toHaveBeenCalledTimes(3);

    setTimeoutSpy.mockRestore();
    nowSpy.mockRestore();
  });

  it('stops syncing and clears offset when stopped', () => {
    const internal = service as unknown as { fetchServerOffset: () => void };
    httpClient.get.mockReturnValue(of(5_000));

    service.configure({
      ...baseConfig,
      timeSource: 'server',
      serverTimeEndpoint: '/api/time'
    });

    service.stop(true);
    internal.fetchServerOffset();

    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(timeSource.resetOffset).toHaveBeenCalled();
  });
});


