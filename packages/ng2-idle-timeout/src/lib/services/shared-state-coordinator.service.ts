import { DestroyRef, Injectable, NgZone, inject } from '@angular/core';
import { Subject } from 'rxjs';

import { TimeSourceService } from './time-source.service';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';
import {
  SHARED_STATE_VERSION,
  type SharedSessionState,
  type SharedStateMessage,
  type SharedStateBroadcastMessage,
  type SharedStateRequestMessage
} from '../models/session-shared-state';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';
import { createBroadcastChannel, type BroadcastAdapter } from '../utils/broadcast-channel';
import { createStorage, type StorageAdapter } from '../utils/storage';

export interface SharedStatePublishOptions {
  persist?: boolean;
  broadcast?: boolean;
}

@Injectable({ providedIn: 'root' })
export class SharedStateCoordinatorService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly timeSource = inject(TimeSourceService);
  private readonly providedConfig = inject(SESSION_TIMEOUT_CONFIG, { optional: true }) as
    | SessionTimeoutConfig
    | undefined;

  private readonly storage: StorageAdapter = createStorage();
  private readonly updatesSubject = new Subject<SharedStateMessage>();

  private channel: BroadcastAdapter | null = null;
  private channelName: string | null = null;
  private storageKey: string | null = null;
  private namespace: string | null = null;
  private disposed = false;

  private currentConfig: SessionTimeoutConfig | null = null;
  private readonly sourceId = generateCoordinatorId();

  readonly updates$ = this.updatesSubject.asObservable();

  constructor() {
    if (this.providedConfig) {
      this.applyConfig(this.providedConfig);
    } else {
      this.applyConfig(undefined);
    }

    this.destroyRef.onDestroy(() => {
      this.disposed = true;
      this.teardownChannel();
      this.updatesSubject.complete();
    });
  }

  updateConfig(config: SessionTimeoutConfig): void {
    this.applyConfig(config);
  }

  publishState(state: SharedSessionState, options?: SharedStatePublishOptions): void {
    if (this.disposed) {
      return;
    }
    const normalized = this.normalizeState(state);
    const persist = options?.persist ?? true;
    const broadcast = options?.broadcast ?? true;

    if (persist) {
      this.persistSharedState(normalized);
    }

    if (broadcast) {
      this.publishMessage({
        type: 'state',
        at: this.timeSource.now(),
        sourceId: this.sourceId,
        state: normalized
      });
    }
  }

  requestSync(reason?: string): void {
    if (this.disposed) {
      return;
    }
    this.publishMessage({
      type: 'request-sync',
      sourceId: this.sourceId,
      at: this.timeSource.now(),
      reason
    });
  }

  readPersistedState(): SharedSessionState | null {
    if (!this.storageKey) {
      return null;
    }

    try {
      const raw = this.storage.read(this.storageKey);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as SharedSessionState;
      return this.isSharedSessionState(parsed) ? parsed : null;
    } catch (error) {
      console.warn('[ng2-idle-timeout] Unable to parse shared state from storage', error);
      return null;
    }
  }

  clearPersistedState(): void {
    if (!this.storageKey) {
      return;
    }
    try {
      this.storage.remove(this.storageKey);
    } catch (error) {
      console.warn('[ng2-idle-timeout] Unable to clear shared state from storage', error);
    }
  }

  private applyConfig(config: SessionTimeoutConfig | undefined): void {
    const effective = config ?? this.currentConfig ?? DEFAULT_SESSION_TIMEOUT_CONFIG;
    this.currentConfig = effective;
    const prefix = effective.storageKeyPrefix ?? 'ng2-idle-timeout';
    const namespace = effective.appInstanceId ?? 'ng2-idle-timeout';
    const nextChannelName = `${namespace}:${prefix}:shared-state`;
    const nextStorageKey = `${prefix}:shared-state`;

    const shouldRecreateChannel = this.channelName !== nextChannelName || this.namespace !== namespace;
    this.storageKey = nextStorageKey;
    this.channelName = nextChannelName;
    this.namespace = namespace;

    if (shouldRecreateChannel) {
      this.setupChannel(nextChannelName);
    }
  }

  private setupChannel(name: string): void {
    this.teardownChannel();
    const adapter = createBroadcastChannel(name);
    if (!adapter) {
      this.channel = null;
      return;
    }

    adapter.subscribe(event => {
      const message = event?.data;
      this.zone.run(() => this.handleIncomingMessage(message));
    });

    this.channel = adapter;
  }

  private teardownChannel(): void {
    this.channel?.close();
    this.channel = null;
  }

  private persistSharedState(state: SharedSessionState): void {
    if (!this.storageKey) {
      return;
    }
    try {
      this.storage.write(this.storageKey, JSON.stringify(state));
    } catch (error) {
      console.warn('[ng2-idle-timeout] Unable to persist shared state', error);
    }
  }

  private publishMessage(message: SharedStateMessage): void {
    if (!this.channel) {
      return;
    }
    try {
      this.channel.publish(message);
    } catch (error) {
      console.warn('[ng2-idle-timeout] Failed to broadcast shared state message', error);
    }
  }

  private handleIncomingMessage(payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (!this.isSharedStateMessage(payload)) {
      return;
    }

    if (payload.sourceId === this.sourceId) {
      return;
    }

    if (payload.type === 'state') {
      if (this.isSharedSessionState(payload.state)) {
        this.persistSharedState(payload.state);
      } else {
        return;
      }
    }

    this.updatesSubject.next(payload);
  }

  private normalizeState(state: SharedSessionState): SharedSessionState {
    const updatedAt = state.updatedAt ?? this.timeSource.now();
    return {
      version: SHARED_STATE_VERSION,
      updatedAt,
      syncMode: state.syncMode,
      leader: state.leader ?? null,
      snapshot: {
        state: state.snapshot.state,
        idleStartAt: state.snapshot.idleStartAt ?? null,
        countdownEndAt: state.snapshot.countdownEndAt ?? null,
        lastActivityAt: state.snapshot.lastActivityAt ?? null,
        paused: state.snapshot.paused ?? false
      },
      config: {
        idleGraceMs: state.config.idleGraceMs,
        countdownMs: state.config.countdownMs,
        warnBeforeMs: state.config.warnBeforeMs,
        activityResetCooldownMs: state.config.activityResetCooldownMs,
        storageKeyPrefix: state.config.storageKeyPrefix,
        syncMode: state.config.syncMode,
        resumeBehavior: state.config.resumeBehavior,
        ignoreUserActivityWhenPaused: state.config.ignoreUserActivityWhenPaused,
        allowManualExtendWhenExpired: state.config.allowManualExtendWhenExpired
      }
    };
  }

  private isSharedStateMessage(payload: unknown): payload is SharedStateMessage {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.type !== 'string' || typeof record.sourceId !== 'string' || typeof record.at !== 'number') {
      return false;
    }

    if (record.type === 'state') {
      return this.isSharedStateBroadcastMessage(record);
    }

    if (record.type === 'request-sync') {
      return true;
    }

    return false;
  }

  private isSharedStateBroadcastMessage(payload: unknown): payload is SharedStateBroadcastMessage {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    const record = payload as Record<string, unknown>;
    const stateCandidate = record.state as SharedSessionState | undefined;
    return !!stateCandidate && this.isSharedSessionState(stateCandidate);
  }

  private isSharedSessionState(candidate: unknown): candidate is SharedSessionState {
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }
    const record = candidate as Record<string, unknown>;
    if (record.version !== SHARED_STATE_VERSION) {
      return false;
    }
    if (!this.isSharedSnapshot(record.snapshot) || !this.isSharedConfig(record.config)) {
      return false;
    }
    if (record.leader != null && !this.isLeaderInfo(record.leader)) {
      return false;
    }
    return typeof record.updatedAt === 'number' && typeof record.syncMode === 'string';
  }

  private isSharedSnapshot(snapshot: unknown): snapshot is SharedSessionState['snapshot'] {
    if (!snapshot || typeof snapshot !== 'object') {
      return false;
    }
    const record = snapshot as Record<string, unknown>;
    return (
      typeof record.state === 'string' &&
      (record.idleStartAt === null || typeof record.idleStartAt === 'number') &&
      (record.countdownEndAt === null || typeof record.countdownEndAt === 'number') &&
      (record.lastActivityAt === null || typeof record.lastActivityAt === 'number') &&
      typeof record.paused === 'boolean'
    );
  }

  private isSharedConfig(config: unknown): config is SharedSessionState['config'] {
    if (!config || typeof config !== 'object') {
      return false;
    }
    const record = config as Record<string, unknown>;
    const resumeBehavior = record.resumeBehavior;
    const resumeValid =
      resumeBehavior === undefined || resumeBehavior === 'manual' || resumeBehavior === 'autoOnServerSync';
    return (
      typeof record.idleGraceMs === 'number' &&
      typeof record.countdownMs === 'number' &&
      typeof record.warnBeforeMs === 'number' &&
      typeof record.activityResetCooldownMs === 'number' &&
      typeof record.storageKeyPrefix === 'string' &&
      typeof record.syncMode === 'string' &&
      resumeValid &&
      typeof record.ignoreUserActivityWhenPaused === 'boolean' &&
      typeof record.allowManualExtendWhenExpired === 'boolean'
    );
  }

  private isLeaderInfo(leader: unknown): leader is SharedSessionState['leader'] {
    if (!leader || typeof leader !== 'object') {
      return false;
    }
    const record = leader as Record<string, unknown>;
    return (
      typeof record.id === 'string' &&
      typeof record.heartbeatAt === 'number' &&
      typeof record.epoch === 'number'
    );
  }
}

function generateCoordinatorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
