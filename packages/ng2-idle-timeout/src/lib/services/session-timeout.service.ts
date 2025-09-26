import { DestroyRef, Injectable, NgZone, computed, effect, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Subject, interval, takeUntil } from 'rxjs';
import type { Subscription } from 'rxjs';

import type { ActivityEvent } from '../models/activity-event';
import type { SessionEvent } from '../models/session-event';
import type { SessionSnapshot, SessionState } from '../models/session-state';
import type {
  SessionTimeoutConfig,
  SessionTimeoutHooks,
  SessionTimeoutPartialConfig
} from '../models/session-timeout-config';
import { SESSION_TIMEOUT_CONFIG, SESSION_TIMEOUT_HOOKS } from '../tokens/config.token';
import { createLogger, type Logger } from '../utils/logging';
import { TimeSourceService } from './time-source.service';
import { validateConfig } from '../validation';
import { ActivityDomService } from './activity-dom.service';
import { ActivityRouterService } from './activity-router.service';
import {
  createStorage,
  persistConfig,
  persistSnapshot,
  readPersistedConfig,
  readSnapshot,
  type PersistedSnapshot,
  type StorageAdapter
} from '../utils/storage';

@Injectable({ providedIn: 'root' })
export class SessionTimeoutService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly timeSource = inject(TimeSourceService);
  private readonly providedConfig = inject(SESSION_TIMEOUT_CONFIG, { optional: true });
  private readonly hooks = inject(SESSION_TIMEOUT_HOOKS, { optional: true }) ?? {} as SessionTimeoutHooks;
  private readonly domActivity = inject(ActivityDomService, { optional: true });
  private readonly routerActivity = inject(ActivityRouterService, { optional: true });
  private readonly storage: StorageAdapter = createStorage();
  private isRestoring = false;

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
  private readonly crossTabSubject = new Subject<unknown>();

  private readonly onExpireCallbacks = new Set<(snapshot: SessionSnapshot) => void | Promise<void>>();

  readonly stateSignal: Signal<SessionState> = computed(() => this.snapshotSignal().state);
  readonly remainingMsSignal: Signal<number> = computed(() => this.snapshotSignal().remainingMs);
  readonly isWarnSignal: Signal<boolean> = computed(() => this.snapshotSignal().state === 'WARN');
  readonly isExpiredSignal: Signal<boolean> = computed(() => this.snapshotSignal().state === 'EXPIRED');
  private readonly lastActivitySignal: Signal<number | null> = computed(() => this.snapshotSignal().lastActivityAt);
  private readonly countdownEndAtSignal: Signal<number | null> = computed(() => this.snapshotSignal().countdownEndAt);

  readonly state$ = toObservable(this.stateSignal);
  readonly remainingMs$ = toObservable(this.remainingMsSignal);
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
    if (!this.isRestoring) {
      persistConfig(this.storage, config.storageKeyPrefix, config);
    }
  });

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

    this.restoreFromStorage();

    this.destroyRef.onDestroy(() => {
      this.destroy$.next();
      this.destroy$.complete();
      this.stopTicker();
      this.eventsSubject.complete();
      this.activitySubject.complete();
      this.crossTabSubject.complete();
      this.configWatcher.destroy();
    });
  }

  start(): void {
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
  }

  stop(): void {
    this.updateSnapshot({
      state: 'IDLE',
      idleStartAt: null,
      countdownEndAt: null,
      remainingMs: this.configSignal().countdownMs,
      paused: false
    });
    this.emitEvent('Stopped');
  }

  resetIdle(meta?: Record<string, unknown>): void {
    this.emitActivity('manual', meta);
    this.resetIdleInternal('ResetByActivity', meta);
  }

  extend(meta?: Record<string, unknown>): void {
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
    const timestamp = this.timeSource.now();
    this.updateSnapshot({
      state: 'EXPIRED',
      remainingMs: 0,
      countdownEndAt: timestamp,
      paused: false
    });
    this.emitEvent('Expired', reason);
    void this.runExpireHooks();
  }

  pause(): void {
    if (this.snapshotSignal().paused) {
      return;
    }
    this.updateSnapshot({ paused: true });
    this.emitEvent('Paused');
  }

  resume(): void {
    if (!this.snapshotSignal().paused) {
      return;
    }
    this.updateSnapshot({ paused: false });
    this.emitEvent('Resumed');
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
    if (issues.length > 0) {
      issues.forEach(issue => this.logger.warn('Invalid config field: ' + issue.field + ' - ' + issue.message));
    }
    this.emitEvent('ConfigChanged', { issues });
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
    const snapshot = this.snapshotSignal();
    const config = this.configSignal();

    if (snapshot.paused || snapshot.state === 'EXPIRED') {
      return;
    }

    const timestamp = this.timeSource.now();

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
      void this.runExpireHooks();
      return;
    }

    if (remaining <= config.warnBeforeMs && snapshot.state !== 'WARN') {
      this.updateSnapshot({ state: 'WARN', remainingMs: remaining });
      this.emitEvent('WarnShown');
      return;
    }

    if (snapshot.state !== 'COUNTDOWN') {
      this.updateSnapshot({ state: 'COUNTDOWN', remainingMs: remaining });
    } else {
      this.updateSnapshot({ remainingMs: remaining });
    }
  }

  private handleExternalActivity(activity: ActivityEvent, eventType: SessionEvent['type']): void {
    const meta = {
      ...(activity.meta ?? {}),
      activitySource: activity.source,
      activityTimestamp: activity.at
    };
    this.emitActivity(activity.source, activity.meta);
    const snapshot = this.snapshotSignal();
    if (snapshot.paused && this.configSignal().ignoreUserActivityWhenPaused) {
      return;
    }
    this.resetIdleInternal(eventType, meta);
  }

  private restoreFromStorage(): void {
    const initialConfig = this.configSignal();
    const persistedConfig = readPersistedConfig(this.storage, initialConfig.storageKeyPrefix);
    if (persistedConfig) {
      const { config, issues } = validateConfig(persistedConfig);
      if (issues.length > 0) {
        issues.forEach(issue => this.logger.warn('Persisted config issue: ' + issue.field + ' - ' + issue.message));
      }
      this.isRestoring = true;
      this.configSignal.set(config);
      this.isRestoring = false;
    }

    const snapshotData = readSnapshot(this.storage, this.configSignal().storageKeyPrefix);
    if (snapshotData) {
      this.applyPersistedSnapshot(snapshotData);
    }
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
    if (!this.isRestoring) {
      persistSnapshot(this.storage, this.configSignal().storageKeyPrefix, this.snapshotSignal());
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
