import { DestroyRef, Injectable, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { Event as RouterEvent } from '@angular/router';
import { Subject } from 'rxjs';
import type { Subscription } from 'rxjs';

import type { ActivityEvent } from '../models/activity-event';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';

@Injectable({ providedIn: 'root' })
export class ActivityRouterService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly router = inject(Router, { optional: true });

  private readonly eventsSubject = new Subject<ActivityEvent>();
  readonly events$ = this.eventsSubject.asObservable();

  private subscription: Subscription | null = null;
  private config: SessionTimeoutConfig = DEFAULT_SESSION_TIMEOUT_CONFIG;

  updateConfig(config: SessionTimeoutConfig): void {
    this.config = config;
    if (!config.routerCountsAsActivity) {
      this.stopListening();
      return;
    }
    this.startListening();
  }

  private startListening(): void {
    if (this.subscription || !this.router) {
      return;
    }

    const subscribe = () =>
      this.router!.events.subscribe((event: RouterEvent) => {
        if (!this.config.routerCountsAsActivity) {
          return;
        }
        const now = Date.now();
        this.eventsSubject.next({
          source: 'router',
          at: now,
          meta: {
            event: event.constructor.name
          }
        });
      });

    this.subscription = this.zone.runOutsideAngular(subscribe);

    this.destroyRef.onDestroy(() => {
      this.stopListening();
    });
  }

  private stopListening(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
