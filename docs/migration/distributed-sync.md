# Distributed Sync (Removed)

> Update 2025-10-09: Distributed coordination has been removed from 
g2-idle-timeout after repeated field issues. The library now enforces leader-only coordination for cross-tab state updates.

## What changed
- syncMode is no longer part of SessionTimeoutConfig. Supplying it via providers or setConfig() is ignored and surfaces a validation warning.
- SessionTimeoutService treats any persisted distributed snapshots as legacy data and keeps only the latest leader snapshot.
- Playground diagnostics no longer expose a mode toggle; shared state metadata remains available for visibility troubleshooting.

## Action items
1. Remove syncMode entries from your configuration and providers.
2. Delete any automation or documentation that references distributed mode, Lamport clocks, or consensus rules.
3. Ensure deployment notes no longer instruct teams to switch coordination modes across environments.

## Legacy reference
If you still need to inspect the deprecated behaviour (for example, to reason about old telemetry or persisted data), refer to commit history prior to 0.3.4. Archived resources:
- docs/manual-validation/distributed-playground.md
- Sprint 8 planning notes under docs/planning/

These documents are retained for historical context only.
