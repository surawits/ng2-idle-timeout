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
  type SharedStateRequestMessage,
  type SharedStateMetadata,
  type SharedStateOperation,
  type SharedConfigPayload
} from '../models/session-shared-state';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';
import { createBroadcastChannel, type BroadcastAdapter } from '../utils/broadcast-channel';
import { createStorage, type StorageAdapter } from '../utils/storage';

export interface SharedStatePublishOptions {
  persist?: boolean;
  broadcast?: boolean;
}

interface LegacySharedConfigPayload
  extends Omit<SharedConfigPayload, 'revision' | 'logicalClock' | 'writerId'>,
    Partial<Pick<SharedConfigPayload, 'revision' | 'logicalClock' | 'writerId'>> {}

type LegacySharedSessionState = Omit<SharedSessionState, 'version' | 'metadata' | 'config'> & {
  version?: number;
  metadata?: Partial<SharedStateMetadata>;
  config: LegacySharedConfigPayload;
};

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

  getSourceId(): string {
    return this.sourceId;
  }

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

  requestSync(reason?: string, expectReply?: boolean): void {
    if (this.disposed) {
      return;
    }
    this.publishMessage({
      type: 'request-sync',
      sourceId: this.sourceId,
      at: this.timeSource.now(),
      reason,
      expectReply
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
      const parsed = JSON.parse(raw) as unknown;
      return this.coerceSharedState(parsed);
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
      const normalized = this.coerceSharedState((payload as SharedStateBroadcastMessage).state);
      if (!normalized) {
        return;
      }
      this.persistSharedState(normalized);
      const message: SharedStateBroadcastMessage = {
        type: 'state',
        sourceId: payload.sourceId,
        at: payload.at,
        state: normalized
      };
      this.updatesSubject.next(message);
      return;
    }

    this.updatesSubject.next(payload);
  }

  private normalizeState(state: LegacySharedSessionState | SharedSessionState): SharedSessionState {
    const updatedAt = typeof state.updatedAt === 'number' ? state.updatedAt : this.timeSource.now();
    const syncMode = state.syncMode === 'distributed' ? 'distributed' : 'leader';
    const leader = state.leader && this.isLeaderInfo(state.leader) ? state.leader : null;
    const snapshot = this.normalizeSnapshot(state.snapshot);
    const config = this.normalizeConfig(state.config);
    const metadata = this.normalizeMetadata(state.metadata, updatedAt);
    return {
      version: SHARED_STATE_VERSION,
      updatedAt,
      syncMode,
      leader,
      metadata,
      snapshot,
      config
    };
  }

  private normalizeMetadata(
    metadata: Partial<SharedStateMetadata> | undefined,
    fallbackClock: number
  ): SharedStateMetadata {
    const writerId =
      typeof metadata?.writerId === 'string' && metadata.writerId.length > 0 ? metadata.writerId : this.sourceId;
    const logicalClock =
      typeof metadata?.logicalClock === 'number' && Number.isFinite(metadata.logicalClock) && metadata.logicalClock > 0
        ? metadata.logicalClock
        : fallbackClock;
    const revision =
      typeof metadata?.revision === 'number' && Number.isFinite(metadata.revision) && metadata.revision > 0
        ? metadata.revision
        : 1;
    const operation = this.normalizeOperation(metadata?.operation);
    const causalityToken =
      typeof metadata?.causalityToken === 'string' && metadata.causalityToken.length > 0
        ? metadata.causalityToken
        : writerId + ':' + logicalClock;
    return { revision, logicalClock, writerId, operation, causalityToken };
  }

  private normalizeOperation(operation: SharedStateOperation | undefined): SharedStateOperation {
    switch (operation) {
      case 'reset-by-activity':
      case 'manual-extend':
      case 'auto-extend':
      case 'pause':
      case 'resume':
      case 'expire':
      case 'config-change':
      case 'bootstrap':
        return operation;
      default:
        return 'bootstrap';
    }
  }

  private normalizeSnapshot(snapshot: unknown): SharedSessionState['snapshot'] {
    if (!this.isSharedSnapshot(snapshot)) {
      throw new Error('invalid shared snapshot');
    }
    const record = snapshot as SharedSessionState['snapshot'];
    return {
      state: record.state,
      remainingMs: record.remainingMs,
      idleStartAt: record.idleStartAt ?? null,
      countdownEndAt: record.countdownEndAt ?? null,
      lastActivityAt: record.lastActivityAt ?? null,
      paused: record.paused ?? false
    };
  }

  private normalizeConfig(config: unknown): SharedConfigPayload {
    if (!this.isLegacySharedConfig(config)) {
      throw new Error('invalid shared config');
    }
    const record = config as LegacySharedConfigPayload;
    return {
      idleGraceMs: record.idleGraceMs,
      countdownMs: record.countdownMs,
      warnBeforeMs: record.warnBeforeMs,
      activityResetCooldownMs: record.activityResetCooldownMs,
      storageKeyPrefix: record.storageKeyPrefix,
      syncMode: record.syncMode === 'distributed' ? 'distributed' : 'leader',
      resumeBehavior: record.resumeBehavior,
      ignoreUserActivityWhenPaused: record.ignoreUserActivityWhenPaused,
      allowManualExtendWhenExpired: record.allowManualExtendWhenExpired,
      revision:
        typeof record.revision === 'number' && Number.isFinite(record.revision) && record.revision > 0
          ? record.revision
          : 1,
      logicalClock:
        typeof record.logicalClock === 'number' &&
        Number.isFinite(record.logicalClock) &&
        record.logicalClock > 0
          ? record.logicalClock
          : 1,
      writerId: typeof record.writerId === 'string' && record.writerId.length > 0 ? record.writerId : this.sourceId
    };
  }

  private coerceSharedState(candidate: unknown): SharedSessionState | null {
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }
    try {
      const normalized = this.normalizeState(candidate as LegacySharedSessionState | SharedSessionState);
      return this.isSharedSessionState(normalized) ? normalized : null;
    } catch {
      return null;
    }
  }

  private isSharedStateMessage(payload: unknown): payload is SharedStateMessage {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    const record = payload as Record<string, unknown>;
    const type = record['type'];
    const sourceId = record['sourceId'];
    const at = record['at'];

    if (typeof type !== 'string' || typeof sourceId !== 'string' || typeof at !== 'number') {
      return false;
    }

    if (type === 'state') {
      const stateCandidate = record['state'];
      return typeof stateCandidate === 'object' && stateCandidate !== null;
    }

    if (type === 'request-sync') {
      return true;
    }

    return false;
  }

  private isSharedSessionState(candidate: unknown): candidate is SharedSessionState {
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }
    const record = candidate as Record<string, unknown>;
    const version = record['version'];
    if (version !== SHARED_STATE_VERSION) {
      return false;
    }
    const snapshot = record['snapshot'];
    const config = record['config'];
    const metadata = record['metadata'];
    if (!this.isSharedSnapshot(snapshot) || !this.isSharedConfig(config) || !this.isSharedMetadata(metadata)) {
      return false;
    }
    const leader = record['leader'];
    if (leader != null && !this.isLeaderInfo(leader)) {
      return false;
    }
    const syncMode = record['syncMode'];
    const updatedAt = record['updatedAt'];
    return typeof updatedAt === 'number' && (syncMode === 'leader' || syncMode === 'distributed');
  }

  private isSharedSnapshot(snapshot: unknown): snapshot is SharedSessionState['snapshot'] {
    if (!snapshot || typeof snapshot !== 'object') {
      return false;
    }
    const record = snapshot as Record<string, unknown>;
    const state = record['state'];
    const remainingMs = record['remainingMs'];
    const idleStartAt = record['idleStartAt'];
    const countdownEndAt = record['countdownEndAt'];
    const lastActivityAt = record['lastActivityAt'];
    const paused = record['paused'];
    return (
      typeof state === 'string' &&
      typeof remainingMs === 'number' &&
      (idleStartAt === null || typeof idleStartAt === 'number') &&
      (countdownEndAt === null || typeof countdownEndAt === 'number') &&
      (lastActivityAt === null || typeof lastActivityAt === 'number') &&
      typeof paused === 'boolean'
    );
  }

  private isLegacySharedConfig(config: unknown): config is LegacySharedConfigPayload {
    if (!config || typeof config !== 'object') {
      return false;
    }
    const record = config as unknown as Record<string, unknown>;
    const resumeBehavior = record['resumeBehavior'];
    const idleGraceMs = record['idleGraceMs'];
    const countdownMs = record['countdownMs'];
    const warnBeforeMs = record['warnBeforeMs'];
    const activityResetCooldownMs = record['activityResetCooldownMs'];
    const storageKeyPrefix = record['storageKeyPrefix'];
    const syncMode = record['syncMode'];
    const ignoreUserActivityWhenPaused = record['ignoreUserActivityWhenPaused'];
    const allowManualExtendWhenExpired = record['allowManualExtendWhenExpired'];
    const resumeValid =
      resumeBehavior === undefined || resumeBehavior === 'manual' || resumeBehavior === 'autoOnServerSync';
    return (
      typeof idleGraceMs === 'number' &&
      typeof countdownMs === 'number' &&
      typeof warnBeforeMs === 'number' &&
      typeof activityResetCooldownMs === 'number' &&
      typeof storageKeyPrefix === 'string' &&
      typeof syncMode === 'string' &&
      resumeValid &&
      typeof ignoreUserActivityWhenPaused === 'boolean' &&
      typeof allowManualExtendWhenExpired === 'boolean'
    );
  }

  private isSharedConfig(config: unknown): config is SharedConfigPayload {
    if (!this.isLegacySharedConfig(config)) {
      return false;
    }
    const record = config as unknown as Record<string, unknown>;
    const revision = record['revision'];
    const logicalClock = record['logicalClock'];
    const writerId = record['writerId'];
    return (
      typeof revision === 'number' &&
      Number.isFinite(revision) &&
      typeof logicalClock === 'number' &&
      Number.isFinite(logicalClock) &&
      typeof writerId === 'string' &&
      writerId.length > 0
    );
  }

  private isSharedMetadata(metadata: unknown): metadata is SharedStateMetadata {
    if (!metadata || typeof metadata !== 'object') {
      return false;
    }
    const record = metadata as Record<string, unknown>;
    const operation = record['operation'];
    const revision = record['revision'];
    const logicalClock = record['logicalClock'];
    const writerId = record['writerId'];
    const causalityToken = record['causalityToken'];
    const operationValid =
      operation === 'bootstrap' ||
      operation === 'reset-by-activity' ||
      operation === 'manual-extend' ||
      operation === 'auto-extend' ||
      operation === 'pause' ||
      operation === 'resume' ||
      operation === 'expire' ||
      operation === 'config-change';
    return (
      typeof revision === 'number' &&
      Number.isFinite(revision) &&
      typeof logicalClock === 'number' &&
      Number.isFinite(logicalClock) &&
      typeof writerId === 'string' &&
      writerId.length > 0 &&
      typeof causalityToken === 'string' &&
      causalityToken.length > 0 &&
      operationValid
    );
  }

  private isLeaderInfo(leader: unknown): leader is SharedSessionState['leader'] {
    if (!leader || typeof leader !== 'object') {
      return false;
    }
    const record = leader as Record<string, unknown>;
    const id = record['id'];
    const heartbeatAt = record['heartbeatAt'];
    const epoch = record['epoch'];
    return (
      typeof id === 'string' &&
      typeof heartbeatAt === 'number' &&
      typeof epoch === 'number'
    );
  }
}

function generateCoordinatorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
