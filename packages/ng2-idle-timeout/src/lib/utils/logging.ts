import { inject } from '@angular/core';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { SESSION_TIMEOUT_CONFIG } from '../tokens/config.token';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

const levelRank: Record<Exclude<LogLevel, 'silent'>, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50
};

export interface Logger {
  trace(message: string, ...rest: unknown[]): void;
  debug(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

const prefix = '[ng2-idle-timeout]';

export function createLogger(config?: SessionTimeoutConfig): Logger {
  const cfg = config ?? inject(SESSION_TIMEOUT_CONFIG);
  const threshold = cfg.logging;

  if (threshold === 'silent') {
    return createNoopLogger();
  }

  const rank = levelRank[threshold] ?? levelRank.warn;

  return {
    trace: (message, ...rest) => {
      if (rank <= levelRank.trace) {
        console.trace(prefix + ' ' + message, ...rest);
      }
    },
    debug: (message, ...rest) => {
      if (rank <= levelRank.debug) {
        console.debug(prefix + ' ' + message, ...rest);
      }
    },
    info: (message, ...rest) => {
      if (rank <= levelRank.info) {
        console.info(prefix + ' ' + message, ...rest);
      }
    },
    warn: (message, ...rest) => {
      if (rank <= levelRank.warn) {
        console.warn(prefix + ' ' + message, ...rest);
      }
    },
    error: (message, ...rest) => {
      if (rank <= levelRank.error) {
        console.error(prefix + ' ' + message, ...rest);
      }
    }
  };
}

function createNoopLogger(): Logger {
  return {
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}
