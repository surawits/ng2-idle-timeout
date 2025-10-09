# Project: ng2-idle-timeout

## Project Overview

This repository contains the `ng2-idle-timeout` library, an Angular package for managing session timeouts. It is designed to be "zoneless" and works with Angular versions 16 and later (verified through v20). The library provides services and utilities to track user activity, manage countdowns, and handle session expiration across multiple browser tabs. It uses Angular signals for change detection.

### Project Structure

*   `packages/ng2-idle-timeout`: The main Angular library, its bundled schematics (including `ng-add`), and Jest specs.
*   `apps/experience`: A demo application for manual validation and showcasing features.
*   `docs/planning`: Contains sprint plans and progress records.

## Building and Running

### Key Scripts

*   **Install dependencies:**
    ```bash
    npm install
    ```
*   **Build the library:**
    ```bash
    npm run build --workspace=ng2-idle-timeout
    ```
*   **Run library tests:**
    ```bash
    npm run test --workspace=ng2-idle-timeout
    ```
*   **Lint the library:**
    ```bash
    npm run lint --workspace=ng2-idle-timeout
    ```
*   **Start the demo application:**
    ```bash
    npm run demo:start
    ```
    The demo will be available at `http://localhost:4200`.
*   **Format code:**
    ```bash
    npm run format
    ```

## Development Conventions

### Coding Style

*   **Formatting:** Use `npm run format` to apply Prettier formatting (2-space indent, single quotes, trailing commas).
*   **Naming:** Use `PascalCase` for types and `camelCase` for members.
*   **Comments:** Only add comments when the logic is not obvious.

### Testing

*   Tests should be located next to the source files with a `.spec.ts` suffix.
*   The folder structure for tests should mirror the source folder structure.
*   Every public method or observable should have test coverage.

### Commits and Pull Requests

*   **Commit Messages:** Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification (e.g., `feat:`, `fix:`, `docs:`, `chore:`). Reference issue numbers with `#123`.
*   **Pull Requests:** Clearly list the verification steps performed. Include screenshots or GIFs for any UI/UX changes.

## Agent Workflow

*   **Context:** At the start of a session, review the conversation plan, `docs/planning/` files, and `git status` to understand the current state.
*   **Planning:** Use the planning tool to create and update a multi-step plan.
*   **Execution:** Use explicit `workdir` for commands and prefer `rg` for searches.
*   **Verification:** Run focused tests and linters. Summarize outcomes with file paths and line numbers.
*   **Troubleshooting:** If formatting or similar issues occur, rewrite the file instead of patching. For more significant issues, ask for help.
