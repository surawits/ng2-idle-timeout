import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv();

/**
 * Mock Web Locks API for JSDOM environment.
 * Bridged with localStorage to support legacy tests that simulate 
 * remote leadership by writing to localStorage.
 */
if (typeof window !== 'undefined' && !window.navigator.locks) {
  Object.defineProperty(window.navigator, 'locks', {
    value: {
      request: jest.fn((name: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        
        // Try to find a corresponding leader record in localStorage
        const leaderKey = name.replace(':lock', '');
        const raw = localStorage.getItem(leaderKey);
        
        if (raw) {
          try {
            const record = JSON.parse(raw);
            const updatedAt = record.updatedAt || 0;
            const now = Date.now();
            
            // If there's a fresh record from another tab, simulate a held lock.
            // Using 4500ms which matches LEADER_TTL_MS in LeaderElectionService.
            if (record.id && (now - updatedAt) < 4500) {
              return new Promise(() => {
                // Pending forever to simulate another tab holding the lock
              });
            }
          } catch (e) {
            // ignore parse errors
          }
        }

        // Lock acquired
        return Promise.resolve(cb({ name }));
      }),
    },
    configurable: true,
    writable: true,
  });
}