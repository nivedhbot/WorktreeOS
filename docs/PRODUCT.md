# WorktreeOS product contract

## Differentiation
A local-first task mission-control tool for individual developers who dispatch coding work into independent Git branches and inspect all output before merging. Not a clone of the Codex chat interface.

## User journey
1. Register a local Git repository (after explicit selection).
2. Create a task (title, objective, repository, optional dependencies, provider selection).
3. Preview the branch/worktree and approve starting a real agent (mock needs no credentials).
4. Observe live status, agent event stream, changed files, logs and diffs.
5. Cancel/retry runs; inspect results; explicitly approve any merge/cleanup operation.

## Interfaces and domain
- apps/web (Vite/React), apps/api (Fastify/Node), packages/shared (Zod and shared types).
- SQLite persists repositories, tasks, runs, events, worktrees, approvals, dependencies.
- REST for control, SSE for event streaming. Backend process is single-user, loopback-only by default.
- Executing run states: queued, preparing, running, completed, failed, canceled, interrupted. Approval requests are separate records; the shared compatibility enum retains `awaiting_approval`.
- Providers: offline MockProvider by default; opt-in read-only CodexProvider through the official @openai/codex-sdk.
- Git worktrees are created outside the registered repository under a dedicated app-controlled base directory.

## Threat model / non-goals
- Treat agent output, repo contents, branch names and task descriptions as untrusted input.
- Never execute arbitrary user-submitted shell snippets via WorktreeOS. Git calls require fixed executable and parameter array.
- WorktreeOS is local-only; no multi-user auth, browser-hosted deployment or unattended destructive Git actions in MVP.
- No automatic merging to the default branch. No remote Git pushes without separate explicit approval.
- Do not claim task safety from Git worktrees alone; real agent sandbox/permissions still apply. In non-interactive SDK runs, fail closed on unavailable approvals instead of bypassing controls.
- Never store OpenAI API keys in the app database; reuse configured Codex authentication through SDK and mask credentials.

## Design direction
Dark high-contrast, professional developer console. Two-column layout: task sidebar and active run canvas; top repo switcher, live status, stage badges, changes/diff tabs, responsive mobile read-only states, accessible focus and keyboard navigation.

## Shipping definition
A user can register a temp Git repo, create a mock task, create an isolated worktree, execute and observe a mock run, inspect diffs and tests, and optionally enable a real Codex run with clear consent and usage controls.
