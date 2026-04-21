import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';

import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';
import { LeaderElectionService, HEARTBEAT_INTERVAL_MS } from './leader-election.service';

const LEADER_KEY = 'testApp:test:leader';
const LOCK_NAME = 'testApp:test:leader:lock';

describe('LeaderElectionService (Web Locks)', () => {
  let service: LeaderElectionService;
  let mockLocks: any;
  
  const baseConfig: SessionTimeoutConfig = {
    ...DEFAULT_SESSION_TIMEOUT_CONFIG,
    storageKeyPrefix: 'test',
    appInstanceId: 'testApp',
    pollingMs: 50,
    timeSource: 'client',
  };

  beforeEach(() => {
    localStorage.clear();

    // Mock Navigator Locks
    mockLocks = {
      request: jest.fn()
    };
    
    Object.defineProperty(window.navigator, 'locks', {
      value: mockLocks,
      configurable: true,
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        LeaderElectionService,
        { provide: SESSION_TIMEOUT_CONFIG, useValue: baseConfig },
      ],
    });
  });

  afterEach(() => {
    // Ensure service is cleaned up to stop timers
    service?.stepDown();
    localStorage.clear();
  });

  function readRecord(): { id: string; updatedAt: number } | null {
    const raw = localStorage.getItem(LEADER_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  it('claims leadership immediately if lock is acquired', fakeAsync(() => {
    mockLocks.request.mockImplementation((name: string, options: any, callback: any) => {
      expect(name).toBe(LOCK_NAME);
      expect(options.mode).toBe('exclusive');
      // Simulate acquiring lock
      return callback({ name });
    });

    service = TestBed.inject(LeaderElectionService);
    tick(); // Process microtasks for lock acquisition

    expect(service.isLeader()).toBe(true);
    expect(readRecord()?.id).toBe(service.leaderId());
    
    service.stepDown();
    tick();
    discardPeriodicTasks();
  }));

  it('updates heartbeat while leader', fakeAsync(() => {
    mockLocks.request.mockImplementation((name: string, options: any, callback: any) => {
      // Hold lock indefinitely
      return new Promise<void>(resolve => {
         // Never resolve implies holding lock
         callback({ name });
      });
    });

    service = TestBed.inject(LeaderElectionService);
    tick(); // Acquire lock

    expect(service.isLeader()).toBe(true);
    const firstUpdate = readRecord()!.updatedAt;

    tick(HEARTBEAT_INTERVAL_MS + 10);

    const secondUpdate = readRecord()!.updatedAt;
    expect(secondUpdate).toBeGreaterThan(firstUpdate);
    
    service.stepDown();
    tick();
    discardPeriodicTasks(); // Ensure timers are gone
  }));

  it('remains follower if lock is pending (held by another)', fakeAsync(() => {
    // Simulate lock held by another tab -> request waits
    mockLocks.request.mockImplementation(() => {
      return new Promise(() => {}); // Pending forever
    });

    // Another tab writes to LS
    localStorage.setItem(LEADER_KEY, JSON.stringify({ id: 'other-tab', updatedAt: Date.now() }));

    service = TestBed.inject(LeaderElectionService);
    tick();

    // Start watchdog
    tick(HEARTBEAT_INTERVAL_MS);
    
    expect(service.isLeader()).toBe(false);
    // Should see the other tab from LS via watchdog
    expect(service.leaderId()).toBe('other-tab');
    
    service.stepDown();
    tick();
    discardPeriodicTasks();
  }));

  it('steps down releases the lock', fakeAsync(() => {
    let abortSignal: AbortSignal;
    
    mockLocks.request.mockImplementation((name: string, options: any, callback: any) => {
      abortSignal = options.signal;
      // Acquire lock
      return callback({ name });
    });

    service = TestBed.inject(LeaderElectionService);
    tick();
    
    expect(service.isLeader()).toBe(true);
    
    // Step down
    service.stepDown();
    tick();
    
    expect(service.isLeader()).toBe(false);
    expect(abortSignal!.aborted).toBe(true);
    // Should verify record is cleared (best effort)
    expect(readRecord()).toBeNull();
    discardPeriodicTasks();
  }));

  it('becomes leader if other tab releases lock', fakeAsync(() => {
    // Simulate lock queue
    let queue: Function[] = [];
    
    mockLocks.request.mockImplementation((name: string, options: any, callback: any) => {
      return new Promise<void>(resolve => {
         queue.push(() => callback({ name }).then(resolve));
      });
    });

    service = TestBed.inject(LeaderElectionService);
    tick();
    
    expect(service.isLeader()).toBe(false); // Pending in queue

    // Other tab was holding it, now it releases
    // In real life, the other tab's promise resolves. 
    // Here we manually trigger the callback for OUR request.
    const runCallback = queue[0];
    runCallback(); 
    
    tick(); // Process callback
    
    expect(service.isLeader()).toBe(true);
    
    service.stepDown();
    tick();
    discardPeriodicTasks();
  }));
});
