import type { SessionState } from './session-state';

export const SHARED_STATE_VERSION = 3;

export type SharedStateOperation =
  | 'bootstrap'
  | 'reset-by-activity'
  | 'manual-extend'
  | 'auto-extend'
  | 'pause'
  | 'resume'
  | 'expire'
  | 'config-change';

export interface LeaderInfo {
  id: string;
  heartbeatAt: number;
  epoch: number;
}

export interface SharedStateMetadata {
  revision: number;
  logicalClock: number;
  writerId: string;
  operation: SharedStateOperation;
  causalityToken: string;
}

export interface SharedConfigPayload {
  idleGraceMs: number;
  countdownMs: number;
  warnBeforeMs: number;
  activityResetCooldownMs: number;
  storageKeyPrefix: string;
  resumeBehavior: 'manual' | 'autoOnServerSync' | undefined;
  resetOnWarningActivity: boolean;
  ignoreUserActivityWhenPaused: boolean;
  allowManualExtendWhenExpired: boolean;
  revision: number;
  logicalClock: number;
  writerId: string;
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
  leader: LeaderInfo | null;
  metadata: SharedStateMetadata;
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
  expectReply?: boolean;
}

export type SharedStateMessage = SharedStateBroadcastMessage | SharedStateRequestMessage;
