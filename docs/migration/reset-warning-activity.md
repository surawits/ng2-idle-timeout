# Warning Activity Reset Migration

Version 0.x.x introduces the `resetOnWarningActivity` configuration flag so teams can control whether countdown/warn phases automatically accept user activity.

## What changed
- New `resetOnWarningActivity` boolean toggles automatic resets when keyboard, mouse, scroll, or HTTP activity occurs during the warning/countdown window.
- Activity handling now carries a priority order (`manual` > `http` > `router` > `dom`/`cross-tab`). Lower-priority activity that is ignored surfaces `resetSuppressed` and `resetSuppressedReason` in the `activity$` stream.

## Upgrade checklist
1. **Review UX expectations** – If product teams expect a visible warning to require explicit user acknowledgement, set `resetOnWarningActivity: false` in your shared configuration.
2. **Update monitoring** – When you disable automatic warning resets, ensure dashboards and logs capture the new `resetSuppressedReason` metadata so analysts can distinguish suppressed events from missed listeners.
3. **Playground validation** – In the experience playground enable/disable the new toggle and confirm keyboard, mouse, scroll, and HTTP activity match your desired behaviour across tabs.

## Verification
- `npm run test --workspace=ng2-idle-timeout`
- `npm run demo:test`
- Manually trigger keyboard/mouse/scroll activity during the warning countdown in at least two tabs to confirm suppression/acceptance matches the configured flag.
