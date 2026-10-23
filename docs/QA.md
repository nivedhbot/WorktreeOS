# QA and security — milestone 09

## Reproduce the checks

Requirements: Node 22.13+, npm, Git on PATH, and the Playwright Chromium browser matching package-lock.json. From the repository root:

```sh
npm ci
npm exec -- playwright install chromium
npm run verify
```

On Linux, browser system dependencies may be needed; Playwright's documented `npm exec -- playwright install --with-deps chromium` installs them when the environment permits. No sandbox-disabling browser flags are supplied. Missing browser/system dependencies fail explicitly; tests are not skipped or marked successful. Local verification runs on Windows; GitHub Actions also exercises Ubuntu. See [SESSION_STATE](SESSION_STATE.md) for dated results.

Windows PowerShell: `./scripts/verify.ps1`. If local script policy prevents invocation, use `npm.cmd run verify` directly; no policy change is required. Linux: `bash scripts/verify.sh`. Both runners preserve the failing exit status. `npm run verify` executes lint, all workspace plus E2E strict typechecking, Vitest, production build, Chromium E2E, and formatting. `npm run test:e2e` builds before running Playwright. To rerun a focused browser case after a successful build, use `npm exec -- playwright test --grep "part of test name"`.

## Real local-app E2E

Each Playwright case starts its own real Fastify application and Vite production preview on fresh ephemeral 127.0.0.1 ports with an isolated database, proxying actual REST/SSE. Shared schemas, SQLite, guarded Git worktrees, scheduler, dependency/approval routes and React run unchanged. Only CodexProvider and account discovery are injected as test fakes; no authentication, SDK process or model calls occur. No production test-mode flag or execution bypass exists. The fixture owns temporary app data and test repos, closes connections/providers/databases even after failures, then cleans only verified temp roots. Cases do not share repository selection or records. Your existing development services and ~/.worktreeos are not used.

Seven browser scenarios cover:

- Delayed initial loading announcement, keyboard skip-to-main, dialog focus trap/Escape/return, and no page overflow at 320/760/1024/1440px.

- Register an actual temporary Git repo, create task/worktree explicitly, consume real EventSource SSE, inspect tracked/untracked changes, refuse dirty deletion, and inspect final review.
- Cancel an active MOCK run, explicitly retry with a separate linked record, reload the page and recover durable history.
- Create prerequisites through the task form, render the actual React Flow graph, use keyboard controls, reject a cycle, block a dependent start and unlock it after real MOCK completion.
- Queue a Codex request without execution, require the exact review and a fresh acknowledgement, execute one injected provider, reject duplicate confirmation and show no fabricated usage.
- Abort an actual browser request to exercise error feedback, recover after reload, and verify mutation controls remain disabled at mobile width.
- Rename a repository and edit a task after MOCK completion, preserve history across reload, invalidate old approval context and disable edit controls on mobile.

One Chromium worker, zero automatic retries, forbidOnly in CI and bounded timeouts make failures visible. The frontend Vitest suite also uses one jsdom worker and bounded asynchronous queries. Integration polling observes cached/scoped element state so repeated full accessibility-tree scans cannot starve its in-process HTTP/Git work. Real-Git API tests use bounded integration budgets and a worker cap; active-run tests hold execution until cancellation instead of assuming a short sleep remains active. The Windows process-recovery test terminates/reaps an actual local Node MOCK API and verifies interrupted durable state, retained files and stale lock reclamation.

Browser/screenshot QA found and repaired three UI regressions: reselecting the current repository could clear its snapshot without refetching; patch lines rendered horizontally instead of vertically; refreshed React Flow node objects could lose their dimensions and disappear. A hook regression protects idempotent repository selection. Browser checks assert patch line geometry and require both graph nodes to remain visible in the viewport after live completion, rather than merely counting hidden DOM records. Screenshots were inspected after the repairs.

## Security and failure coverage

- Actual loopback binding, raw remote-address validation, local Host allowlist to reject DNS rebinding, local HTTP Origin checks, cross-site request refusal, nosniff and no-store API headers. Forwarded headers do not grant local access. No permissive CORS or remote execution binding is enabled.
- REST traversal/remote/nested path rejection; registration symlink/junction escape; swapped worktree path rejection before diff/start/removal; branch/option/shell injection refusal. Git uses fixed executable/argument arrays, disables hooks/external diff helpers/filters and never contacts remotes.
- SQLite foreign-key, self-edge, uniqueness and append-only-history checks; invalid state transition refusal; transactional graph rollback; cycle/missing reference failures; provider/revision prerequisite gating.
- Single-use/expired/rejected/stale approval failures, concurrent duplicate confirmations, edits during asynchronous discovery, and edits after approval while queued. No provider is invoked when the reviewed context becomes invalid. Auth/model failures do not silently retry or consume approval.
- Request audit records contain method, route template, response status and request ID rather than headers, raw URLs/query strings, bodies or exception text. Unexpected failures return a generic response and emit a generic failure audit record. New persisted event payloads and SSE history redact known OpenAI-key/Bearer/credential-assignment patterns and structured credential fields while preserving actual usage. Tests use synthetic markers and prove they do not appear in captured logs/events. This is pattern-based redaction, not general secret detection; task/repository source content remains user data and existing append-only histories are not rewritten.
- Native Codex configuration-only tests use an empty temporary home and prove inherited MCP entries are disabled, including dotted names; they do not start a model. SDK fakes cover streaming and policy options. Nested WorktreeOS processes are refused.
- Four competing Node processes exercise stale scheduler ownership reclamation. Queued approval expiration and prerequisite changes fail even behind occupied slots. Replay tests cover header precedence, run-scoped cursors, duplicate/out-of-order delivery and malformed status payloads.
- Fastify is constrained to patched 5.12.7 or later compatible releases; npm audit is part of the recorded validation. Codex remains read-only with denied escalation and fails closed on unavailable command approvals.

## Artifacts and environment limits

Playwright writes its HTML report to `playwright-report/` and failed-test traces/screenshots to `test-results/`; both are ignored by Git, lint and formatting. Successful workflow/graph/mobile cases also capture screenshots in their result directories. Open `npm exec -- playwright show-report`, or inspect the exact trace path printed by a failed test. Browser failures are fixed and rerun deliberately; automatic retries are disabled.

Chromium was installed and exercised on this Windows host. Windows and Ubuntu Chromium CI have passed; other browser engines, macOS and authenticated real Codex runs remain unverified. A harmless real run remains a separately consented manual check. No merge/push/reset/force removal or permission changes are part of these tests. One earlier failed-test temp directory (worktreeos-test-T0nGw5 under the Windows temp directory) was left untouched because automatic approval review rejected manual cleanup with "blocked by policy"; it is outside the project and user app data.

The test fixture follows the official [Playwright fixtures](https://playwright.dev/docs/test-fixtures) and [Vite preview API](https://vite.dev/guide/api-javascript.html#preview). Logging uses Fastify's supported [LogController](https://fastify.dev/docs/latest/Reference/Server/#logcontroller).
