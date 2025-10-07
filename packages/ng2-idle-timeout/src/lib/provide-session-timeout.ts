import { EnvironmentProviders, Provider, makeEnvironmentProviders } from '@angular/core';

import type { SessionTimeoutPartialConfig } from './models/session-timeout-config';
import { SESSION_TIMEOUT_CONFIG } from './tokens/config.token';
import { SessionTimeoutService } from './services/session-timeout.service';

export type SessionTimeoutConfigInput =
  | SessionTimeoutPartialConfig
  | (() => SessionTimeoutPartialConfig);

function resolveConfig(input: SessionTimeoutConfigInput): SessionTimeoutPartialConfig {
  return typeof input === 'function' ? input() : input;
}

export function createSessionTimeoutProviders(
  config: SessionTimeoutConfigInput
): Provider[] {
  const factory = () => resolveConfig(config);
  return [
    SessionTimeoutService,
    {
      provide: SESSION_TIMEOUT_CONFIG,
      useFactory: factory
    }
  ];
}

export function provideSessionTimeout(
  config: SessionTimeoutConfigInput
): EnvironmentProviders {
  return makeEnvironmentProviders(createSessionTimeoutProviders(config));
}

