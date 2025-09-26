import type { SessionSnapshot } from './session-state';

export type CrossTabMessageType = 'extend' | 'expire' | 'sync';

export interface CrossTabMessage {
  type: CrossTabMessageType;
  at: number;
  payload?: {
    snapshot?: SessionSnapshot;
    reason?: string;
    activitySource?: string;
  };
}
