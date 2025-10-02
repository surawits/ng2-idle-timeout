import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';

interface LeaderLeaseRecord {
  leaderId: string;
  leadershipEpoch: number;
  leaseUntil: number;
  heartbeatEveryMs: number;
  updatedAt: number;
  version: number;
}

const HEARTBEAT_INTERVAL_MS = 1_000;
const LEASE_EXTENSION_FACTOR = 4;
const LEASE_DURATION_MS = HEARTBEAT_INTERVAL_MS * LEASE_EXTENSION_FACTOR;
const SKEW_TOLERANCE_MS = 2_000;
const RETRY_BASE_DELAY_MS = 150;
const RETRY_JITTER_MS = 250;

@Injectable({ providedIn: 'root' })
export class LeaderElectionService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly providedConfig = inject(SESSION_TIMEOUT_CONFIG, { optional: true }) as
    | SessionTimeoutConfig
    | undefined;
  private readonly leaderSignal = signal<string | null>(null);
  private readonly epochSignal = signal<number>(0);
  private readonly tabId = generateLeaderId();
  private storageKey: string | null = null;
  private storage: Storage | null = this.resolveStorage();
  private heartbeatTimer: number | null = null;
  private watchdogTimer: number | null = null;
  private reacquireTimer: number | null = null;
  private disposed = false;

  readonly leaderId = this.leaderSignal.asReadonly();
  readonly leadershipEpoch = this.epochSignal.asReadonly();
  readonly isLeader = computed(() => this.leaderSignal() === this.tabId);
  readonly leader$ = toObservable(this.leaderId);
  readonly isLeader$ = toObservable(this.isLeader);

  constructor() {
    this.applyConfig(this.providedConfig);

    if (!this.storage || !this.storageKey) {
      return;
    }

    this.initialize();
  }

  updateConfig(config: SessionTimeoutConfig): void {
    this.applyConfig(config);
    if (!this.storage || !this.storageKey || this.disposed) {
      return;
    }
    this.evaluateLeadership('config-update');
  }

  electLeader(): void {
    this.evaluateLeadership('manual');
  }

  stepDown(): void {
    this.releaseLeadership(false);
  }

  private initialize(): void {
    this.destroyRef.onDestroy(() => this.cleanup());

    this.evaluateLeadership('init');
    this.startWatchdog();

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.handleStorageEvent);
      window.addEventListener('beforeunload', this.handleBeforeUnload);
      window.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private cleanup(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopHeartbeat();
    this.stopWatchdog();
    this.clearReacquireTimer();
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.handleStorageEvent);
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
      window.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private readonly handleBeforeUnload = (): void => {
    this.releaseLeadership(true);
  };

  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.evaluateLeadership('visibility');
    }
  };

  private readonly handleStorageEvent = (event: StorageEvent): void => {
    if (!this.storageKey || event.key !== this.storageKey) {
      return;
    }

    this.zone.run(() => {
      if (event.newValue == null) {
        this.syncWithRecord(null);
        return;
      }
      try {
        const record = JSON.parse(event.newValue) as LeaderLeaseRecord;
        this.syncWithRecord(record);
      } catch (error) {
        console.warn('[ng2-idle-timeout] Invalid leader record from storage', error);
        this.scheduleReacquire();
      }
    });
  };

  private applyConfig(config: SessionTimeoutConfig | undefined): void {
    const storageKeyPrefix = config?.storageKeyPrefix ?? 'ng2-idle-timeout';
    const appInstanceId = config?.appInstanceId ?? 'ng2-idle-timeout';
    const nextKey = `${appInstanceId}:${storageKeyPrefix}:leader`;

    if (this.storageKey === nextKey) {
      return;
    }

    this.storageKey = nextKey;
    if (this.storage && !this.disposed) {
      this.evaluateLeadership('config');
    }
  }

  private resolveStorage(): Storage | null {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const candidate = window.localStorage;
      candidate.setItem('__ng2_idle_probe__', '1');
      candidate.removeItem('__ng2_idle_probe__');
      return candidate;
    } catch (error) {
      console.warn('[ng2-idle-timeout] Leader election storage unavailable', error);
      return null;
    }
  }

  private evaluateLeadership(reason: string): void {
    if (!this.storage || !this.storageKey || this.disposed) {
      return;
    }

    const now = Date.now();
    const current = this.readLeaderRecord();

    if (current && current.leaderId === this.tabId && current.leaseUntil >= now) {
      this.syncWithRecord(current);
      return;
    }

    const leaseExpired = !current || now > current.leaseUntil + SKEW_TOLERANCE_MS;
    if (!leaseExpired) {
      this.syncWithRecord(current);
      return;
    }

    this.tryAcquire(current);
  }

  private tryAcquire(previous: LeaderLeaseRecord | null): void {
    if (!this.storage || !this.storageKey || this.disposed) {
      return;
    }

    const now = Date.now();
    const next: LeaderLeaseRecord = {
      leaderId: this.tabId,
      leadershipEpoch: (previous?.leadershipEpoch ?? 0) + 1,
      leaseUntil: now + LEASE_DURATION_MS,
      heartbeatEveryMs: HEARTBEAT_INTERVAL_MS,
      updatedAt: now,
      version: (previous?.version ?? 0) + 1
    };

    if (this.compareAndSwap(next, previous?.version ?? null)) {
      this.syncWithRecord(next);
      return;
    }

    this.scheduleReacquire();
  }

  private compareAndSwap(next: LeaderLeaseRecord, expectedVersion: number | null): boolean {
    if (!this.storage || !this.storageKey) {
      return false;
    }

    try {
      const raw = this.storage.getItem(this.storageKey);
      if (expectedVersion != null) {
        if (!raw) {
          return false;
        }
        try {
          const current = JSON.parse(raw) as LeaderLeaseRecord;
          if (current.version !== expectedVersion && current.leaderId !== this.tabId) {
            return false;
          }
        } catch (error) {
          console.warn('[ng2-idle-timeout] Failed to parse leader record for CAS', error);
          return false;
        }
      } else if (raw) {
        try {
          const current = JSON.parse(raw) as LeaderLeaseRecord;
          const now = Date.now();
          if (current.leaderId !== this.tabId && now <= current.leaseUntil + SKEW_TOLERANCE_MS) {
            return false;
          }
        } catch (error) {
          console.warn('[ng2-idle-timeout] Failed to parse leader record', error);
          return false;
        }
      }

      this.storage.setItem(this.storageKey, JSON.stringify(next));
      const committed = this.readLeaderRecord();
      return !!committed && committed.leaderId === next.leaderId && committed.leadershipEpoch === next.leadershipEpoch;
    } catch (error) {
      console.warn('[ng2-idle-timeout] Unable to persist leader record', error);
      return false;
    }
  }

  private readLeaderRecord(): LeaderLeaseRecord | null {
    if (!this.storage || !this.storageKey) {
      return null;
    }

    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as LeaderLeaseRecord;
    } catch (error) {
      console.warn('[ng2-idle-timeout] Unable to read leader record', error);
      return null;
    }
  }

  private syncWithRecord(record: LeaderLeaseRecord | null): void {
    if (record == null) {
      if (this.leaderSignal() !== null) {
        this.leaderSignal.set(null);
      }
      this.epochSignal.set(0);
      this.stopHeartbeat();
      this.scheduleReacquire();
      return;
    }

    this.epochSignal.set(record.leadershipEpoch);

    if (record.leaderId === this.tabId) {
      if (this.leaderSignal() !== this.tabId) {
        this.leaderSignal.set(this.tabId);
      }
      this.ensureHeartbeat();
      return;
    }

    this.stopHeartbeat();
    if (this.leaderSignal() !== record.leaderId) {
      this.leaderSignal.set(record.leaderId);
    }
    const now = Date.now();
    const delay = Math.max(HEARTBEAT_INTERVAL_MS, record.leaseUntil - now + SKEW_TOLERANCE_MS);
    this.scheduleReacquire(delay);
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer != null || typeof window === 'undefined') {
      return;
    }
    if (!this.isLeader()) {
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.heartbeatTimer = window.setInterval(() => {
        this.zone.run(() => {
          this.sendHeartbeat();
        });
      }, HEARTBEAT_INTERVAL_MS);
    });
  }

  private sendHeartbeat(): void {
    if (!this.storage || !this.storageKey) {
      return;
    }

    const current = this.readLeaderRecord();
    if (!current || current.leaderId !== this.tabId) {
      this.stopHeartbeat();
      this.scheduleReacquire();
      return;
    }

    const now = Date.now();
    const updated: LeaderLeaseRecord = {
      ...current,
      leaseUntil: now + LEASE_DURATION_MS,
      heartbeatEveryMs: HEARTBEAT_INTERVAL_MS,
      updatedAt: now,
      version: current.version + 1
    };

    if (!this.compareAndSwap(updated, current.version)) {
      this.stopHeartbeat();
      this.scheduleReacquire();
      return;
    }

    this.epochSignal.set(updated.leadershipEpoch);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer != null && typeof window !== 'undefined') {
      window.clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = null;
  }

  private startWatchdog(): void {
    if (this.watchdogTimer != null || typeof window === 'undefined') {
      return;
    }

    this.zone.runOutsideAngular(() => {
      this.watchdogTimer = window.setInterval(() => {
        this.zone.run(() => this.evaluateLeadership('watchdog'));
      }, HEARTBEAT_INTERVAL_MS);
    });
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer != null && typeof window !== 'undefined') {
      window.clearInterval(this.watchdogTimer);
    }
    this.watchdogTimer = null;
  }

  private scheduleReacquire(delay?: number): void {
    if (typeof window === 'undefined') {
      return;
    }

    const baseDelay = Math.max(RETRY_BASE_DELAY_MS, delay ?? HEARTBEAT_INTERVAL_MS);
    const jitter = Math.floor(Math.random() * RETRY_JITTER_MS);
    const targetDelay = baseDelay + jitter;

    this.clearReacquireTimer();

    this.zone.runOutsideAngular(() => {
      this.reacquireTimer = window.setTimeout(() => {
        this.reacquireTimer = null;
        this.zone.run(() => this.evaluateLeadership('retry'));
      }, targetDelay);
    });
  }

  private clearReacquireTimer(): void {
    if (this.reacquireTimer != null && typeof window !== 'undefined') {
      window.clearTimeout(this.reacquireTimer);
    }
    this.reacquireTimer = null;
  }

  private releaseLeadership(force: boolean): void {
    if (!this.storage || !this.storageKey) {
      return;
    }

    try {
      const record = this.readLeaderRecord();
      if (!record || record.leaderId !== this.tabId) {
        return;
      }

      if (force) {
        this.storage.removeItem(this.storageKey);
      } else {
        const now = Date.now();
        const updated: LeaderLeaseRecord = {
          ...record,
          leaseUntil: now,
          updatedAt: now,
          version: record.version + 1
        };
        this.storage.setItem(this.storageKey, JSON.stringify(updated));
      }
    } catch (error) {
      console.warn('[ng2-idle-timeout] Unable to release leader record', error);
    } finally {
      this.stopHeartbeat();
      this.leaderSignal.set(null);
      this.epochSignal.set(0);
    }
  }
}

function generateLeaderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
