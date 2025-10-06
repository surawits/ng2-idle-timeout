# Distributed Sync Migration

This guide covers the changes introduced with the distributed coordination release (shared state schema v3).
Use it when upgrading from 0.2.x or earlier.

## Key changes
- New `syncMode` configuration option chooses between single-writer (*leader*) and Lamport-based multi-writer (*distributed*).
- Shared snapshots now embed `revision`, `logicalClock`, `writerId`, `operation`, and `causalityToken` so tabs can reconcile conflicts deterministically.
- Snapshot operations are tagged (manual extend, auto extend, activity reset, pause/resume, config change, expire) to keep telemetry and audit trails accurate.
- Persisted state written before v3 is upgraded on load, but stale Lamport clocks can linger until tabs rebroadcast.

## Upgrade checklist
1. **Update dependencies** – bump `ng2-idle-timeout` to `>=0.3.0` and rebuild the workspace.
2. **Align configuration** – ensure every bootstrap path sets the same `SESSION_TIMEOUT_CONFIG`. When enabling distributed mode, add `syncMode: 'distributed'` to your provider or call `sessionTimeoutService.setConfig({ syncMode: 'distributed' })` before `start()`.
3. **Clear or reconcile storage** – either flush the previous `storageKeyPrefix` namespace (localStorage + BroadcastChannel) during deployment or allow the upgraded coordinator to rebroadcast a fresh snapshot from one tab.
4. **Review hooks and analytics** – if you log activity based on `SessionEvent` payloads, capture the new `metadata.operation` values so dashboards distinguish auto extends from manual interventions.
5. **Document operational runbooks** – update runbooks to mention the playground diagnostics card and the manual validation script under `docs/manual-validation/distributed-playground.md`.

## Verification
- `npm run test --workspace=ng2-idle-timeout`
- `npm run demo:test`
- Follow the distributed playground checklist with at least two tabs to validate handshake, conflict resolution, and persisted wake flows.

## Troubleshooting tips
- If tabs disagree about `syncMode`, the playground now surfaces a warning banner; align configuration and reload once both tabs match.
- Replaying old persisted snapshots with missing metadata forces the coordinator to normalise and emit a `bootstrap` operation; monitor logs to confirm before removing maintenance modes.
- When experimenting locally, use the **Clear persisted state** button in the playground to reset Lamport clocks without wiping the entire origin storage.
