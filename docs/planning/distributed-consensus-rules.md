# Distributed Sync Consensus Rules

## Purpose
Define the state metadata, ordering rules, and reconciliation flow required to support the distributed SessionSyncMode without relying on a single leader tab. These rules guide the CP4 implementation and test strategy.

## Design Principles
- Single source of truth per revision: treat every shared-state broadcast as an immutable revision. Consumers only forward-apply revisions; they never mutate snapshots in place once published.
- Deterministic ordering: resolve conflicts using a total ordering over revisions (logical clock plus writer precedence) so every tab converges on the same state.
- Operation awareness: capture the intent behind a revision (extend, reset, expire, config change, pause, resume) to drive side-effects and targeted tests.
- Low chatter: broadcast only when a visible transition occurs or the authoritative countdown target changes. Tabs compute remainingMs locally from the shared target.
- Fault tolerance: survive tabs going to sleep or crashing by using persisted storage and monotonic clocks. Recover by reconciling the freshest revision.

## Shared State Schema Additions
Update SharedSessionState (packages/ng2-idle-timeout/src/lib/models/session-shared-state.ts) to include a new metadata block:

    export interface SharedSessionState {
      version: typeof SHARED_STATE_VERSION;
      updatedAt: number; // epoch milliseconds from TimeSourceService
      syncMode: SessionSyncMode;
      leader: LeaderInfo | null; // null in distributed mode
      metadata: {
        revision: number; // monotonically increasing, starts at 1
        logicalClock: number; // Lamport clock, never decreases
        writerId: string; // coordinator/source that produced the revision
        operation: SharedStateOperation; // describes the intent of the revision
        causalityToken: string; // writerId:logicalClock convenience identifier
      };
      snapshot: SharedSessionSnapshot;
      config: SharedConfigPayload & {
        revision: number; // independent counter for config changes
        logicalClock: number;
        writerId: string;
      };
    }

    export type SharedStateOperation =
      | 'bootstrap'
      | 'reset-by-activity'
      | 'manual-extend'
      | 'auto-extend'
      | 'pause'
      | 'resume'
      | 'expire'
      | 'config-change';

Key notes:
- metadata.revision increments for every snapshot-affecting change (activity reset, extend, pause/resume, expire). Tabs persist the last applied revision locally.
- metadata.logicalClock follows Lamport rules: clock = max(localClock, shared.metadata.logicalClock) + 1 for local mutations; incoming revisions update localClock = max(localClock, incomingClock).
- Config metadata is tracked separately so config-only updates do not contend with timer transitions.
- causalityToken is a cheap identifier for deduplicating replays (useful for logging and targeted tests).

## Message Envelope Changes
SharedStateMessage already carries state and request messages. Extend the request payload with an expectReply flag and rely on the new metadata fields for arbitration:

    export interface SharedStateBroadcastMessage extends SharedStateMessageBase {
      type: 'state';
      state: SharedSessionState;
    }

    export interface SharedStateRequestMessage extends SharedStateMessageBase {
      type: 'request-sync';
      reason?: string;
      expectReply?: boolean; // new tab waiting for an immediate state push
    }

Cross-tab messages reuse the same SharedSessionState bundle. No extra schema changes beyond exposing metadata and config revisions.

## Local Mutation Flow (Distributed Mode)
1. Read the current shared snapshot and metadata from the coordinator.
2. Increment lamportClock = max(localClock, shared.metadata.logicalClock) + 1.
3. Increment revision = shared.metadata.revision + 1.
4. Build a new SharedSessionState with updated snapshot/config values and set metadata.logicalClock = lamportClock, metadata.revision = revision, metadata.writerId = local source id, metadata.operation = the mutation intent (for example reset-by-activity), metadata.causalityToken = writerId:logicalClock.
5. Persist and broadcast using the coordinator.
6. Record localClock = lamportClock and lastAppliedRevision = revision for future comparisons.

Config mutations follow the same pattern, but bump the state metadata only if the snapshot changes. For config-only updates set metadata.operation = config-change and reuse the prior snapshot fields.

## Incoming Revision Arbitration
When a tab receives a SharedSessionState:
1. Reject if state.version differs from SHARED_STATE_VERSION (migration path).
2. Compute whether the revision is newer using the ordering:
   - Compare metadata.revision. Higher wins.
   - If equal, compare metadata.logicalClock. Higher wins.
   - If still equal, prefer lexicographically larger writerId as a stable tie-breaker.
3. If the remote revision loses, ignore it but still update localClock = max(localClock, remote.logicalClock) so the next local mutation advances beyond it.
4. If the remote revision wins, apply the full snapshot and config payload, update lastAppliedRevision, update localClock accordingly, and mirror any side-effects:
   - For config-change operations call SessionTimeoutService.setConfig without re-emitting activity side-effects.
   - For reset-by-activity or manual-extend operations emit matching SessionTimeoutEvents but suppress duplicate broadcast while isApplyingSharedState is true.
5. Persist the adopted state via the coordinator (existing behaviour already handles the write).

## Startup and Recovery
- Cold start: read persisted shared state. If absent, publish metadata.operation = bootstrap, revision = 1, logicalClock = 1, then request sync so any neighbour with fresher state can respond.
- Sync requests: always reply with the latest shared bundle if the local revision is authoritative (distributed mode removes the leader gate).
- Sleep or wake: on visibility change or pagehide persist a heartbeat timestamp based on metadata.logicalClock. On wake, force reconciliation by reading storage; if the persisted revision outranks the in-memory state, adopt and broadcast.

## Failure Scenarios and Resolution
- Simultaneous activity resets: both tabs propose revision + 1 with different logical clocks. The second update observes the first clock and increments past it, ensuring deterministic convergence. Ties on both revision and clock resolve via writerId precedence.
- Clock skew: rely on TimeSourceService.now(), which normalises server offsets when enabled. Lamport clocks avoid depending on wall-clock order.
- Stale persisted state: arbitration rules ensure older revisions are ignored. Only the latest shared bundle remains in storage, so no pruning is required.
- Mixed modes: if a tab switches back to leader mode the leader metadata becomes non-null, signalling followers to reinstate leader election. Distributed peers simply ignore the leader block.

## Implementation Checklist for CP4b and CP4c
- Extend models and validation to include the metadata block and config revisions.
- Update SharedStateCoordinatorService.normalizeState to populate the new metadata, persist the Lamport clock, and expose helpers to bump or read the local clock.
- Teach SessionTimeoutService distributed mode to maintain localClock and lastAppliedRevision, produce structured operations when broadcasting, run arbitration before applying incoming state, and emit local SessionTimeoutEvents while guarding against feedback loops.
- Add Jest helpers to fabricate shared states with custom revisions for conflict scenarios.
- Cover scenarios in tests: simultaneous reset, extend versus expire race, config change overlapping activity, wake-up reconciliation, new tab bootstrapping.

These rules complete CP4a and unblock the wiring and test coverage work scheduled for CP4b and CP4c.
