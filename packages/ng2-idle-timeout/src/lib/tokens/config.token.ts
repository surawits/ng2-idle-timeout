import { InjectionToken } from '@angular/core';
import type { SessionTimeoutConfig, SessionTimeoutPartialConfig } from '../models/session-timeout-config';
import type { SessionTimeoutHooks } from '../models/session-timeout-config';

export interface SessionTimeoutProviderConfig {
  config?: SessionTimeoutPartialConfig;
  hooks?: SessionTimeoutHooks;
}

export const SESSION_TIMEOUT_CONFIG = new InjectionToken<SessionTimeoutConfig>('ng2-idle-timeout-config');

export const SESSION_TIMEOUT_HOOKS = new InjectionToken<SessionTimeoutHooks>('ng2-idle-timeout-hooks', {
  providedIn: 'root',
  factory: () => ({})
});
