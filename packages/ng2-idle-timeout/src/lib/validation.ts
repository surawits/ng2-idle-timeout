import { DEFAULT_SESSION_TIMEOUT_CONFIG } from './defaults';
import {
  DOM_ACTIVITY_EVENT_NAMES,
  type DomActivityEventName,
  type SessionSyncMode,
  type SessionTimeoutConfig,
  type SessionTimeoutPartialConfig
} from './models/session-timeout-config';

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  config: SessionTimeoutConfig;
}

const DOM_ACTIVITY_EVENT_SET = new Set<string>(DOM_ACTIVITY_EVENT_NAMES);
const SYNC_MODE_SET = new Set<SessionSyncMode>(['leader', 'distributed']);

export function validateConfig(partial: SessionTimeoutPartialConfig | undefined): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { config, invalidDomActivityEvents, invalidSyncMode } = normalizeConfig(partial);

  if (config.idleGraceMs <= 0) {
    issues.push(createIssue('idleGraceMs', 'Value must be greater than 0'));
  }
  if (config.countdownMs <= 0) {
    issues.push(createIssue('countdownMs', 'Value must be greater than 0'));
  }
  if (config.warnBeforeMs < 0 || config.warnBeforeMs > config.countdownMs) {
    issues.push(createIssue('warnBeforeMs', 'Value must be between 0 and countdownMs inclusive'));
  }
  if (config.pollingMs <= 0) {
    issues.push(createIssue('pollingMs', 'Value must be greater than 0'));
  }
  if (config.activityResetCooldownMs < 0) {
    issues.push(createIssue('activityResetCooldownMs', 'Value must be >= 0'));
  }
  if (!config.storageKeyPrefix.trim()) {
    issues.push(createIssue('storageKeyPrefix', 'Prefix cannot be empty'));
  }
  if (config.maxExtendPerSession < 0) {
    issues.push(createIssue('maxExtendPerSession', 'Value must be >= 0'));
  }
  if (config.timeSource === 'server' && !config.serverTimeEndpoint) {
    issues.push(createIssue('serverTimeEndpoint', 'Required when timeSource is server'));
  }
  if (
    typeof config.onExpire === 'string' &&
    config.onExpire.startsWith('navigate:') &&
    config.onExpire.split(':').length < 2
  ) {
    issues.push(createIssue('onExpire', 'navigate: form requires target path'));
  }

  for (const [key, value] of Object.entries(config.actionDelays)) {
    if (value < 0) {
      issues.push(createIssue(`actionDelays.${key}`, 'Value must be >= 0'));
    }
  }

  if (invalidDomActivityEvents.length > 0) {
    issues.push(
      createIssue(
        'domActivityEvents',
        `Unsupported DOM events: ${invalidDomActivityEvents.join(', ')}`
      )
    );
  }

  if (invalidSyncMode) {
    issues.push(
      createIssue(
        'syncMode',
        `Unsupported syncMode: ${invalidSyncMode}. Allowed values: ${Array.from(SYNC_MODE_SET).join(', ')}`
      )
    );
  }

  return { issues, config };
}

interface NormalizedConfigResult {
  config: SessionTimeoutConfig;
  invalidDomActivityEvents: string[];
  invalidSyncMode: string | null;
}

function normalizeConfig(partial: SessionTimeoutPartialConfig | undefined): NormalizedConfigResult {
  const base: SessionTimeoutConfig = {
    ...DEFAULT_SESSION_TIMEOUT_CONFIG,
    domActivityEvents: [...DEFAULT_SESSION_TIMEOUT_CONFIG.domActivityEvents]
  };
  const { httpActivity, actionDelays, domActivityEvents, syncMode, ...shallow } = partial ?? {};

  const merged: SessionTimeoutConfig = {
    ...base,
    ...shallow,
    httpActivity: {
      ...base.httpActivity,
      ...(httpActivity ?? {})
    },
    actionDelays: {
      ...base.actionDelays,
      ...(actionDelays ?? {})
    },
    domActivityEvents: base.domActivityEvents
  };

  const invalidDomActivityEvents: string[] = [];
  let invalidSyncMode: string | null = null;

  if (syncMode === undefined) {
    merged.syncMode = base.syncMode;
  } else if (typeof syncMode === 'string' && SYNC_MODE_SET.has(syncMode as SessionSyncMode)) {
    merged.syncMode = syncMode as SessionSyncMode;
  } else {
    invalidSyncMode = syncMode === null ? 'null' : String(syncMode);
    merged.syncMode = base.syncMode;
  }

  if (Array.isArray(domActivityEvents)) {
    const deduped: DomActivityEventName[] = [];
    const seen = new Set<string>();
    for (const raw of domActivityEvents) {
      const candidate = String(raw);
      if (!DOM_ACTIVITY_EVENT_SET.has(candidate)) {
        invalidDomActivityEvents.push(candidate);
        continue;
      }
      if (!seen.has(candidate)) {
        seen.add(candidate);
        deduped.push(candidate as DomActivityEventName);
      }
    }
    merged.domActivityEvents = deduped;
  } else {
    merged.domActivityEvents = [...base.domActivityEvents];
  }

  merged.httpActivity.allowlist = [...(merged.httpActivity.allowlist ?? [])];
  merged.httpActivity.denylist = [...(merged.httpActivity.denylist ?? [])];

  return { config: merged, invalidDomActivityEvents, invalidSyncMode };
}

function createIssue(field: string, message: string): ValidationIssue {
  return { field, message };
}
