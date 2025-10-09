import { TestBed } from '@angular/core/testing';

import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';
import { LeaderElectionService } from './leader-election.service';

const HEARTBEAT_INTERVAL_MS = 1500;
const LEADER_KEY = 'testApp:test:leader';

describe('LeaderElectionService', () => {
  let service: LeaderElectionService;
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
    allowManualExtendWhenExpired: false
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        LeaderElectionService,
        { provide: SESSION_TIMEOUT_CONFIG, useValue: baseConfig }
      ]
    });

    service = TestBed.inject(LeaderElectionService);
  });

  afterEach(() => {
    service.stepDown();
    TestBed.resetTestingModule();
    jest.useRealTimers();
    localStorage.clear();
  });

  function readRecord(): { id: string; updatedAt: number } | null {
    const raw = localStorage.getItem(LEADER_KEY);
    return raw ? (JSON.parse(raw) as { id: string; updatedAt: number }) : null;
  }

  it('claims leadership when no existing record is present', () => {
    const record = readRecord();
    expect(service.isLeader()).toBe(true);
    expect(record).not.toBeNull();
    expect(record?.id).toEqual(service.leaderId());
  });

  it('respects an existing active leader record', () => {
    service.stepDown();
    localStorage.setItem(
      LEADER_KEY,
      JSON.stringify({ id: 'other-tab', updatedAt: Date.now() })
    );

    service.updateConfig(baseConfig);

    expect(service.isLeader()).toBe(false);
    expect(service.leaderId()).toBe('other-tab');
  });

  it('takes over leadership when the existing record is stale', () => {
    service.stepDown();
    localStorage.setItem(
      LEADER_KEY,
      JSON.stringify({ id: 'other-tab', updatedAt: Date.now() - HEARTBEAT_INTERVAL_MS * 4 })
    );

    service.updateConfig(baseConfig);

    expect(service.isLeader()).toBe(true);
    expect(service.leaderId()).not.toBe('other-tab');
  });

  it('refreshes the heartbeat while acting as leader', () => {
    const initialRecord = readRecord();
    expect(initialRecord).not.toBeNull();

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS + 50);

    const refreshed = readRecord();
    expect(refreshed).not.toBeNull();
    expect(refreshed!.updatedAt).toBeGreaterThan(initialRecord!.updatedAt);
  });

  it('steps down cleanly and clears the leader record', () => {
    service.stepDown();
    expect(readRecord()).toBeNull();
    expect(service.isLeader()).toBe(false);
  });

  it('reacts to external leader changes via storage events', () => {
    const otherRecord = { id: 'remote-tab', updatedAt: Date.now() };
    const event = new StorageEvent('storage', {
      key: LEADER_KEY,
      newValue: JSON.stringify(otherRecord)
    });

    window.dispatchEvent(event);

    expect(service.isLeader()).toBe(false);
    expect(service.leaderId()).toBe('remote-tab');
  });
});

