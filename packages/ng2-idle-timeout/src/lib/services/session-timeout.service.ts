import { DestroyRef, Injectable, NgZone, computed, effect, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Subject, interval, takeUntil } from 'rxjs';
import type { Subscription } from 'rxjs';

import type { ActivityEvent } from '../models/activity-event';
import type { SessionEvent } from '../models/session-event';
import type { SessionSnapshot, SessionState } from '../models/session-state';
import type { CrossTabMessage, CrossTabMessageType } from '../models/cross-tab-message';
import { SHARED_STATE_VERSION, type SharedSessionState } from '../models/session-shared-state';
import { createBroadcastChannel, type BroadcastAdapter } from '../utils/broadcast-channel';
import type {
  SessionTimeoutConfig,
  SessionTimeoutHooks,
  SessionTimeoutPartialConfig,
  SessionActionDelays
} from '../models/session-timeout-config';
import { SESSION_TIMEOUT_CONFIG, SESSION_TIMEOUT_HOOKS } from '../tokens/config.token';
import { createLogger, type Logger } from '../utils/logging';
import { TimeSourceService } from './time-source.service';
import { ServerTimeService } from './server-time.service';
import { validateConfig } from '../validation';
import { ActivityDomService } from './activity-dom.service';
import { ActivityRouterService } from './activity-router.service';
import { LeaderElectionService } from './leader-election.service';
import { SharedStateCoordinatorService } from './shared-state-coordinator.service';
import {
  createStorage,
  persistConfig,
  persistSnapshot,
  readPersistedConfig,
  readSnapshot,
  type PersistedSnapshot,
  type StorageAdapter
} from '../utils/storage';

type ServerTimeListenerApi = {
  registerSyncListener?: (listener: () => void) => void;
  unregisterSyncListener?: (listener: () => void) => void;
};

type ActionDelayKey = keyof SessionActionDelays;

function generateTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

@Injectable({ providedIn: 'root' })
export class SessionTimeoutService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly timeSource = inject(TimeSourceService);
  private readonly providedConfig = inject(SESSION_TIMEOUT_CONFIG, { optional: true });
  private readonly hooks = inject(SESSION_TIMEOUT_HOOKS, { optional: true }) ?? {} as SessionTimeoutHooks;
  private readonly domActivity = inject(ActivityDomService, { optional: true });
  private readonly routerActivity = inject(ActivityRouterService, { optional: true });
  private readonly serverTime = inject(ServerTimeService, { optional: true });
  private serverTimeListenerRegistered = false;
  private readonly leaderElection = inject(LeaderElectionService, { optional: true });
  private readonly sharedStateCoordinator = inject(SharedStateCoordinatorService);
  private leaderState: boolean | null = null;
  private readonly leaderWatcher = this.leaderElection
    ? effect(() => {
        this.syncLeaderState();
      })
    : null;
  private readonly storage: StorageAdapter = createStorage();
  private isRestoring = false;
  private isApplyingSharedState = false;

  private configSignal = signal(
    validateConfig(this.providedConfig as SessionTimeoutPartialConfig | undefined).config
  );
  private logger: Logger = createLogger(this.configSignal());

  private readonly snapshotSignal = signal<SessionSnapshot>({
    state: 'IDLE',
    remainingMs: this.configSignal().countdownMs,
    warnBeforeMs: this.configSignal().warnBeforeMs,
    countdownMs: this.configSignal().countdownMs,
    idleGraceMs: this.configSignal().idleGraceMs,
    idleStartAt: null,
    countdownEndAt: null,
    lastActivityAt: null,
    paused: false
  });

  private readonly destroy$ = new Subject<void>();
  private tickerSub: Subscription | null = null;
  private readonly eventsSubject = new Subject<SessionEvent>();
  private readonly activitySubject = new Subject<ActivityEvent>();
  private readonly crossTabSubject = new Subject<CrossTabMessage>();
  private crossTabChannel: BroadcastAdapter | null = null;
  private crossTabChannelName: string | null = null;
  private readonly tabId = generateTabId();
  private isHandlingCrossTabMessage = false;
  private readonly actionDelayTimers = new Map<ActionDelayKey, ReturnType<typeof setTimeout>>();
  private lastAutoActivityResetAt: number | null = null;
  private readonly handleServerSync = () => {
    if (this.configSignal().resumeBehavior === 'autoOnServerSync' && this.snapshotSignal().paused) {
      this.zone.run(() => this.resume());
    }
  };


  private readonly onExpireCallbacks = new Set<(snapshot: SessionSnapshot) => void | Promise<void>>();

  private readonly idleRemainingMsInternal = signal(0);
  private readonly countdownRemainingMsInternal = signal(0);
  private readonly totalRemainingMsInternal = signal(0);
  private readonly activityCooldownRemainingMsInternal = signal(0);

  readonly idleRemainingMsSignal = this.idleRemainingMsInternal.asReadonly();
  readonly activityCooldownRemainingMsSignal = this.activityCooldownRemainingMsInternal.asReadonly();
  readonly countdownRemainingMsSignal = this.countdownRemainingMsInternal.asReadonly();
  readonly totalRemainingMsSignal = this.totalRemainingMsInternal.asReadonly();

  readonly stateSignal: Signal<SessionState> = computed(() => this.snapshotSignal().state);
  readonly remainingMsSignal: Signal<number> = this.totalRemainingMsSignal;
  readonly isWarnSignal: Signal<boolean> = computed(() => this.snapshotSignal().state === 'WARN');
  readonly isExpiredSignal: Signal<boolean> = computed(() => this.snapshotSignal().state === 'EXPIRED');
  private readonly lastActivitySignal: Signal<number | null> = computed(() => this.snapshotSignal().lastActivityAt);
  private readonly countdownEndAtSignal: Signal<number | null> = computed(() => this.snapshotSignal().countdownEndAt);

  readonly idleRemainingMs$ = toObservable(this.idleRemainingMsSignal);
  readonly activityCooldownRemainingMs$ = toObservable(this.activityCooldownRemainingMsSignal);
  readonly countdownRemainingMs$ = toObservable(this.countdownRemainingMsSignal);
  readonly totalRemainingMs$ = toObservable(this.totalRemainingMsSignal);
  readonly state$ = toObservable(this.stateSignal);
  readonly remainingMs$ = this.totalRemainingMs$;
  readonly isWarn$ = toObservable(this.isWarnSignal);
  readonly isExpired$ = toObservable(this.isExpiredSignal);
  readonly lastActivityAt$ = toObservable(this.lastActivitySignal);
  readonly countdownEndAt$ = toObservable(this.countdownEndAtSignal);
  readonly events$ = this.eventsSubject.asObservable();
  readonly activity$ = this.activitySubject.asObservable();
  readonly crossTab$ = this.crossTabSubject.asObservable();

  private readonly configWatcher = effect(() => {
    const config = this.configSignal();
    this.logger = createLogger(config);
    this.restartTicker(config.pollingMs);
    this.domActivity?.updateConfig(config);
    this.routerActivity?.updateConfig(config);
    this.serverTime?.configure(config);
    if (this.leaderElection) {
      this.leaderElection.updateConfig(config);
      if (config.syncMode === 'leader') {
        this.leaderElection.electLeader();
      } else {
        this.leaderElection.stepDown();
      }
    }
    this.sharedStateCoordinator.updateConfig(config);
    this.syncLeaderState();
    this.setupCrossTabChannel(config);
    this.refreshDerivedDurations(undefined, config);
    this.refreshActivityCooldownRemaining(undefined, config);
    if (!this.isRestoring) {
      persistConfig(this.storage, config.storageKeyPrefix, config);
    }
  }, { allowSignalWrites: true });

  constructor() {
    if (this.domActivity) {
      this.domActivity.events$.pipe(takeUntil(this.destroy$)).subscribe(event => {
        this.handleExternalActivity(event, 'ResetByActivity');
      });
    }

    if (this.routerActivity) {
      this.routerActivity.events$.pipe(takeUntil(this.destroy$)).subscribe(event => {
        this.handleExternalActivity(event, 'ResetByRouter');
      });
    }

    this.registerServerTimeListener();

    this.restoreFromStorage();
    this.refreshDerivedDurations();
    this.refreshActivityCooldownRemaining();

    this.sharedStateCoordinator.updateConfig(this.configSignal());

    const persistedSharedState = this.sharedStateCoordinator.readPersistedState();
    if (persistedSharedState) {
      this.applySharedSessionState(persistedSharedState);
    } else {
      this.sharedStateCoordinator.requestSync('initial');
      Promise.resolve().then(() => this.broadcastCrossTab('sync-request'));
    }

    this.sharedStateCoordinator.updates$
      .pipe(takeUntil(this.destroy$))
      .subscribe(message => {
        this.zone.run(() => {
          if (message.type === 'state') {
            this.applySharedSessionState(message.state);
          } else if (message.type === 'request-sync') {
            this.broadcastSharedState({ crossTab: true });
          }
        });
      });

    this.destroyRef.onDestroy(() => {
      this.destroy$.next();
      this.destroy$.complete();
      this.stopTicker();
      this.eventsSubject.complete();
      this.activitySubject.complete();
      this.leaderWatcher?.destroy();
      this.leaderElection?.stepDown();
      this.teardownCrossTabChannel();
      this.crossTabSubject.complete();
      this.unregisterServerTimeListener();
      this.configWatcher.destroy();
      this.clearAllActionTimers();
    });
  }

  private registerServerTimeListener(): void {
    if (!this.serverTime || this.serverTimeListenerRegistered) {
      return;
    }
    const candidate = this.serverTime as unknown as ServerTimeListenerApi;
    if (typeof candidate.registerSyncListener === 'function') {
      candidate.registerSyncListener(this.handleServerSync);
      this.serverTimeListenerRegistered = true;
    }
  }

  private unregisterServerTimeListener(): void {
    if (!this.serverTime || !this.serverTimeListenerRegistered) {
      return;
    }
    const candidate = this.serverTime as unknown as ServerTimeListenerApi;
    if (typeof candidate.unregisterSyncListener === 'function') {
      candidate.unregisterSyncListener(this.handleServerSync);
    }
    this.serverTimeListenerRegistered = false;
  }

  start(): void {
    this.executeWithDelay('start', () => {
      const timestamp = this.timeSource.now();
      this.updateSnapshot({
        state: 'IDLE',
        idleStartAt: timestamp,
        countdownEndAt: null,
        lastActivityAt: timestamp,
        remainingMs: this.configSignal().countdownMs,
        paused: false
      });
      this.emitEvent('Started');
    });
  }

  stop(): void {
    this.executeWithDelay('stop', () => {
      this.updateSnapshot({
        state: 'IDLE',
        idleStartAt: null,
        countdownEndAt: null,
        remainingMs: this.configSignal().countdownMs,
        paused: false
      });
      this.emitEvent('Stopped');
    });
  }

  resetIdle(meta?: Record<string, unknown>, options?: { source?: ActivityEvent['source'] }): void {
    const source = options?.source ?? 'manual';
    const metaWithSource = { ...(meta ?? {}), activitySource: source };
    this.emitActivity(source, metaWithSource);
    this.executeWithDelay('resetIdle', () => {
      if (this.leaderElection?.isLeader() === false) {
        this.broadcastCrossTab('reset', { activitySource: source });
        return;
      }
      this.resetIdleInternal('ResetByActivity', metaWithSource);
    });
  }

  extend(meta?: Record<string, unknown>): void {
    this.executeWithDelay('extend', () => {
      if (this.snapshotSignal().state === 'EXPIRED') {
        return;
      }
      const timestamp = this.timeSource.now();
      const countdownEndAt = timestamp + this.configSignal().countdownMs;
      this.updateSnapshot({
        state: 'COUNTDOWN',
        countdownEndAt,
        remainingMs: Math.max(0, countdownEndAt - timestamp),
        paused: false
      });
      this.emitEvent('Extended', meta);
      this.broadcastCrossTab('extend', { snapshot: { ...this.snapshotSignal() } });
    });
  }

  private resetIdleInternal(eventType: SessionEvent['type'], meta?: Record<string, unknown>): void {
    const timestamp = this.timeSource.now();
    this.updateSnapshot({
      state: 'IDLE',
      idleStartAt: timestamp,
      countdownEndAt: null,
      lastActivityAt: timestamp,
      remainingMs: this.configSignal().countdownMs,
      paused: this.snapshotSignal().paused
    });
    this.emitEvent(eventType, meta);
  }

  expireNow(reason?: Record<string, unknown>): void {
    this.executeWithDelay('expire', () => {
      const timestamp = this.timeSource.now();
      this.updateSnapshot({
        state: 'EXPIRED',
        remainingMs: 0,
        countdownEndAt: timestamp,
        paused: false
      });
      this.emitEvent('Expired', reason);
      void this.runExpireHooks();
      this.broadcastCrossTab('expire', { snapshot: { ...this.snapshotSignal() }, reason });
    });
  }

  pause(): void {
    if (this.snapshotSignal().paused) {
      return;
    }
    this.executeWithDelay('pause', () => {
      if (this.snapshotSignal().paused) {
        return;
      }
      this.updateSnapshot({ paused: true });
      this.emitEvent('Paused');
    });
  }

  resume(): void {
    if (!this.snapshotSignal().paused) {
      return;
    }
    this.executeWithDelay('resume', () => {
      if (!this.snapshotSignal().paused) {
        return;
      }
      this.updateSnapshot({ paused: false });
      this.emitEvent('Resumed');
    });
  }

  setConfig(partial: SessionTimeoutPartialConfig): void {
    const base = this.configSignal();
    const { config, issues } = validateConfig({
      ...base,
      ...partial,
      httpActivity: {
        ...base.httpActivity,
        ...(partial.httpActivity ?? {})
      }
    });
    this.configSignal.set(config);

    this.lastAutoActivityResetAt = null;
    this.refreshDerivedDurations(undefined, config);
    this.refreshActivityCooldownRemaining(undefined, config);
    if (issues.length > 0) {
      issues.forEach(issue => this.logger.warn('Invalid config field: ' + issue.field + ' - ' + issue.message));
    }
    this.emitEvent('ConfigChanged', { issues });
    this.clearAllActionTimers();
    if (!this.isApplyingSharedState) {
      this.broadcastSharedState();
    }
  }

  registerOnExpireCallback(callback: (snapshot: SessionSnapshot) => void | Promise<void>): void {
    this.onExpireCallbacks.add(callback);
  }

  getSnapshot(): SessionSnapshot {
    return { ...this.snapshotSignal() };
  }

  getConfig(): SessionTimeoutConfig {
    return { ...this.configSignal() };
  }

  private restartTicker(pollingMs: number): void {
    this.stopTicker();
    if (pollingMs <= 0) {
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.tickerSub = interval(pollingMs)
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => {
          this.handleTick();
        });
    });
  }

  private stopTicker(): void {
    this.tickerSub?.unsubscribe();
    this.tickerSub = null;
  }

  private handleTick(): void {
    const config = this.configSignal();
    const timestamp = this.timeSource.now();
    this.refreshActivityCooldownRemaining(timestamp, config);

    const snapshot = this.snapshotSignal();

    if (snapshot.paused || snapshot.state === 'EXPIRED') {
      this.refreshDerivedDurations(timestamp, config);
      return;
    }

    if (snapshot.idleStartAt == null) {
      return;
    }

    if (snapshot.state === 'IDLE') {
      const elapsed = timestamp - snapshot.idleStartAt;
      if (elapsed >= config.idleGraceMs) {
        const countdownEndAt = timestamp + config.countdownMs;
        this.updateSnapshot({
          state: config.warnBeforeMs >= config.countdownMs ? 'WARN' : 'COUNTDOWN',
          countdownEndAt,
          remainingMs: Math.max(0, countdownEndAt - timestamp)
        });
        return;
      }
      const remainingToGraceEnd = Math.max(0, config.idleGraceMs - elapsed);
      this.updateSnapshot({ remainingMs: remainingToGraceEnd });
      return;
    }

    if (snapshot.countdownEndAt == null) {
      return;
    }

    const remaining = Math.max(0, snapshot.countdownEndAt - timestamp);

    if (remaining === 0) {
      this.updateSnapshot({ state: 'EXPIRED', remainingMs: 0 });
      this.emitEvent('Expired');
      this.broadcastCrossTab('expire', { snapshot: { ...this.snapshotSignal() } });
      void this.runExpireHooks();
      return;
    }

    if (remaining <= config.warnBeforeMs) {
      if (snapshot.state !== 'WARN') {
        this.updateSnapshot({ state: 'WARN', remainingMs: remaining });
        this.emitEvent('WarnShown');
      } else {
        this.updateSnapshot({ remainingMs: remaining });
      }
      return;
    }

    if (snapshot.state !== 'COUNTDOWN') {
      this.updateSnapshot({ state: 'COUNTDOWN', remainingMs: remaining });
    } else {
      this.updateSnapshot({ remainingMs: remaining });
    }
  }

  private handleExternalActivity(activity: ActivityEvent, eventType: SessionEvent['type']): void {
    const config = this.configSignal();
    const now = this.timeSource.now();
    if (config.activityResetCooldownMs > 0) {
      const lastAcceptedAt = this.lastAutoActivityResetAt;
      if (lastAcceptedAt != null && now - lastAcceptedAt < config.activityResetCooldownMs) {
        this.refreshActivityCooldownRemaining(now, config);
        return;
      }
    }

    const meta = {
      ...(activity.meta ?? {}),
      activitySource: activity.source,
      activityTimestamp: activity.at
    };
    this.emitActivity(activity.source, activity.meta);
    const snapshot = this.snapshotSignal();
    if (snapshot.paused && config.ignoreUserActivityWhenPaused) {
      return;
    }
    this.lastAutoActivityResetAt = now;
    this.refreshActivityCooldownRemaining(now, config);
    this.executeWithDelay('resetIdle', () => {
      if (this.leaderElection?.isLeader() === false) {
        this.broadcastCrossTab('reset', { activitySource: activity.source });
        return;
      }
      this.resetIdleInternal(eventType, meta);
    });
  }

  private setupCrossTabChannel(config: SessionTimeoutConfig): void {
    const namespace = config.appInstanceId ?? 'ng2-idle-timeout';
    const channelName = `${namespace}:${config.storageKeyPrefix}:session-timeout`;
    if (this.crossTabChannelName === channelName) {
      return;
    }

    this.teardownCrossTabChannel();

    const adapter = createBroadcastChannel(channelName);
    if (!adapter) {
      return;
    }

    adapter.subscribe(event => {
      const message = event?.data as CrossTabMessage | undefined;
      if (!message || typeof message !== 'object') {
        return;
      }
      this.zone.run(() => {
        this.handleCrossTabMessage(message);
      });
    });

    this.crossTabChannel = adapter;
    this.crossTabChannelName = channelName;
  }

  private teardownCrossTabChannel(): void {
    this.crossTabChannel?.close();
    this.crossTabChannel = null;
    this.crossTabChannelName = null;
  }

  private broadcastCrossTab(type: CrossTabMessageType, payload?: CrossTabMessage['payload']): void {
    if (!this.crossTabChannel || this.isHandlingCrossTabMessage) {
      return;
    }
    const message: CrossTabMessage = {
      sourceId: this.tabId,
      type,
      at: this.timeSource.now(),
      payload
    };
    try {
      this.crossTabChannel.publish(message);
    } catch (error) {
      this.logger.warn('Failed to broadcast cross-tab message', error);
    }
    this.crossTabSubject.next(message);
  }

  private executeWithDelay(action: ActionDelayKey, work: () => void): void {
    const delay = Math.max(0, this.configSignal().actionDelays[action] ?? 0);
    if (delay <= 0) {
      work();
      return;
    }

    this.clearActionTimer(action);

    this.zone.runOutsideAngular(() => {
      const handle = setTimeout(() => {
        this.zone.run(() => {
          work();
        });
        this.actionDelayTimers.delete(action);
      }, delay);
      this.actionDelayTimers.set(action, handle);
    });
  }

  private clearActionTimer(action: ActionDelayKey): void {
    const handle = this.actionDelayTimers.get(action);
    if (handle != null) {
      clearTimeout(handle);
      this.actionDelayTimers.delete(action);
    }
  }

  private clearAllActionTimers(): void {
    for (const [key, handle] of this.actionDelayTimers.entries()) {
      clearTimeout(handle);
      this.actionDelayTimers.delete(key);
    }
  }

  private handleCrossTabMessage(message: CrossTabMessage): void {
    if (!message || message.sourceId === this.tabId) {
      return;
    }

    this.crossTabSubject.next(message);
    this.isHandlingCrossTabMessage = true;

    try {
      switch (message.type) {
        case 'extend':
          this.applyCrossTabExtend(message);
          break;
        case 'expire':
          this.applyCrossTabExpire(message);
          break;
        case 'sync':
          this.applyCrossTabSync(message);
          break;
        case 'reset':
          this.applyCrossTabReset(message);
          break;
        case 'sync-request':
          this.handleSyncRequest(message);
          break;
        default:
          this.logger.warn('Unknown cross-tab message type', message);
      }
    } finally {
      this.isHandlingCrossTabMessage = false;
    }
  }

  private applyCrossTabExtend(message: CrossTabMessage): void {
    const snapshot = message.payload?.snapshot;
    if (snapshot) {
      this.updateSnapshot({
        state: snapshot.state,
        idleStartAt: snapshot.idleStartAt,
        countdownEndAt: snapshot.countdownEndAt,
        lastActivityAt: snapshot.lastActivityAt,
        remainingMs: snapshot.remainingMs,
        paused: snapshot.paused
      });
    } else {
      const timestamp = this.timeSource.now();
      const countdownEndAt = timestamp + this.configSignal().countdownMs;
      this.updateSnapshot({
        state: 'COUNTDOWN',
        countdownEndAt,
        remainingMs: Math.max(0, countdownEndAt - timestamp),
        paused: false
      });
    }

    this.emitEvent('Extended', { crossTab: true, sourceTabId: message.sourceId });
  }

  private applyCrossTabExpire(message: CrossTabMessage): void {
    const snapshot = message.payload?.snapshot;
    const countdownEndAt = snapshot?.countdownEndAt ?? this.timeSource.now();

    this.updateSnapshot({
      state: 'EXPIRED',
      remainingMs: 0,
      countdownEndAt,
      paused: false
    });

    this.emitEvent('Expired', {
      crossTab: true,
      sourceTabId: message.sourceId,
      reason: message.payload?.reason
    });
    void this.runExpireHooks();
  }

  private applyCrossTabReset(message: CrossTabMessage): void {
    const source = message.payload?.activitySource ?? 'cross-tab';
    this.resetIdleInternal('ResetByActivity', { crossTab: true, sourceTabId: message.sourceId, activitySource: source });
  }

  private applyCrossTabSync(message: CrossTabMessage): void {
    const sharedState = message.payload?.sharedState;
    if (sharedState) {
      this.applySharedSessionState(sharedState);
      return;
    }
    const snapshot = message.payload?.snapshot;
    if (!snapshot) {
      return;
    }

    this.updateSnapshot({
      state: snapshot.state,
      idleStartAt: snapshot.idleStartAt,
      countdownEndAt: snapshot.countdownEndAt,
      lastActivityAt: snapshot.lastActivityAt,
      remainingMs: snapshot.remainingMs,
      paused: snapshot.paused
    });
  }

  private applySharedSessionState(sharedState: SharedSessionState): void {
    this.isApplyingSharedState = true;
    try {
      const configPatch: SessionTimeoutPartialConfig = {
        idleGraceMs: sharedState.config.idleGraceMs,
        countdownMs: sharedState.config.countdownMs,
        warnBeforeMs: sharedState.config.warnBeforeMs,
        activityResetCooldownMs: sharedState.config.activityResetCooldownMs,
        storageKeyPrefix: sharedState.config.storageKeyPrefix,
        syncMode: sharedState.config.syncMode,
        resumeBehavior: sharedState.config.resumeBehavior,
        ignoreUserActivityWhenPaused: sharedState.config.ignoreUserActivityWhenPaused,
        allowManualExtendWhenExpired: sharedState.config.allowManualExtendWhenExpired
      };

      this.setConfig(configPatch);

      const snapshot = sharedState.snapshot;
      this.updateSnapshot({
        state: snapshot.state,
        idleStartAt: snapshot.idleStartAt,
        countdownEndAt: snapshot.countdownEndAt,
        lastActivityAt: snapshot.lastActivityAt,
        remainingMs: snapshot.remainingMs,
        paused: snapshot.paused
      });

      this.sharedStateCoordinator.publishState(sharedState, { persist: true, broadcast: false });
    } finally {
      this.isApplyingSharedState = false;
    }
  }

  private buildSharedSessionState(): SharedSessionState {
    const config = this.configSignal();
    const snapshot = this.snapshotSignal();
    const now = this.timeSource.now();
    const leaderId = this.leaderElection?.leaderId?.();
    const leaderInfo =
      config.syncMode === 'leader' && leaderId
        ? { id: leaderId, heartbeatAt: now, epoch: 0 }
        : null;

    return {
      version: SHARED_STATE_VERSION,
      updatedAt: now,
      syncMode: config.syncMode,
      leader: leaderInfo,
      snapshot: {
        state: snapshot.state,
        remainingMs: snapshot.remainingMs,
        idleStartAt: snapshot.idleStartAt,
        countdownEndAt: snapshot.countdownEndAt,
        lastActivityAt: snapshot.lastActivityAt,
        paused: snapshot.paused
      },
      config: {
        idleGraceMs: config.idleGraceMs,
        countdownMs: config.countdownMs,
        warnBeforeMs: config.warnBeforeMs,
        activityResetCooldownMs: config.activityResetCooldownMs,
        storageKeyPrefix: config.storageKeyPrefix,
        syncMode: config.syncMode,
        resumeBehavior: config.resumeBehavior,
        ignoreUserActivityWhenPaused: config.ignoreUserActivityWhenPaused,
        allowManualExtendWhenExpired: config.allowManualExtendWhenExpired
      }
    };
  }

  private broadcastSharedState(options?: { persist?: boolean; crossTab?: boolean }): void {
    if (this.isApplyingSharedState) {
      return;
    }
    const config = this.configSignal();
    if (config.syncMode === 'leader' && this.leaderElection?.isLeader() === false) {
      return;
    }

    const state = this.buildSharedSessionState();
    const persist = options?.persist ?? true;
    const crossTab = options?.crossTab ?? true;

    this.sharedStateCoordinator.publishState(state, { persist, broadcast: crossTab });
    if (crossTab) {
      const broadcast = () => this.broadcastCrossTab('sync', { sharedState: state });
      if (this.isHandlingCrossTabMessage) {
        if (typeof queueMicrotask === 'function') {
          queueMicrotask(broadcast);
        } else {
          Promise.resolve().then(broadcast);
        }
      } else {
        broadcast();
      }
    }
  }

  private handleSyncRequest(message: CrossTabMessage): void {
    const config = this.configSignal();
    if (config.syncMode === 'leader' && this.leaderElection?.isLeader() === false) {
      return;
    }
    this.broadcastSharedState();
  }
  private restoreFromStorage(): void {
    const initialConfig = this.configSignal();
    const persistedConfig = readPersistedConfig(this.storage, initialConfig.storageKeyPrefix);
    if (persistedConfig) {
      const mergedConfig = this.mergePersistedConfigWithProvided(persistedConfig);
      const { config, issues } = validateConfig(mergedConfig);
      if (issues.length > 0) {
        issues.forEach(issue => this.logger.warn('Persisted config issue: ' + issue.field + ' - ' + issue.message));
      }
      this.isRestoring = true;
      this.configSignal.set(config);
      this.lastAutoActivityResetAt = null;
      this.refreshActivityCooldownRemaining(undefined, config);
      this.isRestoring = false;
    }

    const snapshotData = readSnapshot(this.storage, this.configSignal().storageKeyPrefix);
    if (snapshotData) {
      this.applyPersistedSnapshot(snapshotData);
    }
  }

  private mergePersistedConfigWithProvided(persisted: SessionTimeoutConfig): SessionTimeoutPartialConfig {
    if (!this.providedConfig) {
      return persisted;
    }
    const { httpActivity, actionDelays, ...shallow } = this.providedConfig;
    return {
      ...persisted,
      ...shallow,
      httpActivity: {
        ...persisted.httpActivity,
        ...(httpActivity ?? {})
      },
      actionDelays: {
        ...persisted.actionDelays,
        ...(actionDelays ?? {})
      }
    };
  }

  private applyPersistedSnapshot(persisted: PersistedSnapshot): void {
    const config = this.configSignal();
    const now = this.timeSource.now();

    let state = persisted.state;
    const idleStartAt = persisted.idleStartAt;
    let countdownEndAt = persisted.countdownEndAt;
    let remainingMs = persisted.remainingMs;

    if (state === 'IDLE' && idleStartAt != null) {
      const elapsed = now - idleStartAt;
      if (elapsed >= config.idleGraceMs) {
        if (countdownEndAt == null) {
          countdownEndAt = idleStartAt + config.idleGraceMs + config.countdownMs;
        }
        const remaining = countdownEndAt - now;
        if (remaining <= 0) {
          state = 'EXPIRED';
          remainingMs = 0;
        } else {
          remainingMs = remaining;
          state = remaining <= config.warnBeforeMs ? 'WARN' : 'COUNTDOWN';
        }
      } else {
        remainingMs = Math.max(0, config.idleGraceMs - elapsed);
      }
    } else if (countdownEndAt != null) {
      const remaining = countdownEndAt - now;
      if (remaining <= 0) {
        state = 'EXPIRED';
        remainingMs = 0;
      } else {
        remainingMs = remaining;
        state = remaining <= config.warnBeforeMs ? 'WARN' : 'COUNTDOWN';
      }
    }

    const inferredCountdownEndAt = countdownEndAt ?? ((state === 'COUNTDOWN' || state === 'WARN') ? now + remainingMs : null);

    this.isRestoring = true;
    this.snapshotSignal.set({
      state,
      remainingMs: Math.max(0, remainingMs),
      warnBeforeMs: config.warnBeforeMs,
      countdownMs: config.countdownMs,
      idleGraceMs: config.idleGraceMs,
      idleStartAt,
      countdownEndAt: inferredCountdownEndAt,
      lastActivityAt: persisted.lastActivityAt,
      paused: persisted.paused
    });
    this.isRestoring = false;
    this.refreshDerivedDurations(now, config);
  }

  private refreshDerivedDurations(now?: number, config?: SessionTimeoutConfig): void {
    const effectiveConfig = config ?? this.configSignal();
    const timestamp = now ?? this.timeSource.now();
    const snapshot = this.snapshotSignal();

    if (snapshot.state === 'EXPIRED') {
      this.idleRemainingMsInternal.set(0);
      this.countdownRemainingMsInternal.set(0);
      this.totalRemainingMsInternal.set(0);
      return;
    }

    let idleRemaining = 0;
    if (snapshot.state === 'IDLE') {
      if (snapshot.paused) {
        idleRemaining = Math.max(0, Math.min(snapshot.remainingMs, effectiveConfig.idleGraceMs));
      } else if (snapshot.idleStartAt != null) {
        const elapsed = Math.max(0, timestamp - snapshot.idleStartAt);
        idleRemaining = Math.max(0, effectiveConfig.idleGraceMs - elapsed);
      } else {
        idleRemaining = effectiveConfig.idleGraceMs;
      }
    }

    let countdownRemaining = 0;
    if (snapshot.state === 'COUNTDOWN' || snapshot.state === 'WARN') {
      if (snapshot.paused) {
        countdownRemaining = Math.max(0, snapshot.remainingMs);
      } else if (snapshot.countdownEndAt != null) {
        countdownRemaining = Math.max(0, snapshot.countdownEndAt - timestamp);
      } else {
        countdownRemaining = Math.max(0, snapshot.remainingMs);
      }
    } else if (snapshot.state === 'IDLE') {
      countdownRemaining = effectiveConfig.countdownMs;
    }

    this.idleRemainingMsInternal.set(idleRemaining);
    this.countdownRemainingMsInternal.set(countdownRemaining);
    const totalRemaining = snapshot.state === 'IDLE' ? idleRemaining + countdownRemaining : countdownRemaining;
    this.totalRemainingMsInternal.set(Math.max(0, totalRemaining));
  }

  private refreshActivityCooldownRemaining(now?: number, config?: SessionTimeoutConfig): void {
    const effectiveConfig = config ?? this.configSignal();
    const timestamp = now ?? this.timeSource.now();

    let remaining = 0;
    if (effectiveConfig.activityResetCooldownMs > 0 && this.lastAutoActivityResetAt != null) {
      const elapsed = Math.max(0, timestamp - this.lastAutoActivityResetAt);
      remaining = Math.max(0, effectiveConfig.activityResetCooldownMs - elapsed);
      if (remaining === 0) {
        this.lastAutoActivityResetAt = null;
      }
    } else {
      remaining = 0;
    }

    this.activityCooldownRemainingMsInternal.set(remaining);
  }

  private syncLeaderState(): void {
    if (!this.leaderElection) {
      return;
    }
    const config = this.configSignal();
    const isLeader = this.leaderElection.isLeader();
    const leaderId = this.leaderElection.leaderId();
    const previous = this.leaderState;
    this.leaderState = isLeader;

    if (previous === null) {
      if (isLeader && config.syncMode === 'leader') {
        this.broadcastSharedState();
      }
      return;
    }

    if (previous === isLeader) {
      return;
    }

    if (isLeader) {
      this.emitEvent('LeaderElected', { leaderId });
      if (config.syncMode === 'leader') {
        this.broadcastSharedState();
      }
    } else {
      this.emitEvent('LeaderLost', { leaderId });
      if (config.syncMode === 'leader') {
        this.sharedStateCoordinator.requestSync('leader-changed');
        this.broadcastCrossTab('sync-request');
      }
    }
  }

  private updateSnapshot(partial: Partial<SessionSnapshot>): void {
    this.snapshotSignal.update(previous => {
      const next: SessionSnapshot = {
        ...previous,
        warnBeforeMs: this.configSignal().warnBeforeMs,
        countdownMs: this.configSignal().countdownMs,
        idleGraceMs: this.configSignal().idleGraceMs,
        ...partial
      };
      return next;
    });
    this.refreshDerivedDurations();
    if (!this.isRestoring) {
      persistSnapshot(this.storage, this.configSignal().storageKeyPrefix, this.snapshotSignal());
    }
    if (!this.isRestoring && !this.isApplyingSharedState) {
      this.broadcastSharedState();
    }
  }

  private emitEvent(type: SessionEvent['type'], meta?: Record<string, unknown>): void {
    const snapshot = this.snapshotSignal();
    const event: SessionEvent = {
      type,
      at: this.timeSource.now(),
      state: snapshot.state,
      snapshot,
      meta
    };
    this.logger.debug('Event: ' + type, event);
    this.eventsSubject.next(event);
  }

  private emitActivity(source: ActivityEvent['source'], meta?: Record<string, unknown>): void {
    const activity: ActivityEvent = {
      source,
      at: this.timeSource.now(),
      meta
    };
    this.activitySubject.next(activity);
    if (typeof this.hooks.onActivity === 'function') {
      try {
        this.hooks.onActivity(activity);
      } catch (error) {
        this.logger.error('Error executing onActivity hook', error);
      }
    }
  }

  private async runExpireHooks(): Promise<void> {
    const snapshot = this.snapshotSignal();
    const pending: Promise<void>[] = [];
    if (typeof this.hooks.onExpire === 'function') {
      try {
        const result = this.hooks.onExpire(snapshot);
        if (result instanceof Promise) {
          pending.push(result);
        }
      } catch (error) {
        this.logger.error('Error executing onExpire hook', error);
      }
    }

    this.onExpireCallbacks.forEach(callback => {
      try {
        const result = callback(snapshot);
        if (result instanceof Promise) {
          pending.push(result);
        }
      } catch (error) {
        this.logger.error('Error executing registered expire callback', error);
      }
    });

    if (pending.length > 0) {
      try {
        await Promise.allSettled(pending);
      } catch (error) {
        this.logger.error('Error awaiting expire callbacks', error);
      }
    }
  }
}







