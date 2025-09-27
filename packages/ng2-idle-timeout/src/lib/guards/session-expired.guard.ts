import { inject } from '@angular/core';
import type { CanActivateFn, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

import type { SessionTimeoutPartialConfig } from '../models/session-timeout-config';
import { SessionTimeoutService } from '../services/session-timeout.service';

export interface SessionTimeoutRouteConfig {
  config?: SessionTimeoutPartialConfig;
  allowWhenExpired?: boolean;
  autoResume?: boolean;
}

export const SESSION_TIMEOUT_ROUTE_KEY = 'sessionTimeout';

export const SessionExpiredGuard: CanActivateFn = (route: ActivatedRouteSnapshot, _state: RouterStateSnapshot) => {
  const sessionTimeout = inject(SessionTimeoutService);
  const override = route.data?.[SESSION_TIMEOUT_ROUTE_KEY] as SessionTimeoutRouteConfig | undefined;

  if (override?.config) {
    sessionTimeout.setConfig(override.config);
  }

  const snapshot = sessionTimeout.getSnapshot();

  if (override?.autoResume && snapshot.paused) {
    sessionTimeout.resume();
  }

  if (snapshot.state === 'EXPIRED' && !override?.allowWhenExpired) {
    return false;
  }

  return true;
};
