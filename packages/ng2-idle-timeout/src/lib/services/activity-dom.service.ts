import { DestroyRef, Injectable, NgZone, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Subject } from 'rxjs';

import type { ActivityEvent } from '../models/activity-event';
import type { SessionTimeoutConfig, DomActivityEventName } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';

type EventDebounce = 'mouse' | 'key' | 'none';

interface DomEventSpec {
  target: 'document' | 'window';
  debounce: EventDebounce;
  options?: AddEventListenerOptions;
}

const PASSIVE_EVENT_OPTIONS: AddEventListenerOptions = { passive: true };

const DOM_EVENT_SPECS: Record<DomActivityEventName, DomEventSpec> = {
  mousemove: { target: 'document', debounce: 'mouse', options: PASSIVE_EVENT_OPTIONS },
  mousedown: { target: 'document', debounce: 'mouse', options: PASSIVE_EVENT_OPTIONS },
  click: { target: 'document', debounce: 'mouse', options: PASSIVE_EVENT_OPTIONS },
  wheel: { target: 'document', debounce: 'mouse', options: PASSIVE_EVENT_OPTIONS },
  scroll: { target: 'document', debounce: 'mouse', options: PASSIVE_EVENT_OPTIONS },
  keydown: { target: 'document', debounce: 'key' },
  keyup: { target: 'document', debounce: 'key' },
  touchstart: { target: 'document', debounce: 'mouse', options: PASSIVE_EVENT_OPTIONS },
  touchend: { target: 'document', debounce: 'mouse', options: PASSIVE_EVENT_OPTIONS },
  touchmove: { target: 'document', debounce: 'mouse', options: PASSIVE_EVENT_OPTIONS },
  visibilitychange: { target: 'document', debounce: 'none' }
} as const;

@Injectable({ providedIn: 'root' })
export class ActivityDomService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly document = inject(DOCUMENT, { optional: true }) as Document | undefined;

  private readonly eventsSubject = new Subject<ActivityEvent>();
  readonly events$ = this.eventsSubject.asObservable();

  private config: SessionTimeoutConfig = DEFAULT_SESSION_TIMEOUT_CONFIG;
  private readonly listenerCleanupByEvent = new Map<DomActivityEventName, () => void>();
  private destroyHookRegistered = false;
  private lastMouseEventAt = 0;
  private lastKeyEventAt = 0;

  updateConfig(config: SessionTimeoutConfig): void {
    this.config = config;
    this.syncEventListeners();
  }

  private syncEventListeners(): void {
    const doc = this.document;
    if (!doc || typeof window === 'undefined') {
      this.cleanupListeners();
      return;
    }

    const win = doc.defaultView;
    if (!win) {
      this.cleanupListeners();
      return;
    }

    const desired = new Set(configuredEvents(this.config.domActivityEvents));

    for (const [eventName, cleanup] of this.listenerCleanupByEvent) {
      if (!desired.has(eventName)) {
        cleanup();
        this.listenerCleanupByEvent.delete(eventName);
      }
    }

    const toAdd: DomActivityEventName[] = [];
    for (const eventName of desired) {
      if (!this.listenerCleanupByEvent.has(eventName)) {
        toAdd.push(eventName);
      }
    }

    if (toAdd.length === 0) {
      this.ensureDestroyHook();
      return;
    }

    this.zone.runOutsideAngular(() => {
      for (const eventName of toAdd) {
        const spec = DOM_EVENT_SPECS[eventName];
        if (!spec) {
          continue;
        }
        const target = spec.target === 'window' ? win : doc;
        const handler = (event: Event) => this.handleEvent(event, spec.debounce);
        target.addEventListener(eventName, handler, spec.options);
        this.listenerCleanupByEvent.set(eventName, () => {
          target.removeEventListener(eventName, handler, spec.options);
        });
      }
    });

    this.ensureDestroyHook();
  }

  private ensureDestroyHook(): void {
    if (this.destroyHookRegistered) {
      return;
    }
    this.destroyRef.onDestroy(() => {
      this.cleanupListeners();
    });
    this.destroyHookRegistered = true;
  }

  private handleEvent(event: Event, debounce: EventDebounce): void {
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
    for (const [, cleanup] of this.listenerCleanupByEvent) {
      cleanup();
    }
    this.listenerCleanupByEvent.clear();
  }
}

function configuredEvents(events: readonly DomActivityEventName[] | undefined): readonly DomActivityEventName[] {
  if (!events) {
    return DEFAULT_SESSION_TIMEOUT_CONFIG.domActivityEvents;
  }
  return events;
}
