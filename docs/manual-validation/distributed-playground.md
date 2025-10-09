# Distributed Playground Checklist
> **Archived**: Distributed mode was removed in v0.3.4. This checklist is retained for historical reference only.

Use this checklist to exercise the updated playground controls and confirm distributed sync behaviour before tagging a release.

## Prerequisites
- Install dependencies: `npm install`
- Build or serve the experience app: `npm run demo:start`
- Open two browser contexts pointed at `http://localhost:4200/playground` (for example Chrome window + incognito)
- Clear any lingering shared state via the new **Clear persisted state** button on each tab

## Baseline (Leader mode)
1. In tab A leave **Sync mode** set to *Leader (single writer)* and click **Start service**.
2. Trigger **Extend session** and verify tab B receives the broadcast (state badge updates to *COUNTDOWN* and telemetry reflects the remaining seconds).
3. Click **Stop service** and confirm the shared state snapshot is cleared in both tabs.
4. Record the expected result: leader mode continues to function with the new diagnostics card present but empty.

## Distributed handshake
1. Switch **Sync mode** to *Distributed (multi-writer)* in both tabs. Ensure the warning banner disappears once both tabs match modes.
2. Click **Request sync** on tab B. Tab A should publish a snapshot (metadata table populates with revision 1, logical clock 1).
3. Start the service on tab A. Confirm tab B shows the shared snapshot (state `IDLE`, matching countdown values).
4. Pause the service on tab A and resume from tab B. Both tabs should remain in sync and the metadata revision should increment.

## Conflict resolution
1. With both tabs in distributed mode and the service running, simultaneously click **Extend** on tab A and **Expire session** on tab B.
2. Use the shared metadata tables to confirm the higher Lamport clock wins. The losing tab should reconcile to the authoritative snapshot (state `EXPIRED`).
3. Trigger **Simulate DOM activity** from tab B; both tabs should return to `IDLE` and the metadata revision should advance.

## Persisted wake + manual sync
1. Stop the service on both tabs, then click **Clear persisted state** on tab B.
2. Refresh tab B; click **Reload snapshot** to pull the stored state. If tab A had the fresher revision it should repopulate.
3. Trigger **Request sync** from tab B and verify tab A publishes immediately (revision increments, `Last shared update` timestamp refreshes).

## Clean up
- Return both tabs to **Leader** mode.
- Confirm the warning banner is hidden and the diagnostics card reflects the new mode.
- Stop the dev server once validation is complete.

> Capture any discrepancies or open questions in `docs/planning/sprint-progress.md` so the next sprint has context.
