import { createSessionTimeoutProviders } from 'ng2-idle-timeout';
import type { SessionTimeoutPartialConfig } from 'ng2-idle-timeout';

export const defaultSessionTimeoutConfig: SessionTimeoutPartialConfig = {
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

function buildSessionTimeoutConfig(): SessionTimeoutPartialConfig {
  const baseHttpActivity = defaultSessionTimeoutConfig.httpActivity;

  return {
    ...defaultSessionTimeoutConfig,
    httpActivity: baseHttpActivity
      ? {
          ...baseHttpActivity,
          allowlist: baseHttpActivity.allowlist ? [...baseHttpActivity.allowlist] : undefined,
          denylist: baseHttpActivity.denylist ? [...baseHttpActivity.denylist] : undefined
        }
      : undefined
  };
}

export const experienceSessionTimeoutProviders = createSessionTimeoutProviders(buildSessionTimeoutConfig);


