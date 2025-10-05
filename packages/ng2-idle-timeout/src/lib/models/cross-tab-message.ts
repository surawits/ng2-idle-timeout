import type { SessionSnapshot } from './session-state';
import type { SharedSessionState } from './session-shared-state';

export type CrossTabMessageType = 'extend' | 'expire' | 'sync' | 'reset' | 'sync-request';

export interface CrossTabMessage {
  sourceId: string;
  type: CrossTabMessageType;
  at: number;
  payload?: {
    snapshot?: SessionSnapshot;
    sharedState?: SharedSessionState;
    reason?: unknown;
    activitySource?: string;
  };
}
