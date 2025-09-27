import { DEFAULT_SESSION_TIMEOUT_CONFIG } from './defaults';
import type { SessionTimeoutConfig, SessionTimeoutPartialConfig } from './models/session-timeout-config';

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  config: SessionTimeoutConfig;
}

export function validateConfig(partial: SessionTimeoutPartialConfig | undefined): ValidationResult {
  const issues: ValidationIssue[] = [];
  const config = normalizeConfig(partial);

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
  if (typeof config.onExpire === 'string' && config.onExpire.startsWith('navigate:') && config.onExpire.split(':').length < 2) {
    issues.push(createIssue('onExpire', 'navigate: form requires target path')); // Fallback guard
  }

  for (const [key, value] of Object.entries(config.actionDelays)) {
    if (value < 0) {
      issues.push(createIssue(`actionDelays.${key}`, 'Value must be >= 0'));
    }
  }

  return { issues, config };
}

function normalizeConfig(partial: SessionTimeoutPartialConfig | undefined): SessionTimeoutConfig {
  const base = { ...DEFAULT_SESSION_TIMEOUT_CONFIG };
  const { httpActivity, actionDelays, ...shallow } = partial ?? {};

  const merged = {
    ...base,
    ...shallow,
    httpActivity: {
      ...base.httpActivity,
      ...(httpActivity ?? {})
    },
    actionDelays: {
      ...base.actionDelays,
      ...(actionDelays ?? {})
    }
  };

  merged.httpActivity.allowlist = [...(merged.httpActivity.allowlist ?? [])];
  merged.httpActivity.denylist = [...(merged.httpActivity.denylist ?? [])];

  return merged;
}

function createIssue(field: string, message: string): ValidationIssue {
  return { field, message };
}
