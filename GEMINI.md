# Project: ng2-idle-timeout

## Project Overview

This repository contains the `ng2-idle-timeout` library, an Angular package for managing session timeouts. It is designed to be "zoneless" and works with Angular versions 16 and later (verified through v20). The library provides services and utilities to track user activity, manage countdowns, and handle session expiration across multiple browser tabs using a **Leader Election** mechanism (Distributed mode was removed in v0.3.x). It uses Angular signals for change detection.

### Project Structure

- `packages/ng2-idle-timeout`: The main Angular library, its bundled schematics (including `ng-add`), and Jest specs.
- `apps/experience`: A demo application for manual validation, showcasing features, and automated UI testing.
- `docs/planning`: Contains sprint plans and progress records.

## Building and Running

### Key Scripts

- **Install dependencies:**
  ```bash
  npm install
  ```
- **Build the library:**
  ```bash
  npm run build --workspace=ng2-idle-timeout
  ```
- **Run library tests:**
  ```bash
  npm run test --workspace=ng2-idle-timeout
  ```
- **Lint the library:**
  ```bash
  npm run lint --workspace=ng2-idle-timeout
  ```
- **Start the demo application:**
  ```bash
  npm run demo:start
  ```
  The demo will be available at `http://localhost:4200`.
- **Run demo tests (Playwright):**
  ```bash
  npm run demo:test
  ```
- **Format code:**
  ```bash
  npm run format
  ```
- **Inspect Workspace:**
  ```bash
  npm run control:inspect
  ```

## Development Conventions

### Coding Style

- **Formatting:** Use `npm run format` to apply Prettier formatting (2-space indent, single quotes, trailing commas).
- **Naming:** Use `PascalCase` for types and `camelCase` for members.
- **Comments:** Only add comments when the logic is not obvious.

### Testing

- **Unit Tests:** Located next to the source files with a `.spec.ts` suffix. Every public method or observable should have test coverage.
- **Demo Tests:** Use `npm run demo:test` to verify cross-tab synchronization and UI behavior in the experience app.
- **Structure:** The folder structure for tests should mirror the source folder structure.

### Providers

- **Standalone:** Prefer `provideSessionTimeout(config)` for standalone applications.
- **NgModule:** Use `createSessionTimeoutProviders(config)` for NgModule-based applications.

### Commits and Pull Requests

- **Commit Messages:** Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification (e.g., `feat:`, `fix:`, `docs:`, `chore:`). Reference issue numbers with `#123`.
- **Pull Requests:** Clearly list the verification steps performed. Include screenshots or GIFs for any UI/UX changes.

## Agent Workflow

- **Context:** At the start of a session, review the conversation plan, `docs/planning/` files, and `git status` to understand the current state.
- **Planning:** Use the planning tool to create and update a multi-step plan.
- **Execution:** Use explicit `workdir` for commands and prefer `rg` for searches.
- **Verification:** Run focused tests and linters. Summarize outcomes with file paths and line numbers.
- **Troubleshooting:** If formatting or similar issues occur, rewrite the file instead of patching. For more significant issues, ask for help.
