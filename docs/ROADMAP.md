# WorktreeOS roadmap

Updated 2026-10-23. Milestones 01–10 are implemented; the completion audit passed local verification. Existing functionality was inspected and retained. [SESSION_STATE](SESSION_STATE.md) records actual results, fixes and Git delivery; [ARCHITECTURE](ARCHITECTURE.md) describes the system.

## Round 1 — working mock MVP

- [x] 01 Foundation: strict TypeScript workspaces, React/Vite/Tailwind/Radix UI, Fastify, shared Zod and build/check tooling.
- [x] 02 Persistence and REST: SQLite migrations, repository/task create/list/detail/edit, canonical path validation, durable storage and useful errors.
- [x] 03 Git worktrees: guarded creation, status/files/diff inspection and explicit clean removal; original checkout and retained branches protected by real-Git tests.
- [x] 04 MOCK engine: task snapshots, durable lifecycle, append-only events, live/replay SSE, cancellation, explicit retry and execution history.
- [x] 05 Dashboard: repository registration/rename, task creation/editing, board/list/search/filter, run controls, timeline/logs, Git inspection and responsive read-only mobile views.

## Round 2 — constrained real-agent orchestration

- [x] 06 Codex: official SDK, account-visible model discovery, explicit manual approval, streaming thread/items/actual usage and persisted history. Read-only sandbox, denied escalation, disabled inherited integrations and recursion guard. Mock remains the default; no paid model test was run.
- [x] 07 Scheduler: bounded durable queue, concurrency two across repositories, serialization per repository, task/worktree locks, cancellation/timeouts, explicit retries, process ownership and restart recovery without real-run replay.
- [x] 08 Workflow: persisted DAG/cycle prevention, visual and keyboard controls, provider/revision prerequisite gating, expiring single-use approval and manual final review. No automatic merge.

## Round 3 — validation and local delivery

- [x] 09 QA: unit/integration and real-app Chromium tests cover lifecycle, Git isolation, concurrency, cancellation/recovery, API validation, SSE, failures and security boundaries. Windows temp-path alias and concurrent stale-lock recovery defects were repaired.
- [x] 10 Polish: edit/history consistency, accessible forms and responsive states, architecture/README/runbook, environment example, actual screenshots and demo guide, isolated MOCK restart smoke, Windows/Ubuntu GitHub Actions and production readiness checklist.

## Current verification

Root `npm run verify` passed **135 Vitest tests in 25 files and seven Chromium E2E**, with lint/typecheck/build/format. The two added tests cover indexed worktree lookup and terminal-only dashboard refresh; the earlier milestone audit had 133 tests. The isolated MOCK restart smoke passed; `npm audit` reported zero vulnerabilities. Exact evidence and the remaining local cleanup limitation are in [SESSION_STATE](SESSION_STATE.md).

Hosted [run 39896934560](https://github.com/nivedhbot/WorktreeOS/actions/runs/39896934560) passed quality and Windows/Ubuntu integration jobs. The older baseline Windows failure was traced to an 8.3 temp-directory alias and fixed without relaxing path protections.

## Release choices and limitations

- [ ] Owner selects a license/copyright; MIT is suggested, with no license grant invented.
- [ ] Optional authenticated read-only Codex smoke requires a separate manual action. No paid execution or native authenticated cancellation is claimed as tested.
- [ ] macOS, Firefox/WebKit and comprehensive screen-reader/WCAG review remain unverified.
- [ ] Owner validates private backup/restore and screenshot content before a tagged release. No installer, recording or release tag is produced by these milestones.

The repository is `nivedhbot/WorktreeOS`, branch `main`. Commit/push authorization was explicitly supplied for this audit. No milestone 11 is defined. Future writable agents, packaging or remote/multi-user operation require separate design and scope; current consent and sandbox boundaries remain in place.

## Repository maintenance

The application and npm workspace now run directly from the repository root. The parent Git repository retains the published application history. Direct package dependencies, indexed worktree lookups and focused dashboard refreshes are covered by new tests. See [SESSION_STATE](SESSION_STATE.md) for the current verification and cleanup status.
