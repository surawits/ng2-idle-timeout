import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';

type SessionSnapshot = import('../models/session-state').SessionSnapshot;
type SessionTimeoutConfig = import('../models/session-timeout-config').SessionTimeoutConfig;
type CrossTabMessage = import('../models/cross-tab-message').CrossTabMessage;
type BroadcastAdapter = import('../utils/broadcast-channel').BroadcastAdapter;
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

class StubLeaderElectionService {
  private readonly leaderInternal = signal<string | null>('stub-leader');
  readonly leaderId = this.leaderInternal.asReadonly();
  readonly isLeader = computed(() => this.leaderInternal() != null);

  updateConfig(): void {}

  electLeader(): void {}

  stepDown(): void {
    this.setLeader(false);
  }

  setLeader(value: boolean, id: string | null = value ? 'stub-leader' : null): void {
    this.leaderInternal.set(value ? id : null);
  }
}

describe('SessionTimeoutService cross-tab sync', () => {
  beforeAll(() => {
    try {
      TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
    } catch (error) {
      // environment may already be initialized in other specs
    }
  });

  let service: SessionTimeoutService;
  let time: MockTimeSourceService;
  let broadcastMock: BroadcastMockModule;
  let leaderStub: StubLeaderElectionService;
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
  const channelName = 'testApp:test:session-timeout';

  beforeEach(() => {
    broadcastMock = jest.requireMock('../utils/broadcast-channel') as BroadcastMockModule;
    broadcastMock.__resetChannels();

    leaderStub = new StubLeaderElectionService();

    TestBed.configureTestingModule({
      providers: [
        SessionTimeoutService,
        { provide: TimeSourceService, useClass: MockTimeSourceService },
        { provide: SESSION_TIMEOUT_CONFIG, useValue: baseConfig },
        { provide: ServerTimeService, useValue: { configure: jest.fn(), stop: jest.fn() } },
        { provide: LeaderElectionService, useValue: leaderStub }
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

    const extendMessages = messages.filter(message => message.type === 'extend');
    expect(extendMessages).toHaveLength(1);
    const extendMessage = extendMessages[0];
    expect(extendMessage.type).toBe('extend');
    expect(typeof extendMessage.sourceId).toBe('string');
    expect(extendMessage.payload?.snapshot?.state).toBe('COUNTDOWN');
    expect(extendMessage.payload?.snapshot?.startedAt).not.toBeNull();
    expect(extendMessage.payload?.version).toBeGreaterThan(0);
    expect(extendMessage.payload?.updatedAt).toBeGreaterThanOrEqual(0);
  });

  it('applies remote extend snapshot into local state', () => {
    service.start();
    leaderStub.setLeader(false);

    const channel = broadcastMock.__getChannel(channelName);
    expect(channel).toBeDefined();

    const remoteSnapshot: SessionSnapshot = {
      ...snapshot(),
      state: 'COUNTDOWN',
      countdownEndAt: time.now() + 1500,
      remainingMs: 1500,
      paused: false,
      startedAt: snapshot().startedAt ?? time.now()
    };

    const events: string[] = [];
    service.events$.subscribe(event => events.push(event.type));

    channel!.emit({
      sourceId: 'remote-tab',
      type: 'extend',
      at: time.now(),
      payload: { snapshot: remoteSnapshot, version: 10, updatedAt: time.now() + 5 }
    } satisfies CrossTabMessage);

    const current = snapshot();
    expect(current.state).toBe('COUNTDOWN');
    expect(current.remainingMs).toBe(remoteSnapshot.remainingMs);
    expect(current.startedAt).toBe(remoteSnapshot.startedAt);
    expect(events).toContain('Extended');
  });

  it('forces local expiration when remote tab expires', () => {
    service.start();
    leaderStub.setLeader(false);
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
          paused: false,
          startedAt: snapshot().startedAt
        },
        version: 20,
        updatedAt: time.now() + 5
      }
    } satisfies CrossTabMessage);

    const current = snapshot();
    expect(current.state).toBe('EXPIRED');
    expect(current.remainingMs).toBe(0);
    expect(expireEvents.length).toBeGreaterThanOrEqual(1);
  });
  it('emits leader election events on leadership changes', () => {
    const captured: Array<{ type: string; meta?: Record<string, unknown> }> = [];
    const sub = service.events$.subscribe(event => {
      captured.push({ type: event.type, meta: event.meta as Record<string, unknown> | undefined });
    });

    service.start();

    leaderStub.setLeader(false, null);
    (service as any).syncLeaderState?.();
    leaderStub.setLeader(true, 'new-leader');
    (service as any).syncLeaderState?.();

    const leaderLost = captured.find(event => event.type === 'LeaderLost');
    const leaderEvent = captured.find(event => event.type === 'LeaderElected');
    expect(leaderLost).toBeDefined();
    expect(leaderEvent).toBeDefined();
    expect(leaderEvent?.meta?.leaderId).toBe('new-leader');

    sub.unsubscribe();
  });

  it('sends reset message when follower has activity', () => {
    leaderStub.setLeader(false);

    const channel = broadcastMock.__getChannel(channelName);
    expect(channel).toBeDefined();
    const postMessageSpy = jest.spyOn(channel!, 'publish');

    service.start();
    // Simulate a DOM activity event
    (service as any).handleExternalActivity({ source: 'dom', at: time.now() }, 'ResetByActivity');

    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'reset' }));
  });

  it('leader resets idle timer on reset message from follower', () => {
    leaderStub.setLeader(true);

    service.start();
    time.advance(100);
    manualTick();
    const idleStartBefore = snapshot().idleStartAt;

    const channel = broadcastMock.__getChannel(channelName);
    expect(channel).toBeDefined();

    time.advance(50);
    const activityTime = time.now();

    // Simulate receiving a reset message from a follower
    channel!.emit({
      sourceId: 'remote-tab',
      type: 'reset',
      at: activityTime,
      payload: { activitySource: 'dom' }
    } satisfies CrossTabMessage);

    manualTick();

    const idleStartAfter = snapshot().idleStartAt;
    expect(idleStartAfter).toBeGreaterThan(idleStartBefore!);
    expect(idleStartAfter).toBe(activityTime);
  });
});
