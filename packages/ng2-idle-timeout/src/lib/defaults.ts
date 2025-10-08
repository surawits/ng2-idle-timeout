import type { SessionActionDelays, SessionTimeoutConfig, DomActivityEventName } from './models/session-timeout-config';

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

export const DEFAULT_ACTION_DELAYS = Object.freeze({
  start: 0,
  stop: 0,
  resetIdle: 0,
  extend: 0,
  pause: 0,
  resume: 0,
  expire: 0
} satisfies SessionActionDelays);

export const DEFAULT_DOM_ACTIVITY_EVENTS = Object.freeze([
  'mousedown',
  'click',
  'wheel',
  'scroll',
  'keydown',
  'keyup',
  'touchstart',
  'touchend',
  'visibilitychange'
] as const satisfies readonly DomActivityEventName[]);

export const DEFAULT_SESSION_TIMEOUT_CONFIG: SessionTimeoutConfig = {
  idleGraceMs: 120_000,
  countdownMs: 3_600_000,
  warnBeforeMs: 300_000,
  pollingMs: 500,
  activityResetCooldownMs: 0,
  storageKeyPrefix: 'ng2-idle-timeout',
  appInstanceId: undefined,
  syncMode: 'leader',
  strategy: 'userOnly',
  httpActivity: {
    ...DEFAULT_HTTP_ACTIVITY,
    strategy: 'allowlist'
  },
  actionDelays: {
    ...DEFAULT_ACTION_DELAYS
  },
  openNewTabBehavior: 'inherit',
  routerCountsAsActivity: true,
  domActivityEvents: DEFAULT_DOM_ACTIVITY_EVENTS,
  debounceMouseMs: 800,
  debounceKeyMs: 200,
  maxExtendPerSession: 0,
  onExpire: 'emit',
  timeSource: 'client',
  serverTimeEndpoint: undefined,
  logging: 'warn',
  resetOnWarningActivity: true,
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
    return {
      ...DEFAULT_SESSION_TIMEOUT_CONFIG,
      domActivityEvents: [...DEFAULT_SESSION_TIMEOUT_CONFIG.domActivityEvents]
    };
  }

  const { httpActivity, actionDelays, domActivityEvents, ...shallow } = partial;

  const mergedHttp = {
    ...DEFAULT_SESSION_TIMEOUT_CONFIG.httpActivity,
    ...(httpActivity ?? {})
  };

  const mergedDelays: SessionActionDelays = {
    ...DEFAULT_SESSION_TIMEOUT_CONFIG.actionDelays,
    ...(actionDelays ?? {})
  };

  const next: SessionTimeoutConfig = {
    ...DEFAULT_SESSION_TIMEOUT_CONFIG,
    ...shallow,
    httpActivity: {
      ...mergedHttp,
      allowlist: mergedHttp.allowlist ?? [],
      denylist: mergedHttp.denylist ?? []
    },
    actionDelays: mergedDelays,
    domActivityEvents: Array.isArray(domActivityEvents)
      ? [...domActivityEvents]
      : [...DEFAULT_SESSION_TIMEOUT_CONFIG.domActivityEvents]
  };

  return next;
}
