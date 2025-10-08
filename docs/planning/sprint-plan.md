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
- [x] Checkpoint 2 – Shared State Foundations
  - Sub-checkpoints:
    - [x] 2a Config & Validation updates for syncMode and schema adjustments (`packages/ng2-idle-timeout/src/lib/validation.ts`).
    - [x] 2b Shared-state coordinator (storage + broadcast) with unit tests (`packages/ng2-idle-timeout/src/lib/services/shared-state-coordinator.service.ts`).
    - [x] 2c Cross-tab messaging contract revisions and baseline tests (`packages/ng2-idle-timeout/src/lib/models/cross-tab-message.ts`).
- [x] Checkpoint 3 – Leader Mode Rework
  - Sub-checkpoints:
    - [x] 3a Service integration with coordinator for leader ownership flow.
    - [x] 3b Leader lifecycle & failover handling enhancements.
    - [x] 3c Leader-mode regression test suite rewrite.
- [x] Checkpoint 4 – Distributed Mode Implementation
  - Sub-checkpoints:
    - [x] 4a Consensus rules and conflict-resolution algorithm (Done).
    - [x] 4b Service wiring for distributed reconciliation and activity propagation (Done).
    - [x] 4c Distributed-mode test coverage.
- [x] Checkpoint 5 – Playground & Integration Updates
  - Deliverables: multi-tab demo controls, manual validation script, optional smoke tests.
- [x] Checkpoint 6 - Documentation, Migration, Verification (Done)
  - Deliverables: README updates, migration notes, release notes, verification log, planning sync.
- [ ] Checkpoint 8 - Warning Activity Reset Option
  - Sub-checkpoints:
    - [x] 8a Config surface updates for `resetOnWarningActivity` (models, defaults, validation, persistence, shared state).
    - [x] 8b SessionTimeoutService activity handling and priority rules.
    - [x] 8c Unit & integration coverage for DOM/HTTP activity across flag states.
    - [x] 8d Documentation, migration notes, and playground toggle.
    - [x] 8e Verification runs and planning record sync.
## Risks & Assumptions
- Broadcast/storage APIs available in targeted browsers; fallbacks validated.
- Time source differences reconciled via coordinator metadata.
- Existing consumers prepared for potential breaking changes.



