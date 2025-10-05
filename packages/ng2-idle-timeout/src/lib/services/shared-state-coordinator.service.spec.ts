import { TestBed } from '@angular/core/testing';
import { filter, firstValueFrom } from 'rxjs';

import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';
import { SharedStateCoordinatorService } from './shared-state-coordinator.service';
import {
  SHARED_STATE_VERSION,
  type SharedSessionState,
  type SharedStateMessage
} from '../models/session-shared-state';
import { TimeSourceService } from './time-source.service';

jest.mock('../utils/broadcast-channel', () => {
  class MockBroadcastAdapter {
    readonly messages: unknown[] = [];
    private readonly listeners = new Set<(event: MessageEvent) => void>();

    constructor(readonly name: string) {}

    publish(message: unknown): void {
      this.messages.push(message);
      this.listeners.forEach(listener => listener({ data: message } as MessageEvent));
    }

    close(): void {
      this.listeners.clear();
    }

    subscribe(callback: (event: MessageEvent) => void): void {
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
  __getChannel: (name: string) => ({ messages: unknown[]; emit(message: unknown): void } | undefined);
  __resetChannels: () => void;
};

class StubTimeSourceService {
  private current = 1_000;

  now(): number {
    return this.current;
  }

  setNow(value: number): void {
    this.current = value;
  }
}

describe('SharedStateCoordinatorService', () => {
  let service: SharedStateCoordinatorService;
  let time: StubTimeSourceService;
  let broadcastMock: BroadcastMockModule;

  const baseConfig: SessionTimeoutConfig = {
    ...DEFAULT_SESSION_TIMEOUT_CONFIG,
    storageKeyPrefix: 'shared-test',
    appInstanceId: 'testApp',
    syncMode: 'leader'
  };

  beforeEach(() => {
    broadcastMock = jest.requireMock('../utils/broadcast-channel') as BroadcastMockModule;
    broadcastMock.__resetChannels();
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        SharedStateCoordinatorService,
        { provide: SESSION_TIMEOUT_CONFIG, useValue: baseConfig },
        { provide: TimeSourceService, useClass: StubTimeSourceService }
      ]
    });

    service = TestBed.inject(SharedStateCoordinatorService);
    time = TestBed.inject(TimeSourceService) as unknown as StubTimeSourceService;
    service.updateConfig(baseConfig);
  });

  afterEach(() => {
    broadcastMock.__resetChannels();
    localStorage.clear();
  });

  function createSharedState(overrides?: Partial<SharedSessionState>): SharedSessionState {
    return {
      version: SHARED_STATE_VERSION,
      updatedAt: overrides?.updatedAt ?? time.now(),
      syncMode: overrides?.syncMode ?? 'leader',
      leader: overrides?.leader ?? null,
      snapshot: overrides?.snapshot ?? {
        state: 'IDLE',
        remainingMs: 1_000,
        idleStartAt: null,
        countdownEndAt: null,
        lastActivityAt: null,
        paused: false
      },
      config: overrides?.config ?? {
        idleGraceMs: 100,
        countdownMs: 1_000,
        warnBeforeMs: 200,
        activityResetCooldownMs: 0,
        storageKeyPrefix: baseConfig.storageKeyPrefix,
        syncMode: overrides?.syncMode ?? 'leader',
        resumeBehavior: undefined,
        ignoreUserActivityWhenPaused: false,
        allowManualExtendWhenExpired: false
      }
    };
  }

  it('persists and broadcasts shared state when published', () => {
    const sharedState = createSharedState();

    service.publishState(sharedState);

    const stored = localStorage.getItem('shared-test:shared-state');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as SharedSessionState;
    expect(parsed.version).toBe(SHARED_STATE_VERSION);
    const channel = broadcastMock.__getChannel('testApp:shared-test:shared-state');
    expect(channel).toBeDefined();
    expect(channel?.messages).toHaveLength(1);
    const message = channel?.messages[0] as { type: string; state: SharedSessionState };
    expect(message.type).toBe('state');
    expect(message.state.syncMode).toBe('leader');
  });

  it('emits updates and persists state when receiving remote broadcast', async () => {
    const sharedState = createSharedState({ updatedAt: 2_000 });
    const channel = broadcastMock.__getChannel('testApp:shared-test:shared-state');
    expect(channel).toBeDefined();

    const updatePromise = firstValueFrom(
      service.updates$.pipe(filter(message => message.type === 'state'))
    );

    channel?.emit({
      type: 'state',
      sourceId: 'remote-tab',
      at: time.now(),
      state: sharedState
    });

    const message = (await updatePromise) as SharedStateMessage;
    expect(message.type).toBe('state');
    if (message.type !== 'state') {
      throw new Error('Expected state broadcast');
    }
    expect(message.state.updatedAt).toBe(2_000);
    const storedRaw = localStorage.getItem('shared-test:shared-state');
    expect(storedRaw).not.toBeNull();
    const stored = service.readPersistedState();
    expect(stored?.updatedAt).toBe(2_000);
  });

  it('requests sync through broadcast channel', () => {
    service.requestSync('join');
    const channel = broadcastMock.__getChannel('testApp:shared-test:shared-state');
    expect(channel).toBeDefined();
    const message = channel?.messages.at(-1) as { type: string; reason?: string } | undefined;
    expect(message?.type).toBe('request-sync');
    expect(message?.reason).toBe('join');
  });

  it('ignores messages originating from the same source', () => {
    const sharedState = createSharedState();
    const channel = broadcastMock.__getChannel('testApp:shared-test:shared-state');
    const received: SharedStateMessage[] = [];

    service.updates$.subscribe(message => received.push(message));

    service.publishState(sharedState);
    const ownMessage = channel?.messages[0] as SharedStateMessage | undefined;
    channel?.emit({
      type: 'state',
      sourceId: ownMessage?.sourceId ?? 'local',
      at: time.now(),
      state: sharedState
    });

    expect(received).toHaveLength(0);
  });
});
