# Cross-Tab Sync Discovery Notes

## Current Behaviour Snapshot
- `SessionTimeoutService` (`packages/ng2-idle-timeout/src/lib/services/session-timeout.service.ts`) drives timer state locally, persisting snapshots via `persistSnapshot` and broadcasting simple events (`extend`, `expire`, `reset`, unused `sync`).
- Broadcast payloads only include the triggering snapshot/activity; followers immediately overwrite local state without conflict resolution.
- Leader election (`packages/ng2-idle-timeout/src/lib/services/leader-election.service.ts`) relies on localStorage heartbeat; only the elected tab acts on DOM/Router activity while followers forward resets to the leader.
- Persisted config/snapshot live under `<storageKeyPrefix>:{config|snapshot}`; no schema/versioning beyond implicit structure.
- Tests (`session-timeout-cross-tab.spec.ts`, `leader-election.service.spec.ts`) cover follower extend/expire/reset reactions and leader handoff via storage staleness.

## Pain Points & Gaps
- No explicit coordination for tab join/leave; new tabs start with local defaults until storage restore completes, risking brief divergence.
- `sync` message type unused; no broadcast of authoritative config, timers, or metadata (e.g., causal timestamps).
- Leader-only approach cannot guarantee continuity if storage heartbeat stalls during sleep; followers may emit resets without leader acknowledgement.
- Distributed operation unsupported; simultaneous resets/extends race without ordering semantics.
- Persistence lacks shared "last updated" metadata to arbitrate snapshot freshness; system sleep/wake not detected.

## Target Behaviours by syncMode

| Scenario | Leader Mode (default) | Distributed Mode |
| --- | --- | --- |
| Ownership | Single active leader maintains timers; followers mirror state and proxy activity/reset to leader. | Every tab can update shared state using timestamp + precedence rules; no single owner. |
| Join (new tab) | Reads persisted bundle (config + snapshot + leaderId), requests sync message from leader; if leader unknown/stale, self-elects. | Reads bundle; applies freshest snapshot/config; may reconcile if local state newer; subscribes for updates. |
| Leave (tab close/unload) | Leader steps down via storage clear; followers elect next leader based on heartbeat TTL. | Leaving tab writes final heartbeat with timestamp; remaining tabs continue with latest snapshot. |
| Visibility change / background | Leader maintains heartbeat while visible; long background intervals trigger followers to reassess leadership. Followers stay passive otherwise. | All tabs keep updating monotonic timestamps; on resume, compare persisted metadata and reconcile using latest version. |
| Sleep/Wake | On wake, leader validates heartbeat age; if stale, triggers re-election and sync; followers detect stale snapshot and request sync. | Tabs compare persisted `updatedAt`; if gap beyond tolerance, broadcast reconciliation and align timers. |
| Activity/reset event | Followers broadcast `reset-request`; leader updates snapshot, persists, rebroadcasts authoritative state. | Tab updates snapshot with monotonic version; others adopt if `(version, updatedAt)` is newer. |
| Config change (`setConfig`) | Leader persists config, emits `config-sync`; followers adopt and optionally ack. | Initiating tab increments config version, persists, broadcasts; others merge if newer. |
| Failure mode | Leader crash → followers elect replacement using heartbeat TTL. | Conflicting updates resolved using `(version, updatedAt, sourceId)` ordering. |

## Required Deliverables for Future Checkpoints
- Shared-state bundle containing snapshot, config, sync metadata (version, updatedAt, sourceId, mode-specific fields).
- Coordinator service abstracting storage + broadcast; pluggable policies for leader/distributed.
- Enhanced `CrossTabMessage` schema: message kinds for `state-sync`, `config-sync`, `reset-request`, `leadership`, etc., with metadata envelope.
- Detection hooks for `visibilitychange`, `pagehide`, `freeze`, `resume`, and storage events.

## Risks & Mitigations
- **Storage availability**: Fallback (in-memory) cannot cross tabs. Mitigation: detect and document degradation (`packages/ng2-idle-timeout/src/lib/utils/storage.ts`).
- **Clock skew between tabs**: Relying on `Date.now()` may diverge; leverage `TimeSourceService` offsets and monotonic counters.
- **BroadcastChannel unsupported**: Fallback via localStorage events is slower; throttle message volume and debounce sync broadcasts.
- **Backward compatibility**: Existing apps expect leader semantics; default to leader mode and surface migration notes for distributed.
- **Test complexity**: Distributed conflicts need deterministic ordering; build orchestrated Jest harness with fake timers and mock coordinator.

## Verification Outline
- **Unit**: Coordinator policies, message handlers per mode, leader election integration, persistence schema migrations.
- **Integration**: Extend `session-timeout-cross-tab.spec.ts` with multi-tab scenarios (leader failover, distributed conflicts, sleep/wake).
- **Playground**: Manual checklist for multi-tab interactions (mode toggle, leader kill, reset propagation).
- **Regression**: Validate public signals/observables stay consistent; add snapshot assertions in `session-timeout.service.spec.ts`.
