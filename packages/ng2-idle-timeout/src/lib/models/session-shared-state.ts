import type { SessionSyncMode } from './session-timeout-config';
import type { SessionState } from './session-state';

export const SHARED_STATE_VERSION = 2;

export interface LeaderInfo {
  id: string;
  heartbeatAt: number;
  epoch: number;
}

export interface SharedConfigPayload {
  idleGraceMs: number;
  countdownMs: number;
  warnBeforeMs: number;
  activityResetCooldownMs: number;
  storageKeyPrefix: string;
  syncMode: SessionSyncMode;
  resumeBehavior: 'manual' | 'autoOnServerSync' | undefined;
  ignoreUserActivityWhenPaused: boolean;
  allowManualExtendWhenExpired: boolean;
}

export interface SharedSessionSnapshot {
  state: SessionState;
  remainingMs: number;
  idleStartAt: number | null;
  countdownEndAt: number | null;
  lastActivityAt: number | null;
  paused: boolean;
}

export interface SharedSessionState {
  version: typeof SHARED_STATE_VERSION;
  updatedAt: number;
  syncMode: SessionSyncMode;
  leader: LeaderInfo | null;
  snapshot: SharedSessionSnapshot;
  config: SharedConfigPayload;
}

export type SharedStateMessageType = 'state' | 'request-sync';

export interface SharedStateMessageBase {
  sourceId: string;
  at: number;
  type: SharedStateMessageType;
}

export interface SharedStateBroadcastMessage extends SharedStateMessageBase {
  type: 'state';
  state: SharedSessionState;
}

export interface SharedStateRequestMessage extends SharedStateMessageBase {
  type: 'request-sync';
  reason?: string;
}

export type SharedStateMessage = SharedStateBroadcastMessage | SharedStateRequestMessage;
