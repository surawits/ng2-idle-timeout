import type { SessionSnapshot } from './session-state';

export type CrossTabMessageType = 'extend' | 'expire' | 'sync' | 'reset';

export interface CrossTabMessage {
  sourceId: string;
  type: CrossTabMessageType;
  at: number;
  payload?: {
    snapshot?: SessionSnapshot;
    reason?: unknown;
    activitySource?: string;
  };
}
