import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { SessionTimeoutService } from '../services/session-timeout.service';

export const SessionExpiredGuard: CanActivateFn = () => {
  const sessionTimeout = inject(SessionTimeoutService);
  return sessionTimeout.getSnapshot().state !== 'EXPIRED';
};
