import type { SessionSnapshot, SessionState } from './session-state';

export type SessionEventType =
  | 'Started'
  | 'WarnShown'
  | 'Extended'
  | 'Expired'
  | 'Stopped'
  | 'ResetByActivity'
  | 'ResetByHttp'
  | 'ResetByRouter'
  | 'Paused'
  | 'Resumed'
  | 'ConfigChanged'
  | 'LeaderElected'
  | 'LeaderLost';

export interface SessionEvent {
  type: SessionEventType;
  at: number;
  state: SessionState;
  snapshot: SessionSnapshot;
  meta?: Record<string, unknown>;
}
