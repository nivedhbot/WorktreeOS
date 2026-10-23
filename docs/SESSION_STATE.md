# WorktreeOS session state

Updated 2026-10-23. Application root: `E:/WorktreeOS`. Repository: [nivedhbot/WorktreeOS](https://github.com/nivedhbot/WorktreeOS), branch `main`.

## Current maintenance

- The previously separate parent Git directory was retained and populated with the exact published `main` history from the nested application. `apps/`, `packages/`, `docs/`, `scripts/`, `e2e/`, `.agents/`, prompts and workspace configuration now live at the parent root. No tracked generated files were found.
- Root `npm ci` installed 412 packages. Node is 24.22.0 and npm is 11.19.1. `npm audit --json` reported zero vulnerabilities. The installed dependencies were already at their compatible wanted versions; no major upgrade or npm CLI change was needed. The root now declares its direct `vite` use and the web package declares its direct `zod` use.
- Worktree ID/task lookups now query indexed rows instead of reading the full list. The dashboard refreshes repository data when a run reaches a terminal state instead of after every running status event. Targeted storage and hook tests cover both changes.
- Root `.gitignore` excludes generated caches, local databases, environment files, logs, reports, build outputs and demo data. An obsolete starter guide and an untracked duplicate of the tracked Codex skill were removed. The user-owned root playbook and demo data were preserved.
- The old `WorktreeOS-Codex-Starter` directory still holds its former `.git`, `node_modules` and generated test reports. Root `node-compile-cache` and `tsx-Sathish` also remain locally. Automatic approval review rejected recursive removal with “blocked by policy”; the caches are ignored, while the old starter appears as one untracked directory. No alternative deletion method was used.

## Verification

Before maintenance, `npm run verify` passed in the nested application: 133 Vitest tests (8 shared, 103 API, 22 web), seven Chromium scenarios, lint, typecheck, build and formatting. Final root `npm run verify` passed 135 Vitest tests (8 shared, 104 API, 23 web), seven Chromium scenarios, lint, typecheck, production build and formatting. The two new tests cover indexed worktree lookup and terminal-only dashboard refresh. Root `npm ci`, isolated `npm run demo:smoke` with MOCK persistence across API restart, and `npm audit --json` also passed. No Codex discovery or paid model call was made during the smoke.

The pushed maintenance commit `9f3f37e` passed [GitHub run 39944320327](https://github.com/nivedhbot/WorktreeOS/actions/runs/39944320327): quality and Windows/Ubuntu integration jobs all succeeded. See [QA](QA.md) and [ARCHITECTURE](ARCHITECTURE.md) for test coverage and system boundaries.

## Operational boundaries

- MOCK is the default and works without model credentials. Real Codex uses the official SDK only after explicit, single-use approval; no paid model run was used for this maintenance.
- SQLite data defaults outside the source tree. Repository registration, worktree creation, execution and clean removal require explicit actions. Git branches and user changes are retained; no automatic merge, reset or push occurs.
- The durable scheduler has bounded concurrency, per-repository and per-task locking, cancellation, timeouts and restart recovery. Queued MOCK can resume after a restart; real runs do not replay automatically.
- The API is a single-user loopback service, not multi-user authentication. Authenticated Codex execution, macOS, Firefox/WebKit, a full screen-reader audit and private backup/restore remain unverified.
- License selection and a tagged release remain owner decisions. The rejected local cleanup paths remain the outstanding repository-maintenance limitation.
