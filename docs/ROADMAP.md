# WorktreeOS roadmap

State as of 2026-10-22: milestones 01–10 are implemented and locally verified on Windows. Public release and cross-platform evidence are separate pending checks. See [SESSION_STATE.md](SESSION_STATE.md) for architecture, files, Git limitations and exact next steps.

## Round 1 - working mock MVP

- [x] 01 Foundation: npm workspaces, strict TypeScript, React/Vite/Tailwind/shadcn-style shell, Fastify API, shared Zod, lint/typecheck/tests/build and successful UI/API connectivity.
- [x] 02 Persistence and REST: file-backed SQLite/migrations, repository/task create/list/detail/edit, canonical local Git path validation, meaningful errors and isolated durability/inject tests. Startup seeds nothing.
- [x] 03 Git worktrees: guarded create/list/status/files/diff/explicit clean removal, branches retained, path/branch/mutation protections and real temporary-Git tests.
- [x] 04 MOCK and SSE: labeled simulation, durable state and append-only events, live/replayable stream, cancel/retry and API integration tests.
- [x] 05 Dashboard: repository/task workflow, board/list/search/filter, worktree/run/history controls, live timeline/log, tracked patch review and mobile read-only behavior.

## Round 2 - constrained real-agent orchestration

- [x] 06 Codex adapter: official SDK, account-visible model discovery, opt-in real runs and actual thread/item/usage metadata. Read-only/untrusted execution; SDK/discovery are tested with fakes. Authenticated live execution remains unverified.
- [x] 07 Scheduler: bounded durable queue, total concurrency two, per-repository serialization, worktree execution guards, cancellation/timeouts, ownership lock and restart reconciliation.
- [x] 08 Dependencies and approvals: persisted DAG/cycle prevention, revision/provider prerequisite gating, visual graph plus keyboard forms, expiring single-use request/review/confirm and manual final review. No automatic merge.

## Round 3 - validation and local delivery

- [x] 09 QA/security: real-app Chromium E2E, local Host/Origin/socket guards, permission/path/race/failure tests, sanitized audit/events, actual Windows process-recovery coverage and platform verify scripts.
- [x] 10 Shipping polish: accurate README, mock-first PowerShell setup, deterministic isolated fixture/demo/restart smoke, actual inspected desktop/mobile screenshots, keyboard/loading/responsive audit, CI workflow definition, runbook, recording guide, license suggestion and release checklist. Clean-source npm ci/build/browser demo verified; no public clone or hosted CI success is implied.

## Latest recorded verification

Milestone 10: `npm run verify` exited 0; **120 Vitest tests in 23 files** and **6 Chromium E2E**, zero retries, passed along with lint/typecheck/build/format. `npm run demo:smoke` preserved MOCK run/events across API restart; a separate clean-source install and interactive browser demo passed. `npm audit` reported zero vulnerabilities then. Final demo runner changes received typecheck/interactive/smoke checks; docs received formatting/link checks.

These are recorded prior-session results, not new application checks run by the docs-only handoff. Current handoff preserves application code and changes only the state/roadmap documents.

## Pending release work (not new numbered milestones)

- [ ] Owner chooses the application Git root/remote and authorizes version-control delivery. Current application root is not a Git repository; no branch/HEAD/remote/diff can be reported.
- [ ] Owner adopts a license and copyright details; MIT is suggested, no LICENSE grant exists yet.
- [ ] Execute the existing GitHub Actions workflow in the intended hosted repository and inspect Windows/Ubuntu results; workflow definition alone is not passing CI.
- [ ] Verify Linux or other target platforms before claiming support. Firefox/WebKit and macOS execution remain unverified.
- [ ] Complete selected release checks: screenshot privacy, actual optional GIF/video, backup/restore and deeper screen-reader/accessibility review. No installer/desktop package or public release has been produced.
- [ ] Optional authenticated read-only Codex smoke only after explicit manual consent; never in default demo or CI.
- [ ] Assess locked ESLint deprecation and other dependency maintenance under a separately scoped request; no dependency or policy changes are part of the handoff.

[RELEASE.md](RELEASE.md) contains the detailed owner/release checklist. [SESSION_STATE.md](SESSION_STATE.md) records resolved failures, warnings, the blocked older temp-fixture cleanup and unverified environments.

## Scope rule and next action

No implementation milestone remains in the current plan; `prompts/10-polish.md` is complete. Await explicit direction for the pending release choices or a new scoped task. Do not invent milestone 11, add features, change sandbox/approval rules, execute a real agent or publish automatically. Preserve existing code during documentation maintenance.
