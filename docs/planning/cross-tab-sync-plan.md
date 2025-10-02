# Cross-Tab Sync Implementation Plan (2025-10-01)

1. **Audit Current Cross-Tab & Leadership Logic**
   - Review `SessionTimeoutService`, `LeaderElectionService`, storage utilities, and existing cross-tab tests to catalog current message types, persistence keys, and ticking responsibilities.
   - Inventory playground wiring to identify manual testing hooks that must reflect the new sync behaviours.

2. **Extend Shared Models & Defaults**
   - Introduce `syncMode: 'leader' | 'distributed'` (default `'leader'`) in `SessionTimeoutConfig`, defaults, validation, and persisted-config serializers.
   - Define shared record schemas (`leader`, `sessionState`, versions, timestamps) plus helper types/constants for skew tolerance and versioning.

3. **Revise Persistence & Messaging Utilities**
   - Build a storage abstraction that can perform compare-and-swap style writes with debounced batching, handle quota errors, and maintain monotonically increasing versions.
   - Enhance the broadcast utility to use `BroadcastChannel` when available and fall back to `storage` events, sharing a single publish/subscribe API.

4. **Implement Lease-Based Leader Election**
   - Replace the current leader service with a lease/epoch model that persists `{leaderId, leadershipEpoch, leaseUntil, heartbeatEveryMs, updatedAt, version}` and heartbeats every ~1s.
   - Add randomized backoff for CAS acquisition, handle `beforeunload`, sleep recovery, visibility changes, and automatic failover when `leaseUntil` is exceeded.
   - Surface leadership changes via signals/observables for the session service.

5. **Integrate Leader Mode Session Sync**
   - Ensure only the leader tab ticks timers, persists authoritative timestamps (`startedAt`, `lastActivityAt`, etc.), and broadcasts updates.
   - Followers rebuild remaining time from timestamps on leadership changes without jumps, ignore ticking, and re-sync when leadership is regained or lost.
   - Handle initialization/shutdown idempotently and coalesce cross-tab activity events.

6. **Add Distributed Mode Logic**
   - Bypass leader election; every tab derives timers from persisted timestamps with conflict resolution (higher version, then `updatedAt` within skew tolerance).
   - Implement CAS-style writes with jittered retries, debounced persistence, and deterministic reconstruction of countdowns from timestamps.

7. **Update Session Service & Hooks**
   - Refactor `SessionTimeoutService` to orchestrate sync modes, manage shared state persistence, listen to broadcast/storage updates, and emit consistent events.
   - Ensure activity resets, pauses/resumes, and expiration propagate across tabs in both modes with skew tolerance handling.

8. **Testing & Playground Verification**
   - Expand Jest specs (existing cross-tab suite + new leader election specs) to cover leadership failover, distributed conflict resolution, activity resets, countdown consistency, and storage quota handling.
   - Update the playground/demo to expose syncMode toggles and manual testing controls; document verification scenarios.
   - Run targeted `npm run test --workspace=ng2-idle-timeout` and any additional checks required.
