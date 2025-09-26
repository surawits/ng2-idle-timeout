import { TestBed } from '@angular/core/testing';

import { ActivityDomService } from './activity-dom.service';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

describe('ActivityDomService', () => {
  let service: ActivityDomService;

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ActivityDomService);
    service.updateConfig(DEFAULT_SESSION_TIMEOUT_CONFIG);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits activity events for DOM interactions', async () => {
    const events: string[] = [];
    const sub = service.events$.subscribe(activity => {
      events.push(activity.meta?.type as string);
    });

    document.dispatchEvent(new Event('click'));
    await flushMicrotasks();

    expect(events).toContain('click');
    sub.unsubscribe();
  });

  it('debounces mouse events respecting configuration', async () => {
    const events: string[] = [];
    const sub = service.events$.subscribe(activity => {
      events.push(activity.meta?.type as string);
    });

    document.dispatchEvent(new Event('mousemove'));
    document.dispatchEvent(new Event('mousemove'));
    await flushMicrotasks();

    expect(events).toHaveLength(1);

    jest.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_CONFIG.debounceMouseMs + 5);
    document.dispatchEvent(new Event('mousemove'));
    await flushMicrotasks();

    expect(events.length).toBe(2);
    sub.unsubscribe();
  });
});
