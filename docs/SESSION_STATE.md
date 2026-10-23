# WorktreeOS session state

Updated 2026-10-23. Version 0.1.0.

- Application root: `E:/WorktreeOS/WorktreeOS-Codex-Starter`.
- Git repository: [nivedhbot/WorktreeOS](https://github.com/nivedhbot/WorktreeOS), branch `main`.
- The parent `E:/WorktreeOS` has a separate empty Git repository; do not use it for application delivery.
- User authorized implementation, testing and push through milestone 10. No real paid model task was authorized or executed.

## Milestone audit

The baseline already contained implementations through milestone 10. The audit inspected code, history, prompts, architecture and tests, then repaired concrete gaps without recreating the application. Milestones 04–10 are complete against the implementation and automated acceptance checks below. See [ROADMAP](ROADMAP.md) and [ARCHITECTURE](ARCHITECTURE.md).

| Batch         | Changes                                                                                                                                                                               | Targeted evidence                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Windows paths | Native canonical temp/demo/worktree roots fix hosted 8.3 aliases while preserving symlink rejection                                                                                   | 25 Git/path/demo tests; API typecheck/build and lint                                                        |
| Codex safety  | Supported granular denial replaces retired untrusted policy; explicitly disable configured MCP names and inherited integrations; reject nested WorktreeOS startup/discovery/execution | 16 SDK/discovery/native configuration checks; API typecheck/build and lint; no model turn                   |
| Scheduler     | Validate queued real consent even behind occupied slots; atomically guard stale ownership reclamation                                                                                 | 20 scheduler/workflow/process tests, including four competing Node reclaimers; API typecheck/build and lint |
| Dashboard     | Repository rename/task edit forms; preserve selection/history; immutable terminal status; insertion ordering for equal timestamps                                                     | Five hook/eight storage tests; new Chromium edit/invalidation/reload/mobile scenario; typecheck/lint/build  |
| Streaming     | Last-Event-ID precedence; indexed run-scoped replay; reject invalid status and ignore duplicate/older sequences                                                                       | 19 API/storage and five hook tests; typecheck/lint/build                                                    |
| Final QA/docs | Dedicated architecture guide; reconciled README/roadmap/readiness; bounded jsdom workers and scoped polling assertions                                                                | Full verification passed 133 Vitest tests and seven Chromium cases; demo restart smoke passed               |

### Resolved failures

- Hosted baseline [39838180330](https://github.com/nivedhbot/WorktreeOS/actions/runs/39838180330) failed Windows path tests because JavaScript realpath preserved an 8.3 alias while native asynchronous validation expanded it. Native canonicalization fixed the discrepancy. Ubuntu/quality already passed.
- Installed SDK 0.163.0 retains a legacy approval type rejected by its native CLI. Configuration-only checks identified supported granular denial. Empty MCP tables merge inherited entries, so each configured server is explicitly disabled, including dotted names.
- A new edit E2E initially matched objective text in two locations. Scoping to the task region fixed the selector; the case then passed.
- The first final suite passed all 103 API tests but failed three frontend checks on timeouts. Diagnostic runs showed full-page accessibility polling delaying the in-process HTTP/Git work. One jsdom worker, bounded asynchronous waits and cached/scoped element-state assertions preserved test coverage and allowed all 22 frontend tests to pass. No assertions were skipped and automatic retries remain disabled.

## Verification evidence

Environment: Windows, Node 24.22.0, npm 11.19.1. The lockfile was preserved; no dependency migration was introduced.

| Check                             | Actual result                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh baseline npm run verify     | Passed 120 Vitest tests / 23 files and six Chromium E2E, plus lint/typecheck/build/format                                                 |
| Current targeted suites           | Passed as listed above                                                                                                                    |
| Final npm run verify              | Exit 0; 133 Vitest tests / 25 files (8 shared, 103 API, 22 web), seven Chromium E2E with zero retries; lint/typecheck/build/format passed |
| Final npm run demo:smoke          | Exit 0; MOCK completed and identical run/events survived API restart                                                                      |
| npm audit --json                  | Exit 0, zero vulnerabilities on 2026-10-23                                                                                                |
| Hosted run 39896934560 at 7a970b1 | Completed success: quality, Windows and Ubuntu integration                                                                                |
| Current main CI                   | [Inspect the workflow for the delivered commit](https://github.com/nivedhbot/WorktreeOS/actions/workflows/ci.yml)                         |

Hosted jobs perform fresh checkout/`npm ci`, tests, build, MOCK restart smoke and Chromium. [Run 39896934560](https://github.com/nivedhbot/WorktreeOS/actions/runs/39896934560) is executed evidence; it is not a claim that future commits have passed. Current Chromium desktop/mobile captures were also visually inspected. All 60 local Markdown links across 16 documents resolved, git diff --check passed, and tracked-file inspection found no environment/database/key/build/report artifacts. Existing published desktop/mobile screenshots were captured from the actual isolated demo on 2026-10-22 and remain labeled with that provenance.

## Git delivery

Baseline `5989e641aa8f5dd44c56d739114b46aee0eff8f5` was clean. Completed batches were committed with the existing historical author identity and pushed normally to `origin/main`:

1. `b5b474f` Fix Windows fixture paths
2. `1400c59` Constrain Codex execution
3. `fc813f2` Harden scheduler recovery
4. `f0c9f61` Complete dashboard editing
5. `7a970b1` Fix event replay consistency
6. Final batch — Complete verification and docs

The sixth batch contains the verified test harness refinements, architecture guide and final evidence. This document records the pre-commit checks; its push triggers a new CI run at the workflow link above. No force push, history rewrite, attribution trailer or unrelated parent-repository change was performed.

## Architecture and operational invariants

- React/Vite/Tailwind/Radix dashboard and lazy React Flow; Fastify loopback API; shared Zod; Node SQLite with seven transactional migrations.
- Default data is `~/.worktreeos`, outside source. Repository registration, worktree creation, execution and clean removal are explicit actions. Branches and user changes are retained; no automatic merge/reset/push exists.
- Durable queue defaults to concurrency two, one execution per repository, queue capacity 32 and 15-minute preparation/execution timeout. Retries are explicit. Active records become interrupted on restart; only queued MOCK may resume.
- `scheduler.lock` guards one scheduler per data directory; `scheduler.recovery` atomically serializes stale reclamation. Invalid/live/inaccessible ownership fails closed. Inspect any leftover recovery directory before manual removal.
- Task/dependency revisions and provider-specific prerequisites bind expiring single-use real approvals. Edits invalidate old context. MOCK success cannot satisfy Codex prerequisites.
- Real Codex uses official SDK, existing CLI authentication, account-visible supported models, read-only sandbox, denied escalation and disabled tool network/search/MCP/plugins/hooks/apps/sub-agents. The nested-process marker prevents accidental recursive WorktreeOS execution.
- Events are append-only and sequenced; status/event writes are atomic. SSE resumes after a run-scoped cursor. Browser state preserves terminal results against delayed responses.
- Demo creates its own fresh deterministic Git fixture and data on dynamic loopback ports, ignores user app configuration and disables Codex discovery. Enter stops servers; demo roots are retained for inspection.

See [RUNBOOK](RUNBOOK.md), [CODEX](CODEX.md), [SCHEDULER](SCHEDULER.md), [WORKFLOW](WORKFLOW.md), [QA](QA.md) and [DEMO](DEMO.md) for commands and detailed boundaries.

## Remaining limitations

- Authenticated native Codex execution/cancellation and model quota/access were not tested. SDK fakes and native configuration-only commands were used; no paid model calls. Real execution is intentionally read-only.
- macOS, Firefox/WebKit, comprehensive screen-reader/WCAG certification and a private full backup/restore exercise remain unverified.
- Local access guards are not multi-user authentication. Do not expose the API through a tunnel. Redaction detects known credential patterns, not arbitrary secrets or historical stored content.
- Owner license/copyright choice remains open. No installer, GIF/video, release tag or writable agent mode is delivered.
- Non-failing Zod/Rollup annotation warnings may appear. No warning is counted as verification success.
- An older session left `worktreeos-test-T0nGw5` in OS temp after automatic approval review rejected manual cleanup with “blocked by policy.” That unrelated historical artifact was not touched.
- Automatic review rejected one combined shell documentation-edit command with “blocked by policy.” Scoped edits used the native patch tool; no permission/security setting was changed.

## Next steps

No numbered implementation milestone remains. For release preparation, choose the license, inspect the CI result for the selected commit and perform any additional platform/accessibility/backup checks required by the intended release. Do not run a real model task automatically or invent a new numbered milestone. Release choices are in [RELEASE](RELEASE.md).
