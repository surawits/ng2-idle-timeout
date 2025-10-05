# Sprint Plan

## Goal
- Implement cross-tab timer and configuration synchronization with selectable syncMode (default leader, alternative distributed) ensuring consistent state across tabs.

## Scope
- Redesign shared state persistence and broadcast flow to support leader and distributed coordination modes.
- Refactor SessionTimeoutService and related helpers for authoritative shared state, join/leave recovery, and system sleep/visibility handling.
- Provide comprehensive automated tests and playground scenarios that validate multi-tab consistency, failover, and reset behaviours.
- Update documentation and migration guidance covering the new configuration surface and behaviour changes.

## Timeline
- Kickoff: 2025-10-05
- Target completion: 2025-10-19

## Checkpoints
- [x] Checkpoint 1 – Discovery & Design Notes
  - Deliverables: architectural brief, behaviour matrix for syncMode, risk log, verification outline (`docs/planning/cross-tab-sync-discovery.md`).
- [ ] Checkpoint 2 – Shared State Foundations
  - Sub-checkpoints:
    - [ ] 2a Config & Validation updates for syncMode and schema adjustments.
    - [ ] 2b Shared-state coordinator (storage + broadcast) with unit tests.
    - [ ] 2c Cross-tab messaging contract revisions and baseline tests.
- [ ] Checkpoint 3 – Leader Mode Rework
  - Sub-checkpoints:
    - [ ] 3a Service integration with coordinator for leader ownership flow.
    - [ ] 3b Leader lifecycle & failover handling enhancements.
    - [ ] 3c Leader-mode regression test suite rewrite.
- [ ] Checkpoint 4 – Distributed Mode Implementation
  - Sub-checkpoints:
    - [ ] 4a Consensus rules and conflict-resolution algorithm.
    - [ ] 4b Service wiring for distributed reconciliation and activity propagation.
    - [ ] 4c Distributed-mode test coverage.
- [ ] Checkpoint 5 – Playground & Integration Updates
  - Deliverables: multi-tab demo controls, manual validation script, optional smoke tests.
- [ ] Checkpoint 6 – Documentation, Migration, Verification
  - Deliverables: README updates, migration notes, release notes, verification log, planning sync.

## Risks & Assumptions
- Broadcast/storage APIs available in targeted browsers; fallbacks validated.
- Time source differences reconciled via coordinator metadata.
- Existing consumers prepared for potential breaking changes.
