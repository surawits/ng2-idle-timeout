import { TestBed } from '@angular/core/testing';
import type { SessionSnapshot } from '../models/session-state';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';
import type { CrossTabMessage } from '../models/cross-tab-message';
import type { BroadcastAdapter } from '../utils/broadcast-channel';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';
import { SessionTimeoutService } from './session-timeout.service';
import { LeaderElectionService } from './leader-election.service';
import { TimeSourceService } from './time-source.service';
import { ServerTimeService } from './server-time.service';

jest.mock('../utils/broadcast-channel', () => {
  class MockBroadcastAdapter implements BroadcastAdapter {
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

describe('SessionTimeoutService cross-tab sync', () => {
  let service: SessionTimeoutService;
  let time: MockTimeSourceService;
  let broadcastMock: BroadcastMockModule;
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
    allowManualExtendWhenExpired: false
  };
  const channelName = 'testApp:test:session-timeout';
  const leaderKey = 'testApp:test:leader';
  const HEARTBEAT_INTERVAL_MS = 1500;

  beforeEach(() => {
    broadcastMock = jest.requireMock('../utils/broadcast-channel') as BroadcastMockModule;
    broadcastMock.__resetChannels();

    TestBed.configureTestingModule({
      providers: [
        SessionTimeoutService,
        { provide: TimeSourceService, useClass: MockTimeSourceService },
        { provide: SESSION_TIMEOUT_CONFIG, useValue: baseConfig },
        { provide: ServerTimeService, useValue: { configure: jest.fn(), stop: jest.fn() } }
      ]
    });

    service = TestBed.inject(SessionTimeoutService);
    time = TestBed.inject(TimeSourceService) as unknown as MockTimeSourceService;
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    broadcastMock.__resetChannels();
  });

  function manualTick(): void {
    (service as unknown as { handleTick: () => void }).handleTick();
  }

  function snapshot(): SessionSnapshot {
    return service.getSnapshot();
  }

  it('publishes extend messages with snapshot details', () => {
    const messages: CrossTabMessage[] = [];
    service.crossTab$.subscribe(message => messages.push(message));

    service.start();
    service.extend();

    expect(messages).toHaveLength(1);
    const extendMessage = messages[0];
    expect(extendMessage.type).toBe('extend');
    expect(typeof extendMessage.sourceId).toBe('string');
    expect(extendMessage.payload?.snapshot?.state).toBe('COUNTDOWN');
  });

  it('applies remote extend snapshot into local state', () => {
    service.start();

    const channel = broadcastMock.__getChannel(channelName);
    expect(channel).toBeDefined();

    const remoteSnapshot: SessionSnapshot = {
      ...snapshot(),
      state: 'COUNTDOWN',
      countdownEndAt: time.now() + 1500,
      remainingMs: 1500,
      paused: false
    };

    const events: string[] = [];
    service.events$.subscribe(event => events.push(event.type));

    channel!.emit({
      sourceId: 'remote-tab',
      type: 'extend',
      at: time.now(),
      payload: { snapshot: remoteSnapshot }
    } satisfies CrossTabMessage);

    const current = snapshot();
    expect(current.state).toBe('COUNTDOWN');
    expect(current.remainingMs).toBe(remoteSnapshot.remainingMs);
    expect(events).toContain('Extended');
  });

  it('forces local expiration when remote tab expires', () => {
    service.start();
    time.advance(baseConfig.idleGraceMs + baseConfig.countdownMs);
    manualTick();

    const channel = broadcastMock.__getChannel(channelName);
    expect(channel).toBeDefined();

    const expireEvents: CrossTabMessage[] = [];
    service.crossTab$.subscribe(message => {
      if (message.type === 'expire') {
        expireEvents.push(message);
      }
    });

    channel!.emit({
      sourceId: 'remote-tab',
      type: 'expire',
      at: time.now(),
      payload: {
        snapshot: {
          ...snapshot(),
          state: 'EXPIRED',
          remainingMs: 0,
          countdownEndAt: time.now(),
          paused: false
        }
      }
    } satisfies CrossTabMessage);

    const current = snapshot();
    expect(current.state).toBe('EXPIRED');
    expect(current.remainingMs).toBe(0);
    expect(expireEvents.length).toBeGreaterThanOrEqual(1);
  });
  it('emits leader election events on leadership changes', async () => {
    const captured: Array<{ type: string; meta?: Record<string, unknown> }> = [];
    const sub = service.events$.subscribe(event => {
      captured.push({ type: event.type, meta: event.meta as Record<string, unknown> | undefined });
    });
    const leader = TestBed.inject(LeaderElectionService);

    service.start();

    leader.stepDown();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(leader.isLeader()).toBe(false);

    const remoteRecord = { id: 'remote-tab', updatedAt: Date.now() };
    localStorage.setItem(leaderKey, JSON.stringify(remoteRecord));
    window.dispatchEvent(new StorageEvent('storage', {
      key: leaderKey,
      newValue: JSON.stringify(remoteRecord),
      storageArea: localStorage
    }));

    const staleRecord = { id: 'remote-tab', updatedAt: Date.now() - HEARTBEAT_INTERVAL_MS * 4 };
    localStorage.setItem(leaderKey, JSON.stringify(staleRecord));
    leader.updateConfig(baseConfig);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(leader.isLeader()).toBe(true);
    const leaderEvent = captured.find(event => event.type === 'LeaderElected');
    expect(leaderEvent).toBeTruthy();
    expect(leaderEvent?.meta?.leaderId).toBeDefined();

    sub.unsubscribe();
  });
});





