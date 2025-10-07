import { HttpClient } from '@angular/common/http';
import { Injectable, NgZone, inject } from '@angular/core';
import { catchError, of } from 'rxjs';
import type { Subscription } from 'rxjs';

import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { TimeSourceService } from './time-source.service';

interface ParsedServerTime {
  epochMs: number;
}

const MIN_SUCCESS_INTERVAL_MS = 60_000;
const DEFAULT_SUCCESS_INTERVAL_MS = 300_000;
const BASE_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class ServerTimeService {
  private readonly http = inject(HttpClient);
  private readonly timeSource = inject(TimeSourceService);
  private readonly zone = inject(NgZone);
  private readonly syncListeners = new Set<() => void>();

  private currentConfig: SessionTimeoutConfig | null = null;
  private endpoint: string | null = null;
  private retryAttempts = 0;
  private timerHandle: ReturnType<typeof globalThis.setTimeout> | null = null;
  private inFlight: Subscription | null = null;

  configure(config: SessionTimeoutConfig): void {
    this.currentConfig = config;
    if (config.timeSource !== 'server' || !config.serverTimeEndpoint) {
      this.stop(true);
      return;
    }

    if (this.endpoint !== config.serverTimeEndpoint) {
      this.endpoint = config.serverTimeEndpoint;
    }

    this.retryAttempts = 0;
    this.clearTimer();
    this.cancelInFlight();
    this.triggerSync(true);
  }

  stop(resetOffset = false): void {
    this.clearTimer();
    this.cancelInFlight();
    this.endpoint = null;
    this.retryAttempts = 0;
    if (resetOffset) {
      this.timeSource.resetOffset();
    }
  }

  private triggerSync(resetBackoff = false): void {
    if (!this.endpoint || this.inFlight) {
      return;
    }
    if (resetBackoff) {
      this.retryAttempts = 0;
    }
    this.fetchServerOffset();
  }

  private fetchServerOffset(): void {
    const endpoint = this.endpoint;
    if (!endpoint) {
      return;
    }

    const requestedAt = Date.now();
    this.inFlight = this.http.get<unknown>(endpoint).pipe(
      catchError(error => {
        this.handleFailure(error instanceof Error ? error : new Error(String(error)));
        return of(null);
      })
    ).subscribe(payload => {
      this.inFlight = null;
      if (payload === null) {
        return;
      }

      const parsed = this.parseServerTime(payload);
      if (!parsed) {
        this.handleFailure(new Error('Invalid server time payload'));
        return;
      }

      const roundTripOffset = parsed.epochMs - requestedAt;
      const nowOffset = parsed.epochMs - Date.now();
      // Average the offsets to account for one-way delay.
      const appliedOffset = Math.round((roundTripOffset + nowOffset) / 2);
      this.timeSource.setOffset(appliedOffset);
      this.notifySyncListeners();
      this.retryAttempts = 0;
      this.scheduleNextSuccess();
    });
  }

  private parseServerTime(payload: unknown): ParsedServerTime | null {
    if (typeof payload === 'number' && Number.isFinite(payload)) {
      return { epochMs: payload };
    }
    if (typeof payload === 'string') {
      const parsed = Date.parse(payload);
      if (!Number.isNaN(parsed)) {
        return { epochMs: parsed };
      }
      return null;
    }
    if (payload && typeof payload === 'object') {
      const asRecord = payload as Record<string, unknown>;
      const candidate = asRecord['epochMs'] ?? asRecord['epochMilliseconds'] ?? asRecord['timestamp'];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return { epochMs: candidate };
      }
      if (typeof candidate === 'string') {
        const parsed = Date.parse(candidate);
        if (!Number.isNaN(parsed)) {
          return { epochMs: parsed };
        }
      }
    }
    return null;
  }

  registerSyncListener(listener: () => void): void {
    this.syncListeners.add(listener);
  }

  unregisterSyncListener(listener: () => void): void {
    this.syncListeners.delete(listener);
  }

  private notifySyncListeners(): void {
    for (const listener of this.syncListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[ng2-idle-timeout] Error executing server sync listener', error);
      }
    }
  }

  private handleFailure(error: Error): void {
    console.warn('[ng2-idle-timeout] Unable to synchronise server time', error);
    this.retryAttempts += 1;
    const retryDelay = Math.min(
      BASE_RETRY_DELAY_MS * Math.pow(2, this.retryAttempts - 1),
      MAX_RETRY_DELAY_MS
    );
    this.scheduleNextRetry(retryDelay);
  }

  private scheduleNextRetry(delayMs: number): void {
    this.clearTimer();
    this.zone.runOutsideAngular(() => {
      this.timerHandle = globalThis.setTimeout(() => {
        this.zone.run(() => this.triggerSync());
      }, delayMs);
    });
  }

  private scheduleNextSuccess(): void {
    const interval = Math.max(
      MIN_SUCCESS_INTERVAL_MS,
      this.currentConfig?.pollingMs ?? DEFAULT_SUCCESS_INTERVAL_MS
    );
    this.clearTimer();
    this.zone.runOutsideAngular(() => {
      this.timerHandle = globalThis.setTimeout(() => {
        this.zone.run(() => this.triggerSync());
      }, interval);
    });
  }

  private cancelInFlight(): void {
    this.inFlight?.unsubscribe();
    this.inFlight = null;
  }

  private clearTimer(): void {
    if (this.timerHandle != null) {
      clearTimeout(this.timerHandle);
    }
    this.timerHandle = null;
  }
}

