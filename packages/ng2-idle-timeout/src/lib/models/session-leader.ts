import type { LeaderInfo } from './session-shared-state';

export type SessionLeaderRole = 'leader' | 'follower' | 'unknown';

export interface SessionLeaderState {
  role: SessionLeaderRole;
  leader: LeaderInfo | null;
  leaderId: string | null;
}

