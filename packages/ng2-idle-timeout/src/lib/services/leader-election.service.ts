import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';

interface LeaderRecord {
  id: string;
  updatedAt: number;
}

export const HEARTBEAT_INTERVAL_MS = 1500;
export const LEADER_TTL_MS = HEARTBEAT_INTERVAL_MS * 3;

@Injectable({ providedIn: 'root' })
export class LeaderElectionService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly providedConfig = inject(SESSION_TIMEOUT_CONFIG, { optional: true }) as
    | SessionTimeoutConfig
    | undefined;
  private readonly leaderSignal = signal<string | null>(null);
  private readonly tabId = generateLeaderId();
  private storageKey: string | null = null;
  private heartbeatTimer: number | null = null;
  private watchdogTimer: number | null = null;
  private storage: Storage | null = this.resolveStorage();
  private isDisposed = false;

  readonly leaderId = this.leaderSignal.asReadonly();
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
    if (!this.storage || !this.storageKey || this.isDisposed) {
      return;
    }
    this.evaluateLeadership();
  }

  electLeader(): void {
    this.evaluateLeadership();
  }

  stepDown(): void {
    if (!this.storage || !this.storageKey) {
      return;
    }

    if (this.leaderSignal() === this.tabId) {
      try {
        const record = this.readLeaderRecord();
        if (record?.id === this.tabId) {
          this.storage.removeItem(this.storageKey);
        }
      } catch (error) {
        console.warn('[ng2-idle-timeout] Unable to release leader record', error);
      }
    }

    this.stopHeartbeat();
    this.leaderSignal.set(null);
  }

  private initialize(): void {
    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });

    this.evaluateLeadership();
    this.startWatchdog();

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.handleStorageEvent);
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    }
  }

  private cleanup(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.stopHeartbeat();
    this.stopWatchdog();
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.handleStorageEvent);
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }
  }

  private readonly handleBeforeUnload = (): void => {
    this.stepDown();
  };

  private readonly handleStorageEvent = (event: StorageEvent): void => {
    if (!this.storageKey || event.key !== this.storageKey) {
      return;
    }

    this.zone.run(() => {
      if (event.newValue == null) {
        if (this.leaderSignal() !== this.tabId) {
          this.leaderSignal.set(null);
        }
        return;
      }

      try {
        const record = JSON.parse(event.newValue) as LeaderRecord;
        if (record.id === this.tabId) {
          this.ensureHeartbeat();
          this.leaderSignal.set(this.tabId);
        } else {
          const now = Date.now();
          if (now - record.updatedAt > LEADER_TTL_MS) {
            this.evaluateLeadership();
            return;
          }
          this.stopHeartbeat();
          this.leaderSignal.set(record.id);
        }
      } catch (error) {
        console.warn('[ng2-idle-timeout] Invalid leader record from storage', error);
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
    if (this.storage) {
      this.evaluateLeadership();
    }
  }

  private resolveStorage(): Storage | null {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      return window.localStorage;
    } catch (error) {
      console.warn('[ng2-idle-timeout] Leader election storage unavailable', error);
      return null;
    }
  }

  private evaluateLeadership(): void {
    if (!this.storage || !this.storageKey || this.isDisposed) {
      return;
    }

    const record = this.readLeaderRecord();
    const now = Date.now();

    if (record?.id === this.tabId) {
      this.leaderSignal.set(this.tabId);
      this.ensureHeartbeat();
      return;
    }

    if (!record || now - record.updatedAt > LEADER_TTL_MS ) {
      this.claimLeadership();
      return;
    }

    this.leaderSignal.set(record.id);
    this.stopHeartbeat();
  }

  private claimLeadership(): void {
    if (!this.storage || !this.storageKey || this.isDisposed) {
      return;
    }

    const record: LeaderRecord = {
      id: this.tabId,
      updatedAt: Date.now()
    };

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(record));
      this.leaderSignal.set(this.tabId);
      this.ensureHeartbeat();
    } catch (error) {
      console.warn('[ng2-idle-timeout] Unable to persist leader record', error);
    }
  }

  private readLeaderRecord(): LeaderRecord | null {
    if (!this.storage || !this.storageKey) {
      return null;
    }

    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as LeaderRecord;
    } catch (error) {
      console.warn('[ng2-idle-timeout] Unable to read leader record', error);
      return null;
    }
  }

  private startWatchdog(): void {
    if (!this.storage || this.watchdogTimer != null || typeof window === 'undefined') {
      return;
    }

    this.zone.runOutsideAngular(() => {
      this.watchdogTimer = window.setInterval(() => {
        this.zone.run(() => {
          this.evaluateLeadership();
        });
      }, HEARTBEAT_INTERVAL_MS);
    });
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer != null && typeof window !== 'undefined') {
      window.clearInterval(this.watchdogTimer);
    }
    this.watchdogTimer = null;
  }

  private startHeartbeat(): void {
    if (!this.storage || this.heartbeatTimer != null || typeof window === 'undefined') {
      return;
    }

    if (!this.isLeader()) {
      return;
    }

    this.zone.runOutsideAngular(() => {
      this.heartbeatTimer = window.setInterval(() => {
        this.zone.run(() => {
          this.touchLeaderRecord();
        });
      }, HEARTBEAT_INTERVAL_MS);
    });
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer == null) {
      this.startHeartbeat();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer != null && typeof window !== 'undefined') {
      window.clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = null;
  }

  private touchLeaderRecord(): void {
    if (!this.storage || !this.storageKey || this.isDisposed) {
      return;
    }

    if (this.leaderSignal() !== this.tabId) {
      this.stopHeartbeat();
      return;
    }

    const record: LeaderRecord = {
      id: this.tabId,
      updatedAt: Date.now()
    };

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(record));
    } catch (error) {
      console.warn('[ng2-idle-timeout] Unable to update leader heartbeat', error);
    }
  }
}

function generateLeaderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
