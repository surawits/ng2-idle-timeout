import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';

import { ActivityDomService } from './activity-dom.service';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';
import {
  DOM_ACTIVITY_EVENT_NAMES,
  type DomActivityEventName,
  type SessionTimeoutConfig
} from '../models/session-timeout-config';

function buildConfig(overrides: Partial<SessionTimeoutConfig> = {}): SessionTimeoutConfig {
  const httpOverrides: Partial<SessionTimeoutConfig['httpActivity']> = overrides.httpActivity ?? {};
  const actionOverrides: Partial<SessionTimeoutConfig['actionDelays']> = overrides.actionDelays ?? {};
  const domEvents = overrides.domActivityEvents ?? DEFAULT_SESSION_TIMEOUT_CONFIG.domActivityEvents;

  return {
    ...DEFAULT_SESSION_TIMEOUT_CONFIG,
    ...overrides,
    httpActivity: {
      ...DEFAULT_SESSION_TIMEOUT_CONFIG.httpActivity,
      ...httpOverrides,
      allowlist: [...(httpOverrides.allowlist ?? DEFAULT_SESSION_TIMEOUT_CONFIG.httpActivity.allowlist)],
      denylist: [...(httpOverrides.denylist ?? DEFAULT_SESSION_TIMEOUT_CONFIG.httpActivity.denylist)]
    },
    actionDelays: {
      ...DEFAULT_SESSION_TIMEOUT_CONFIG.actionDelays,
      ...actionOverrides
    },
    domActivityEvents: [...domEvents]
  };
}

const MOUSE_EVENTS = new Set<DomActivityEventName>([
  'mousemove',
  'mousedown',
  'click',
  'wheel',
  'scroll',
  'touchstart',
  'touchend',
  'touchmove'
]);

const KEY_EVENTS = new Set<DomActivityEventName>(['keydown', 'keyup']);

function createSyntheticEvent(type: DomActivityEventName): Event {
  const eventInit: EventInit = { bubbles: true, cancelable: true };
  switch (type) {
    case 'mousemove':
    case 'mousedown':
    case 'click':
      return new MouseEvent(type, eventInit);
    case 'wheel':
      return typeof WheelEvent === 'function' ? new WheelEvent(type, eventInit) : new Event(type, eventInit);
    case 'scroll':
      return new Event(type, eventInit);
    case 'keydown':
    case 'keyup':
      return new KeyboardEvent(type, { bubbles: true, cancelable: true });
    case 'touchstart':
    case 'touchend':
    case 'touchmove':
      if (typeof TouchEvent === 'function') {
        return new TouchEvent(type, eventInit as unknown as TouchEventInit);
      }
      return new Event(type, eventInit);
    case 'visibilitychange':
      return new Event(type, eventInit);
    default:
      return new Event(type, eventInit);
  }
}

function getDebounceKind(eventName: DomActivityEventName): 'mouse' | 'key' | 'none' {
  if (MOUSE_EVENTS.has(eventName)) {
    return 'mouse';
  }
  if (KEY_EVENTS.has(eventName)) {
    return 'key';
  }
  return 'none';
}

describe('ActivityDomService', () => {
  beforeAll(() => {
    try {
      TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
    } catch (error) {
      // environment may already be initialized in other specs
    }
  });

  let service: ActivityDomService;
  let currentTime: number;

  beforeEach(() => {
    jest.useFakeTimers();
    currentTime = 0;
    jest.setSystemTime(currentTime);
    TestBed.configureTestingModule({});
    service = TestBed.inject(ActivityDomService);
    service.updateConfig(buildConfig());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function advanceTime(ms: number): void {
    currentTime += ms;
    jest.setSystemTime(currentTime);
    jest.advanceTimersByTime(ms);
  }

  function emitThroughHandle(eventName: DomActivityEventName): void {
    const debounce = getDebounceKind(eventName);
    const event = createSyntheticEvent(eventName);
    (service as unknown as { handleEvent(event: Event, debounce: 'mouse' | 'key' | 'none'): void }).handleEvent(
      event,
      debounce
    );
  }

  it('registers listeners matching the configured include list', () => {
    const listenerMap = (service as unknown as { listenerCleanupByEvent: Map<string, unknown> }).listenerCleanupByEvent;
    expect(new Set(listenerMap.keys())).toEqual(new Set(DEFAULT_SESSION_TIMEOUT_CONFIG.domActivityEvents));

    const customConfig = buildConfig({ domActivityEvents: ['mousemove', 'keydown', 'visibilitychange'] });
    service.updateConfig(customConfig);

    const afterUpdate = (service as unknown as { listenerCleanupByEvent: Map<string, unknown> }).listenerCleanupByEvent;
    expect(new Set(afterUpdate.keys())).toEqual(new Set(customConfig.domActivityEvents));
  });

  it('emits activity events for configured DOM names and respects debounce windows', () => {
    const events: string[] = [];
    const sub = service.events$.subscribe(activity => {
      events.push(activity.meta?.type as string);
    });

    for (const eventName of DOM_ACTIVITY_EVENT_NAMES) {
      service.updateConfig(buildConfig({ domActivityEvents: [eventName] }));
      events.length = 0;
      if (MOUSE_EVENTS.has(eventName)) {
        advanceTime(DEFAULT_SESSION_TIMEOUT_CONFIG.debounceMouseMs + 1);
      } else if (KEY_EVENTS.has(eventName)) {
        advanceTime(DEFAULT_SESSION_TIMEOUT_CONFIG.debounceKeyMs + 1);
      } else {
        advanceTime(1);
      }

      emitThroughHandle(eventName);
      expect(events).toEqual([eventName]);

      if (MOUSE_EVENTS.has(eventName)) {
        emitThroughHandle(eventName);
        expect(events).toEqual([eventName]);
        advanceTime(DEFAULT_SESSION_TIMEOUT_CONFIG.debounceMouseMs + 1);
        emitThroughHandle(eventName);
        expect(events).toEqual([eventName, eventName]);
      } else if (KEY_EVENTS.has(eventName)) {
        emitThroughHandle(eventName);
        expect(events).toEqual([eventName]);
        advanceTime(DEFAULT_SESSION_TIMEOUT_CONFIG.debounceKeyMs + 1);
        emitThroughHandle(eventName);
        expect(events).toEqual([eventName, eventName]);
      }
    }

    sub.unsubscribe();
  });

  it('reconfigures listeners without recreating the service instance', () => {
    const baseMap = (service as unknown as { listenerCleanupByEvent: Map<string, unknown> }).listenerCleanupByEvent;
    expect(baseMap.has('mousemove')).toBe(false);

    const enabledConfig = buildConfig({
      domActivityEvents: [...DEFAULT_SESSION_TIMEOUT_CONFIG.domActivityEvents, 'mousemove']
    });
    service.updateConfig(enabledConfig);

    const afterEnable = (service as unknown as { listenerCleanupByEvent: Map<string, unknown> }).listenerCleanupByEvent;
    expect(afterEnable.has('mousemove')).toBe(true);

    service.updateConfig(buildConfig());
    const afterDisable = (service as unknown as { listenerCleanupByEvent: Map<string, unknown> }).listenerCleanupByEvent;
    expect(afterDisable.has('mousemove')).toBe(false);
  });
});
