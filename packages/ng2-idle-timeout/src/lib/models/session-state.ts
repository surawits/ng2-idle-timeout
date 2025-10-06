export type SessionState = 'IDLE' | 'COUNTDOWN' | 'WARN' | 'EXPIRED';

export interface SessionSnapshot {
  state: SessionState;
  remainingMs: number;
  warnBeforeMs: number;
  countdownMs: number;
  idleGraceMs: number;
  idleStartAt: number | null;
  countdownEndAt: number | null;
  lastActivityAt: number | null;
  paused: boolean;
}
