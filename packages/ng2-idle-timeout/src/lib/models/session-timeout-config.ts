import type { ActivityEvent } from './activity-event';

export type SessionTimeoutStrategy = 'userOnly' | 'userAndHttpAllowlist' | 'aggressive';

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

export interface SessionTimeoutConfig {
  idleGraceMs: number;
  countdownMs: number;
  warnBeforeMs: number;
  pollingMs: number;
  storageKeyPrefix: string;
  appInstanceId?: string;
  strategy: SessionTimeoutStrategy;
  httpActivity: HttpActivityPolicyConfig;
  openNewTabBehavior: 'inherit';
  routerCountsAsActivity: boolean;
  debounceMouseMs: number;
  debounceKeyMs: number;
  maxExtendPerSession: number;
  onExpire: 'emit' | 'callback' | string;
  timeSource: 'client' | 'server';
  serverTimeEndpoint?: string;
  logging: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
  ignoreUserActivityWhenPaused: boolean;
  allowManualExtendWhenExpired: boolean;
}

export type SessionTimeoutPartialConfig = Partial<SessionTimeoutConfig> & {
  httpActivity?: Partial<HttpActivityPolicyConfig>;
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
