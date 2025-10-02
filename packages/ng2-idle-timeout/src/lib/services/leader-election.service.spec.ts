import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';

import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';
import { LeaderElectionService } from './leader-election.service';

const HEARTBEAT_INTERVAL_MS = 1_000;
const LEASE_DURATION_MS = HEARTBEAT_INTERVAL_MS * 4;
const LEADER_KEY = 'testApp:test:leader';

interface StoredRecord {
  leaderId: string;
  leadershipEpoch: number;
  leaseUntil: number;
  heartbeatEveryMs: number;
  updatedAt: number;
  version: number;
}

describe('LeaderElectionService', () => {
  beforeAll(() => {
    try {
      TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
    } catch (error) {
      // environment may already be initialized in other specs
    }
  });

  let service: LeaderElectionService;
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

  function readRecord(): StoredRecord | null {
    const raw = localStorage.getItem(LEADER_KEY);
    return raw ? (JSON.parse(raw) as StoredRecord) : null;
  }

  it('claims leadership when no existing record is present', () => {
    const record = readRecord();
    expect(service.isLeader()).toBe(true);
    expect(record).not.toBeNull();
    expect(record?.leaderId).toEqual(service.leaderId());
    expect(record?.leaseUntil ?? 0).toBeGreaterThan(Date.now());
  });

  it('respects an existing active leader record', () => {
    service.stepDown();
    const now = Date.now();
    const otherRecord: StoredRecord = {
      leaderId: 'other-tab',
      leadershipEpoch: 1,
      leaseUntil: now + LEASE_DURATION_MS,
      heartbeatEveryMs: HEARTBEAT_INTERVAL_MS,
      updatedAt: now,
      version: 1
    };
    localStorage.setItem(LEADER_KEY, JSON.stringify(otherRecord));

    service.updateConfig(baseConfig);

    expect(service.isLeader()).toBe(false);
    expect(service.leaderId()).toBe('other-tab');
  });

  it('takes over leadership when the existing record is stale', () => {
    service.stepDown();
    const staleRecord: StoredRecord = {
      leaderId: 'other-tab',
      leadershipEpoch: 2,
      leaseUntil: Date.now() - LEASE_DURATION_MS,
      heartbeatEveryMs: HEARTBEAT_INTERVAL_MS,
      updatedAt: Date.now() - LEASE_DURATION_MS,
      version: 5
    };
    localStorage.setItem(LEADER_KEY, JSON.stringify(staleRecord));

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
    expect(refreshed!.leaseUntil).toBeGreaterThan(initialRecord!.leaseUntil);
  });

  it('steps down cleanly and clears the leader record', () => {
    service.stepDown();
    expect(service.isLeader()).toBe(false);
    expect(service.leaderId()).toBeNull();
    const record = readRecord();
    expect(record).not.toBeNull();
    expect(record!.leaseUntil).toBeLessThanOrEqual(Date.now());
  });

  it('reacts to external leader changes via storage events', () => {
    const otherRecord: StoredRecord = {
      leaderId: 'remote-tab',
      leadershipEpoch: 3,
      leaseUntil: Date.now() + LEASE_DURATION_MS,
      heartbeatEveryMs: HEARTBEAT_INTERVAL_MS,
      updatedAt: Date.now(),
      version: 7
    };
    const event = new StorageEvent('storage', {
      key: LEADER_KEY,
      newValue: JSON.stringify(otherRecord)
    });

    window.dispatchEvent(event);

    expect(service.isLeader()).toBe(false);
    expect(service.leaderId()).toBe('remote-tab');
  });
});

