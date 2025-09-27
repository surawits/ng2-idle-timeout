import { DestroyRef, Injectable, NgZone, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Subject } from 'rxjs';

import type { ActivityEvent } from '../models/activity-event';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';

@Injectable({ providedIn: 'root' })
export class ActivityDomService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly document = inject(DOCUMENT, { optional: true }) as Document | undefined;

  private readonly eventsSubject = new Subject<ActivityEvent>();
  readonly events$ = this.eventsSubject.asObservable();

  private config: SessionTimeoutConfig = DEFAULT_SESSION_TIMEOUT_CONFIG;
  private listenersAttached = false;
  private cleanupFns: Array<() => void> = [];
  private lastMouseEventAt = 0;
  private lastKeyEventAt = 0;

  updateConfig(config: SessionTimeoutConfig): void {
    this.config = config;
    this.ensureListeners();
  }

  private ensureListeners(): void {
    if (this.listenersAttached) {
      return;
    }
    const doc = this.document;
    if (!doc || typeof window === 'undefined') {
      return;
    }
    const win = doc.defaultView;
    if (!win) {
      return;
    }

    this.listenersAttached = true;
    this.cleanupFns = [];

    const register = (target: EventTarget, type: string, debounce: 'mouse' | 'key' | 'none' = 'none', options?: AddEventListenerOptions) => {
      const handler = (event: Event) => this.handleEvent(event, debounce);
      target.addEventListener(type, handler, options);
      this.cleanupFns.push(() => target.removeEventListener(type, handler, options));
    };

    this.zone.runOutsideAngular(() => {
      const optsPassive: AddEventListenerOptions = { passive: true };
      register(doc, 'click', 'mouse', optsPassive);
      register(doc, 'pointerdown', 'mouse', optsPassive);
      register(doc, 'pointerup', 'mouse', optsPassive);
      register(doc, 'mousemove', 'mouse', optsPassive);
      register(doc, 'wheel', 'mouse', optsPassive);
      register(doc, 'scroll', 'mouse', optsPassive);
      register(doc, 'touchstart', 'mouse', optsPassive);
      register(doc, 'touchend', 'mouse', optsPassive);
      register(doc, 'keydown', 'key');
      register(doc, 'keyup', 'key');
      register(doc, 'input', 'none');
      register(doc, 'visibilitychange', 'none');
      register(win, 'focus', 'none');
      register(win, 'blur', 'none');
    });

    this.destroyRef.onDestroy(() => {
      this.cleanupListeners();
    });
  }

  private handleEvent(event: Event, debounce: 'mouse' | 'key' | 'none'): void {
    if (!this.document) {
      return;
    }

    if (event.type === 'visibilitychange' && this.document.visibilityState !== 'visible') {
      return;
    }

    const now = Date.now();

    if (debounce === 'mouse') {
      if (now - this.lastMouseEventAt < this.config.debounceMouseMs) {
        return;
      }
      this.lastMouseEventAt = now;
    } else if (debounce === 'key') {
      if (now - this.lastKeyEventAt < this.config.debounceKeyMs) {
        return;
      }
      this.lastKeyEventAt = now;
    }

    if (this.document.visibilityState === 'hidden' && event.type !== 'visibilitychange') {
      return;
    }

    const meta: Record<string, unknown> = {
      type: event.type
    };

    if (typeof KeyboardEvent !== 'undefined' && event instanceof KeyboardEvent) {
      meta['key'] = event.key;
      meta['ctrlKey'] = event.ctrlKey;
      meta['shiftKey'] = event.shiftKey;
      meta['altKey'] = event.altKey;
    } else if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent) {
      meta['button'] = event.button;
      meta['clientX'] = Math.round(event.clientX);
      meta['clientY'] = Math.round(event.clientY);
    } else if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
      meta['touches'] = event.touches?.length ?? 0;
    } else if (typeof InputEvent !== 'undefined' && event instanceof InputEvent) {
      meta['inputType'] = event.inputType;
    }

    const target = event.target as Element | null;
    if (target instanceof Element) {
      meta['target'] = target.tagName.toLowerCase();
    }

    this.eventsSubject.next({
      source: 'dom',
      at: now,
      meta
    });
  }

  private cleanupListeners(): void {
    if (!this.listenersAttached) {
      return;
    }
    for (const cleanup of this.cleanupFns) {
      cleanup();
    }
    this.cleanupFns = [];
    this.listenersAttached = false;
  }
}
