import { APP_INITIALIZER, EnvironmentProviders, Injector, Optional, Provider, makeEnvironmentProviders } from '@angular/core';

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
  const initializerFactory = (
    injector: Injector,
    providedConfig: SessionTimeoutPartialConfig | null | undefined
  ) => () => {
    if (!providedConfig) {
      return;
    }
    const service = injector.get(SessionTimeoutService);
    service.setConfig(providedConfig);
  };

  return [
    {
      provide: SESSION_TIMEOUT_CONFIG,
      useFactory: factory
    },
    SessionTimeoutService,
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [Injector, [new Optional(), SESSION_TIMEOUT_CONFIG]],
      useFactory: initializerFactory
    }
  ];
}

export function provideSessionTimeout(
  config: SessionTimeoutConfigInput
): EnvironmentProviders {
  return makeEnvironmentProviders(createSessionTimeoutProviders(config));
}
