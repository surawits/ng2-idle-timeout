import type { ActivityEvent } from './activity-event';

export type SessionTimeoutStrategy = 'userOnly' | 'userAndHttpAllowlist' | 'aggressive';

export type SessionSyncMode = 'leader' | 'distributed';

export const DOM_ACTIVITY_EVENT_NAMES = [
  'mousemove',
  'mousedown',
  'click',
  'wheel',
  'scroll',
  'keydown',
  'keyup',
  'touchstart',
  'touchend',
  'touchmove',
  'visibilitychange'
] as const;

export type DomActivityEventName = (typeof DOM_ACTIVITY_EVENT_NAMES)[number];

export interface HttpActivityPolicyConfig {
  enabled: boolean;
  strategy: 'allowlist' | 'headerFlag' | 'aggressive';
  allowlist: readonly RegExp[];
  denylist: readonly RegExp[];
  headerFlag?: string;
  contextToken?: string;
  ignoreOnInitMs: number;
  cooldownMs: number;
  onlyWhenTabFocused: boolean;
  primaryTabOnly: boolean;
}

export interface SessionActionDelays {
  start: number;
  stop: number;
  resetIdle: number;
  extend: number;
  pause: number;
  resume: number;
  expire: number;
}

export interface SessionTimeoutConfig {
  idleGraceMs: number;
  countdownMs: number;
  warnBeforeMs: number;
  pollingMs: number;
  activityResetCooldownMs: number;
  storageKeyPrefix: string;
  appInstanceId?: string;
  syncMode: SessionSyncMode;
  strategy: SessionTimeoutStrategy;
  httpActivity: HttpActivityPolicyConfig;
  actionDelays: SessionActionDelays;
  openNewTabBehavior: 'inherit';
  routerCountsAsActivity: boolean;
  domActivityEvents: readonly DomActivityEventName[];
  debounceMouseMs: number;
  debounceKeyMs: number;
  maxExtendPerSession: number;
  onExpire: 'emit' | 'callback' | string;
  timeSource: 'client' | 'server';
  serverTimeEndpoint?: string;
  logging: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
  resetOnWarningActivity: boolean;
  ignoreUserActivityWhenPaused: boolean;
  allowManualExtendWhenExpired: boolean;
  resumeBehavior?: 'manual' | 'autoOnServerSync';
}

export type SessionTimeoutPartialConfig = Partial<Omit<SessionTimeoutConfig, 'httpActivity' | 'actionDelays'>> & {
  httpActivity?: Partial<HttpActivityPolicyConfig>;
  actionDelays?: Partial<SessionActionDelays>;
};

export interface ExpireCallback {
  (snapshot: Readonly<SessionSnapshotLike>): void | Promise<void>;
}

export interface SessionSnapshotLike {
  state: 'IDLE' | 'COUNTDOWN' | 'WARN' | 'EXPIRED';
  remainingMs: number;
  idleStartAt: number | null;
  countdownEndAt: number | null;
  lastActivityAt: number | null;
}

export interface SessionTimeoutHooks {
  onExpire?: ExpireCallback;
  onActivity?: (activity: ActivityEvent) => void;
}
