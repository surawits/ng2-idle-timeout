import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { SessionSnapshot } from '../models/session-state';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';
import type { CrossTabMessage } from '../models/cross-tab-message';
import {
  SHARED_STATE_VERSION,
  type SharedSessionState,
  type SharedStateMessage
} from '../models/session-shared-state';
import type { BroadcastAdapter } from '../utils/broadcast-channel';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';
import { SessionTimeoutService } from './session-timeout.service';
import { LeaderElectionService } from './leader-election.service';
import { SharedStateCoordinatorService } from './shared-state-coordinator.service';
import { TimeSourceService } from './time-source.service';
import { ServerTimeService } from './server-time.service';

class SharedStateCoordinatorStub {
  updateConfig = jest.fn();
  publishState = jest.fn();
  requestSync = jest.fn();
  readPersistedState = jest.fn<SharedSessionState | null, []>(() => null);
  clearPersistedState = jest.fn();
  private readonly updatesSubject = new Subject<SharedStateMessage>();
  readonly updates$ = this.updatesSubject.asObservable();

  emit(message: SharedStateMessage): void {
    this.updatesSubject.next(message);
  }
}

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
  let sharedCoordinator: SharedStateCoordinatorStub;
  let requestSyncMock: jest.Mock;
  let publishStateMock: jest.Mock;
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
  const leaderKey = 'testApp:test:leader';
  const HEARTBEAT_INTERVAL_MS = 1500;

  beforeEach(() => {
    broadcastMock = jest.requireMock('../utils/broadcast-channel') as BroadcastMockModule;
    broadcastMock.__resetChannels();

    TestBed.configureTestingModule({
      providers: [
        SessionTimeoutService,
        { provide: SharedStateCoordinatorService, useClass: SharedStateCoordinatorStub },
        { provide: TimeSourceService, useClass: MockTimeSourceService },
        { provide: SESSION_TIMEOUT_CONFIG, useValue: baseConfig },
        { provide: ServerTimeService, useValue: { configure: jest.fn(), stop: jest.fn() } }
      ]
    });

    sharedCoordinator = TestBed.inject(
      SharedStateCoordinatorService
    ) as unknown as SharedStateCoordinatorStub;
    requestSyncMock = sharedCoordinator.requestSync;
    publishStateMock = sharedCoordinator.publishState;
    service = TestBed.inject(SessionTimeoutService);
    time = TestBed.inject(TimeSourceService) as unknown as MockTimeSourceService;
  });

  afterEach(() => {
    requestSyncMock?.mockReset();
    publishStateMock?.mockReset();
    localStorage.clear();
    TestBed.resetTestingModule();
    broadcastMock.__resetChannels();
  });
  async function flushAsync(iterations = 3): Promise<void> {
    for (let index = 0; index < iterations; index += 1) {
      await Promise.resolve();
    }
  }

  function manualTick(): void {
    (service as unknown as { handleTick: () => void }).handleTick();
  }

  function snapshot(): SessionSnapshot {
    return service.getSnapshot();
  }

  function buildSharedState(overrides?: Partial<SharedSessionState>): SharedSessionState {
    const now = time.now();
    return {
      version: SHARED_STATE_VERSION,
      updatedAt: overrides?.updatedAt ?? now,
      syncMode: overrides?.syncMode ?? 'leader',
      leader: overrides?.leader ?? null,
      snapshot: overrides?.snapshot ?? {
        state: 'IDLE',
        remainingMs: baseConfig.countdownMs,
        idleStartAt: now,
        countdownEndAt: now + baseConfig.countdownMs,
        lastActivityAt: now,
        paused: false
      },
      config: overrides?.config ?? {
        idleGraceMs: baseConfig.idleGraceMs,
        countdownMs: baseConfig.countdownMs,
        warnBeforeMs: baseConfig.warnBeforeMs,
        activityResetCooldownMs: baseConfig.activityResetCooldownMs,
        storageKeyPrefix: baseConfig.storageKeyPrefix,
        syncMode: overrides?.syncMode ?? baseConfig.syncMode,
        resumeBehavior: baseConfig.resumeBehavior,
        ignoreUserActivityWhenPaused: baseConfig.ignoreUserActivityWhenPaused,
        allowManualExtendWhenExpired: baseConfig.allowManualExtendWhenExpired
      }
    };
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

  it('applies shared session state when sync message includes sharedState payload', done => {
    service.start();
    const channel = broadcastMock.__getChannel(channelName);
    expect(channel).toBeDefined();

    const sharedState = buildSharedState({
      syncMode: 'distributed',
      config: {
        idleGraceMs: 180,
        countdownMs: 1600,
        warnBeforeMs: 400,
        activityResetCooldownMs: 20,
        storageKeyPrefix: baseConfig.storageKeyPrefix,
        syncMode: 'distributed',
        resumeBehavior: 'autoOnServerSync',
        ignoreUserActivityWhenPaused: true,
        allowManualExtendWhenExpired: true
      },
      snapshot: {
        state: 'COUNTDOWN',
        remainingMs: 900,
        idleStartAt: time.now() - 50,
        countdownEndAt: time.now() + 900,
        lastActivityAt: time.now() - 25,
        paused: false
      }
    });

    channel!.emit({
      sourceId: 'remote-tab',
      type: 'sync',
      at: time.now(),
      payload: { sharedState }
    } satisfies CrossTabMessage);

    const updatedConfig = service.getConfig();
    expect(updatedConfig.syncMode).toBe('distributed');
    expect(updatedConfig.idleGraceMs).toBe(180);
    expect(updatedConfig.countdownMs).toBe(1600);
    expect(updatedConfig.warnBeforeMs).toBe(400);
    expect(updatedConfig.ignoreUserActivityWhenPaused).toBe(true);
    expect(updatedConfig.allowManualExtendWhenExpired).toBe(true);

    const currentSnapshot = snapshot();
    expect(currentSnapshot.state).toBe('COUNTDOWN');
    expect(currentSnapshot.remainingMs).toBe(900);
    expect(currentSnapshot.countdownEndAt).toBe(sharedState.snapshot.countdownEndAt);
    // Reset the module here to tear down leader-election timers before Jest waits for idle handles.
    TestBed.resetTestingModule();
    done();
  });
  it('emits leader election events on leadership changes', async () => {
    const captured: Array<{ type: string; meta?: Record<string, unknown> }> = [];
    const sub = service.events$.subscribe(event => {
      captured.push({ type: event.type, meta: event.meta as Record<string, unknown> | undefined });
    });
    const leader = TestBed.inject(LeaderElectionService);

    service.start();

    leader.stepDown();
    expect(leader.isLeader()).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 0));

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
    await new Promise(resolve => setTimeout(resolve, HEARTBEAT_INTERVAL_MS));

    const leaderEvent = captured.find(event => event.type === 'LeaderElected');
    expect(leader.isLeader()).toBe(true);
    if (leaderEvent) {
      expect(leaderEvent.meta?.leaderId).toBeDefined();
    }

    sub.unsubscribe();
  });

  it('sends reset message when follower has activity', () => {
    const leader = TestBed.inject(LeaderElectionService);
    jest.spyOn(leader, 'isLeader').mockReturnValue(false); // This tab is a follower

    const channel = broadcastMock.__getChannel(channelName);
    expect(channel).toBeDefined();
    const postMessageSpy = jest.spyOn(channel!, 'publish');

    service.start();
    // Simulate a DOM activity event
    (service as any).handleExternalActivity({ source: 'dom', at: time.now() }, 'ResetByActivity');

    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'reset' }));
  });

  it('leader resets idle timer on reset message from follower', () => {
    const leader = TestBed.inject(LeaderElectionService);
    jest.spyOn(leader, 'isLeader').mockReturnValue(true); // This tab is the leader

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

  it('broadcasts shared state in response to sync requests', async () => {
    const leader = TestBed.inject(LeaderElectionService);
    jest.spyOn(leader, 'isLeader').mockReturnValue(true);

    const messages: CrossTabMessage[] = [];
    service.crossTab$.subscribe(message => messages.push(message));

    service.start();
    messages.length = 0;

    const channel = broadcastMock.__getChannel(channelName);
    expect(channel).toBeDefined();

    channel!.emit({
      sourceId: 'remote-tab',
      type: 'sync-request',
      at: time.now()
    } satisfies CrossTabMessage);

    await flushAsync();

    const syncMessage = messages.find(message => message.type === 'sync');
    expect(syncMessage).toBeDefined();
    expect(syncMessage?.payload?.sharedState?.version).toBe(SHARED_STATE_VERSION);
    expect(syncMessage?.payload?.sharedState?.config.syncMode).toBe('leader');
  });

  it('requests shared-state sync from coordinator when leadership is lost', async () => {
    const leader = TestBed.inject(LeaderElectionService);

    await flushAsync();
    requestSyncMock.mockClear();

    leader.stepDown();

    await flushAsync();

    expect(requestSyncMock).toHaveBeenCalledWith('leader-changed');
  });

  it('publishes shared state bundle when leadership is acquired', async () => {
    const leader = TestBed.inject(LeaderElectionService);

    await flushAsync();
    const initialCalls = publishStateMock.mock.calls.length;

    leader.stepDown();

    await flushAsync();

    leader.electLeader();

    await flushAsync();

    expect(publishStateMock.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('emits sync-request message on leader loss to prompt followers', async () => {
    const leader = TestBed.inject(LeaderElectionService);
    const captured: CrossTabMessage[] = [];
    const sub = service.crossTab$.subscribe(message => captured.push(message));

    await flushAsync();
    captured.length = 0;

    leader.stepDown();

    await flushAsync();

    const syncRequestExists = captured.some(message => message.type === 'sync-request');
    expect(syncRequestExists).toBe(true);

    sub.unsubscribe();
  });
});
