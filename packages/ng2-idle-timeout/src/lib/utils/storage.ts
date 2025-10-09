import { inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

import type { SessionSnapshot, SessionState } from '../models/session-state';
import type { SessionActionDelays, SessionTimeoutConfig, DomActivityEventName } from '../models/session-timeout-config';
import { DEFAULT_SESSION_TIMEOUT_CONFIG } from '../defaults';

export interface StorageAdapter {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export interface PersistedSnapshot {
  state: SessionState;
  idleStartAt: number | null;
  countdownEndAt: number | null;
  lastActivityAt: number | null;
  remainingMs: number;
  paused: boolean;
  updatedAt: number;
}

export interface PersistedConfig {
  version: 1;
  updatedAt: number;
  config: SerializedConfig;
}

interface SerializedConfig {
  idleGraceMs: number;
  countdownMs: number;
  warnBeforeMs: number;
  pollingMs: number;
  activityResetCooldownMs?: number;
  storageKeyPrefix: string;
  strategy: SessionTimeoutConfig['strategy'];
  httpActivity: SerializedHttpConfig;
  actionDelays?: Partial<SessionActionDelays>;
  openNewTabBehavior: SessionTimeoutConfig['openNewTabBehavior'];
  routerCountsAsActivity: boolean;
  domActivityEvents?: DomActivityEventName[];
  debounceMouseMs: number;
  debounceKeyMs: number;
  maxExtendPerSession: number;
  onExpire: SessionTimeoutConfig['onExpire'];
  timeSource: SessionTimeoutConfig['timeSource'];
  serverTimeEndpoint?: string;
  logging: SessionTimeoutConfig['logging'];
  resetOnWarningActivity: boolean;
  ignoreUserActivityWhenPaused: boolean;
  allowManualExtendWhenExpired: boolean;
}

interface SerializedHttpConfig {
  enabled: boolean;
  strategy: SessionTimeoutConfig['httpActivity']['strategy'];
  allowlist: Array<{ source: string; flags: string }>;
  denylist: Array<{ source: string; flags: string }>;
  headerFlag?: string;
  contextToken?: string;
  ignoreOnInitMs: number;
  cooldownMs: number;
  onlyWhenTabFocused: boolean;
  primaryTabOnly: boolean;
}

export function createStorage(): StorageAdapter {
  const doc = inject(DOCUMENT, { optional: true });
  if (!doc || typeof window === 'undefined') {
    return createNoopStorage();
  }
  try {
    const storage = window.localStorage;
    storage.setItem('__ng2_idle_probing__', '1');
    storage.removeItem('__ng2_idle_probing__');
    return {
      read: key => storage.getItem(key),
      write: (key, value) => storage.setItem(key, value),
      remove: key => storage.removeItem(key)
    };
  } catch (err) {
    console.warn('[ng2-idle-timeout] Falling back to noop storage due to error', err);
    return createNoopStorage();
  }
}

function createNoopStorage(): StorageAdapter {
  const memory = new Map<string, string>();
  return {
    read: key => memory.get(key) ?? null,
    write: (key, value) => memory.set(key, value),
    remove: key => memory.delete(key)
  };
}

export function persistSnapshot(adapter: StorageAdapter, prefix: string, snapshot: SessionSnapshot): void {
  try {
    const payload: PersistedSnapshot = {
      state: snapshot.state,
      idleStartAt: snapshot.idleStartAt,
      countdownEndAt: snapshot.countdownEndAt,
      lastActivityAt: snapshot.lastActivityAt,
      remainingMs: snapshot.remainingMs,
      paused: snapshot.paused,
      updatedAt: Date.now()
    };
    adapter.write(`${prefix}:snapshot`, JSON.stringify(payload));
  } catch (error) {
    console.warn('[ng2-idle-timeout] Unable to persist snapshot', error);
  }
}

export function readSnapshot(adapter: StorageAdapter, prefix: string): PersistedSnapshot | null {
  try {
    const raw = adapter.read(`${prefix}:snapshot`);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as PersistedSnapshot;
  } catch (error) {
    console.warn('[ng2-idle-timeout] Unable to read snapshot', error);
    return null;
  }
}

export function clearSnapshot(adapter: StorageAdapter, prefix: string): void {
  try {
    adapter.remove(`${prefix}:snapshot`);
  } catch (error) {
    console.warn('[ng2-idle-timeout] Unable to clear snapshot', error);
  }
}

export function persistConfig(adapter: StorageAdapter, prefix: string, config: SessionTimeoutConfig): void {
  try {
    const payload: PersistedConfig = {
      version: 1,
      updatedAt: Date.now(),
      config: serializeConfig(config)
    };
    adapter.write(`${prefix}:config`, JSON.stringify(payload));
  } catch (error) {
    console.warn('[ng2-idle-timeout] Unable to persist config', error);
  }
}

export function readPersistedConfig(adapter: StorageAdapter, prefix: string): SessionTimeoutConfig | null {
  try {
    const raw = adapter.read(`${prefix}:config`);
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw) as PersistedConfig;
    if (payload.version !== 1) {
      return null;
    }
    return deserializeConfig(payload.config);
  } catch (error) {
    console.warn('[ng2-idle-timeout] Unable to read persisted config', error);
    return null;
  }
}

function serializeConfig(config: SessionTimeoutConfig): SerializedConfig {
  return {
    idleGraceMs: config.idleGraceMs,
    countdownMs: config.countdownMs,
    warnBeforeMs: config.warnBeforeMs,
    pollingMs: config.pollingMs,
    activityResetCooldownMs: config.activityResetCooldownMs,
    storageKeyPrefix: config.storageKeyPrefix,
    strategy: config.strategy,
    httpActivity: serializeHttpConfig(config.httpActivity),
    actionDelays: { ...config.actionDelays },
    openNewTabBehavior: config.openNewTabBehavior,
    routerCountsAsActivity: config.routerCountsAsActivity,
    domActivityEvents: [...config.domActivityEvents],
    debounceMouseMs: config.debounceMouseMs,
    debounceKeyMs: config.debounceKeyMs,
    maxExtendPerSession: config.maxExtendPerSession,
    onExpire: config.onExpire,
    timeSource: config.timeSource,
    serverTimeEndpoint: config.serverTimeEndpoint,
    logging: config.logging,
    resetOnWarningActivity: config.resetOnWarningActivity,
    ignoreUserActivityWhenPaused: config.ignoreUserActivityWhenPaused,
    allowManualExtendWhenExpired: config.allowManualExtendWhenExpired
  };
}

function serializeHttpConfig(config: SessionTimeoutConfig['httpActivity']): SerializedHttpConfig {
  return {
    enabled: config.enabled,
    strategy: config.strategy,
    allowlist: config.allowlist.map(serializeRegExp),
    denylist: config.denylist.map(serializeRegExp),
    headerFlag: config.headerFlag,
    contextToken: config.contextToken,
    ignoreOnInitMs: config.ignoreOnInitMs,
    cooldownMs: config.cooldownMs,
    onlyWhenTabFocused: config.onlyWhenTabFocused,
    primaryTabOnly: config.primaryTabOnly
  };
}

function serializeRegExp(value: RegExp): { source: string; flags: string } {
  return { source: value.source, flags: value.flags };
}

function deserializeConfig(serialized: SerializedConfig): SessionTimeoutConfig {
  const mergedDelays: SessionActionDelays = {
    ...DEFAULT_SESSION_TIMEOUT_CONFIG.actionDelays,
    ...(serialized.actionDelays ?? {})
  };

  return {
    idleGraceMs: serialized.idleGraceMs,
    countdownMs: serialized.countdownMs,
    warnBeforeMs: serialized.warnBeforeMs,
    pollingMs: serialized.pollingMs,
    activityResetCooldownMs: serialized.activityResetCooldownMs ?? DEFAULT_SESSION_TIMEOUT_CONFIG.activityResetCooldownMs,
    storageKeyPrefix: serialized.storageKeyPrefix,
    appInstanceId: undefined,
    strategy: serialized.strategy,
    httpActivity: deserializeHttpConfig(serialized.httpActivity),
    actionDelays: mergedDelays,
    openNewTabBehavior: serialized.openNewTabBehavior,
    routerCountsAsActivity: serialized.routerCountsAsActivity,
    domActivityEvents: [...(serialized.domActivityEvents ?? DEFAULT_SESSION_TIMEOUT_CONFIG.domActivityEvents)],
    debounceMouseMs: serialized.debounceMouseMs,
    debounceKeyMs: serialized.debounceKeyMs,
    maxExtendPerSession: serialized.maxExtendPerSession,
    onExpire: serialized.onExpire,
    timeSource: serialized.timeSource,
    serverTimeEndpoint: serialized.serverTimeEndpoint,
    logging: serialized.logging,
    resetOnWarningActivity: serialized.resetOnWarningActivity ?? DEFAULT_SESSION_TIMEOUT_CONFIG.resetOnWarningActivity,
    ignoreUserActivityWhenPaused: serialized.ignoreUserActivityWhenPaused,
    allowManualExtendWhenExpired: serialized.allowManualExtendWhenExpired
  };
}

function deserializeHttpConfig(serialized: SerializedHttpConfig): SessionTimeoutConfig['httpActivity'] {
  return {
    enabled: serialized.enabled,
    strategy: serialized.strategy,
    allowlist: serialized.allowlist.map(reviveRegExp),
    denylist: serialized.denylist.map(reviveRegExp),
    headerFlag: serialized.headerFlag,
    contextToken: serialized.contextToken,
    ignoreOnInitMs: serialized.ignoreOnInitMs,
    cooldownMs: serialized.cooldownMs,
    onlyWhenTabFocused: serialized.onlyWhenTabFocused,
    primaryTabOnly: serialized.primaryTabOnly
  };
}

function reviveRegExp(serialized: { source: string; flags: string }): RegExp {
  try {
    return new RegExp(serialized.source, serialized.flags);
  } catch (error) {
    console.warn('[ng2-idle-timeout] Failed to revive RegExp from storage', error);
    return new RegExp(serialized.source);
  }
}





