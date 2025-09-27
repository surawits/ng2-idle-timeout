import { SESSION_TIMEOUT_CONFIG, SessionTimeoutService } from 'ng2-idle-timeout';
import type { SessionTimeoutPartialConfig } from 'ng2-idle-timeout';

const defaultSessionTimeoutConfig: SessionTimeoutPartialConfig = {
  storageKeyPrefix: 'demo-experience',
  idleGraceMs: 5000,
  countdownMs: 15000,
  warnBeforeMs: 5000,
  resumeBehavior: 'autoOnServerSync',
  activityResetCooldownMs: 5000,
  httpActivity: {
    enabled: true,
    strategy: 'allowlist',
    allowlist: [/\/api\/demo/],
    denylist: [],
    ignoreOnInitMs: 0,
    cooldownMs: 0,
    onlyWhenTabFocused: false,
    primaryTabOnly: false
  }
};

export const experienceSessionTimeoutProviders = [
  SessionTimeoutService,
  {
    provide: SESSION_TIMEOUT_CONFIG,
    useValue: defaultSessionTimeoutConfig
  }
];


