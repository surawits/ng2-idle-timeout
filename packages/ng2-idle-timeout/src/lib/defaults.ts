import type { SessionTimeoutConfig } from './models/session-timeout-config';

export const DEFAULT_HTTP_ACTIVITY = Object.freeze({
  enabled: true,
  strategy: 'allowlist',
  allowlist: [/\/(create|update|submit|checkout)/i],
  denylist: [/\/(metrics|prefetch|health|refresh-token)/i],
  ignoreOnInitMs: 3000,
  cooldownMs: 3000,
  onlyWhenTabFocused: true,
  primaryTabOnly: true
} as const);

export const DEFAULT_SESSION_TIMEOUT_CONFIG: SessionTimeoutConfig = {
  idleGraceMs: 120_000,
  countdownMs: 3_600_000,
  warnBeforeMs: 300_000,
  pollingMs: 500,
  storageKeyPrefix: 'ng2-idle-timeout',
  appInstanceId: undefined,
  strategy: 'userOnly',
  httpActivity: {
    ...DEFAULT_HTTP_ACTIVITY,
    strategy: 'allowlist'
  },
  openNewTabBehavior: 'inherit',
  routerCountsAsActivity: true,
  debounceMouseMs: 800,
  debounceKeyMs: 200,
  maxExtendPerSession: 0,
  onExpire: 'emit',
  timeSource: 'client',
  serverTimeEndpoint: undefined,
  logging: 'warn',
  ignoreUserActivityWhenPaused: false,
  allowManualExtendWhenExpired: false
};

export const DEFAULT_STORAGE_KEYS = Object.freeze({
  idleMetadata: 'session',
  countdown: 'countdown',
  config: 'config'
});

export function mergeConfig(partial: Partial<SessionTimeoutConfig> | undefined): SessionTimeoutConfig {
  if (!partial) {
    return { ...DEFAULT_SESSION_TIMEOUT_CONFIG };
  }

  const mergedHttp = {
    ...DEFAULT_SESSION_TIMEOUT_CONFIG.httpActivity,
    ...(partial.httpActivity ?? {})
  };

  const next: SessionTimeoutConfig = {
    ...DEFAULT_SESSION_TIMEOUT_CONFIG,
    ...partial,
    httpActivity: {
      ...mergedHttp,
      allowlist: mergedHttp.allowlist ?? [],
      denylist: mergedHttp.denylist ?? []
    }
  };

  return next;
}
