import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Subject } from 'rxjs';
import { Router } from '@angular/router';
import type { Event as RouterEvent } from '@angular/router';

import { ActivityRouterService } from './activity-router.service';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';

class StubRouter {
  readonly events = new Subject<RouterEvent>();
}

describe('ActivityRouterService', () => {
  beforeAll(() => {
    try {
      TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
    } catch (error) {
      // environment may already be initialized in other specs
    }
  });

  let service: ActivityRouterService;
  let stubRouter: StubRouter;

  beforeEach(() => {
    stubRouter = new StubRouter();
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: stubRouter }]
    });
    service = TestBed.inject(ActivityRouterService);
  });

  it('emits events when router activity is enabled', () => {
    const events: string[] = [];
    service.events$.subscribe(activity => {
      events.push(activity.meta?.event as string);
    });

    service.updateConfig({ ...DEFAULT_SESSION_TIMEOUT_CONFIG, routerCountsAsActivity: true });

    const fakeEvent = { constructor: { name: 'NavigationEnd' } } as RouterEvent;
    stubRouter.events.next(fakeEvent);

    expect(events).toContain('NavigationEnd');
  });

  it('stops emitting when router activity is disabled', () => {
    const events: string[] = [];
    service.events$.subscribe(activity => {
      events.push(activity.meta?.event as string);
    });

    service.updateConfig({ ...DEFAULT_SESSION_TIMEOUT_CONFIG, routerCountsAsActivity: true });
    service.updateConfig({ ...DEFAULT_SESSION_TIMEOUT_CONFIG, routerCountsAsActivity: false });

    const fakeEvent = { constructor: { name: 'NavigationStart' } } as RouterEvent;
    stubRouter.events.next(fakeEvent);

    expect(events).toHaveLength(0);
  });
});
