import { createSessionTimeoutProviders } from 'ng2-idle-timeout';
import type { SessionSyncMode, SessionTimeoutPartialConfig } from 'ng2-idle-timeout';

export const defaultSessionTimeoutConfig: SessionTimeoutPartialConfig = {
  storageKeyPrefix: 'demo-experience',
  idleGraceMs: 5000,
  countdownMs: 15000,
  warnBeforeMs: 5000,
  syncMode: 'leader',
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

const PLAYGROUND_SYNC_MODE_STORAGE_KEY = 'experience-playground-sync-mode';

function readPreferredSyncMode(): SessionSyncMode | undefined {
  try {
    const globalRef = globalThis as unknown as { localStorage?: Storage };
    const raw = globalRef?.localStorage?.getItem(PLAYGROUND_SYNC_MODE_STORAGE_KEY) ?? null;
    if (raw === 'leader' || raw === 'distributed') {
      return raw;
    }
  } catch {
    // Ignore storage access issues and fall back to defaults.
  }
  return undefined;
}

function buildSessionTimeoutConfig(): SessionTimeoutPartialConfig {
  const preferredSyncMode = readPreferredSyncMode();

  const syncMode = preferredSyncMode ?? defaultSessionTimeoutConfig.syncMode ?? 'leader';
  const baseHttpActivity = defaultSessionTimeoutConfig.httpActivity;

  return {
    ...defaultSessionTimeoutConfig,
    syncMode,
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


