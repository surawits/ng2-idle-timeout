# ng2-idle-timeout

Production-ready, zoneless-friendly session timeout orchestration for Angular 16 through 20.

## Current sprint snapshot
Sprint 1 delivers the core session finite state machine:
- Commands: start, stop, resetIdle, extend, expireNow, pause, resume, setConfig
- State surfaces: signals (stateSignal, remainingMsSignal, isWarnSignal, isExpiredSignal) and observables (state$, remainingMs$, lastActivityAt$, countdownEndAt$, events$)
- Config validation with sensible defaults and SSR-safe guards
- Zoneless-safe ticking performed outside Angular zones
- DOM activity listeners (pointer, keyboard, touch, visibility) reset idle outside Angular zones
- Router navigation activity optionally refreshes the session timer
- Session snapshot + config persisted in localStorage so new tabs inherit state without auto-extend

## Quick usage (WIP)
    // Provider helper will arrive in Sprint 2
    import { SessionTimeoutService } from "ng2-idle-timeout";
    constructor(private readonly sessionTimeout: SessionTimeoutService) {}
    this.sessionTimeout.start();

More documentation, recipes, and schematics will land in Sprint 6.
