# Opt-in Codex provider — milestone 06

The API depends on official `@openai/codex-sdk` 0.163.0 (locked by package-lock.json). CodexProvider calls `startThread({ workingDirectory: worktree.path, model, ... })` and `runStreamed(task.objective, { signal })`. The task objective is snapshotted in SQLite at queue admission. The application run UUID, SDK thread ID, structured item IDs/statuses and actual SDK usage are retained. Missing usage remains null; no estimates or synthetic totals are displayed.

## Authentication and models

WorktreeOS reuses existing Codex CLI authentication. It does not read credential files, collect keys, implement login, or store account credentials. Opening the confirmation dialog calls `GET /api/providers/codex`. A short-lived native Codex app-server process performs only `initialize`, `initialized`, `account/read` with `refreshToken: false`, and paginated `model/list`. It never starts a thread or turn. The server returns only supported visible model IDs and a sanitized setup error. Concurrent discovery calls share one process; configuration inspection and RPC discovery are each bounded by ten seconds, plus response size and page count, then the process is terminated and reaped.

`gpt-6-luna` is selected by default and disabled if unavailable. `gpt-6.1-sol` is offered only when returned for the signed-in account. There is no silent model fallback. The backend checks availability again on submission. The installed SDK has no model-discovery API, so the small discovery client follows the [official app-server protocol](https://learn.chatgpt.com/docs/app-server). SDK execution/cancellation options were verified directly from the installed package README/types.

## Explicit start

Real runs now use the [single-use approval queue](WORKFLOW.md). **Start Codex run…** shows the repository/worktree and available model and saves a request without executing anything. Create that request with `POST /api/tasks/:id/approvals`:

```json
{
  "worktreeId": "<managed-worktree-uuid>",
  "model": "gpt-6-luna"
}
```

In the queue choose **Review and approve**. The review shows the exact task/objective/revision, repository root, worktree path, fixed model, expiration, context-sharing/usage risk and restrictive sandbox. A fresh acknowledgement enables **Approve and start Codex**. The corresponding `POST /api/approvals/:id/confirm` accepts only `{ "acknowledgeRisk": true }`. Context and prerequisites are checked again and the approval is consumed atomically with run reservation. The former direct `POST /api/tasks/:id/runs` Codex payload now returns 403 APPROVAL_REQUIRED. Modified, expired, denied and consumed approvals fail closed. Creating tasks/worktrees, saving an approval request and starting the API never launches Codex. MOCK remains the default; retrying real work requires a new queued approval. Consumed queued/active real runs do not resume after restart.

## Sandbox and failures

Real execution uses `sandboxMode: "read-only"`, granular approval policy with all request categories set to `false`, disabled tool network/web search, enabled Git-repository checks, no additional directories, and no MCP servers. Model requests still communicate with the configured Codex service. Request/stream retries are configured to zero. WorktreeOS does not pass an API key or weaken sandbox/approval settings.

The installed CLI rejects the retired `untrusted` policy even though the SDK TypeScript union still includes it. WorktreeOS passes the supported granular policy through raw configuration overrides, denying sandbox, rule, permission, skill and MCP approval requests. See the [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Before discovery or execution, a bounded `codex mcp list --json` reads configured server names without starting them. Each is explicitly disabled; an empty table alone does not clear inherited entries. Apps, plugins, hooks, notification commands, shell snapshots and multi-agent tools are disabled. The child environment and shell policy carry `WORKTREEOS_AGENT_CHILD=1`; nested WorktreeOS API startup, discovery and provider execution refuse before launching processes or creating data. These controls prevent accidental recursive runs; they are not a security boundary against a hostile local process that can change configuration or environment.

The SDK has no per-command interactive approval response interface. Commands needing unavailable approval fail closed; failed command items also stop the adapter. There is no automatic approval, fallback to a permissive sandbox, or real file-writing mode. The adapter provides sanitized authentication, usage-limit and approval/setup failures. Inspect local CLI configuration, resolve the issue outside WorktreeOS, and explicitly confirm a new run. AbortSignal is forwarded to the SDK for cancellation/timeout/shutdown; iteration unwinds before leases are released.

Tests use an empty temporary Codex home for native configuration-only checks and inject SDK/process fakes for execution. They cover structured events, actual metadata durability, missing consent, unavailable models, error sanitization and discovery cleanup. Automated tests/CI do not call models. A real authenticated smoke run was deliberately not executed.

## Optional manual smoke test

With existing Codex CLI authentication, register a clean local fixture repository with a README, create a task such as “Summarize README.md without changing files or running commands,” and explicitly create its worktree. Open **Start Codex run…**, select an available model and add a request. In **Dependencies & approvals**, review that request's exact context, acknowledge risk and explicitly approve one run. Expect CODEX timeline/items, a real thread ID and SDK-reported usage if provided. Verify the worktree is still clean. Cancel if needed. Authentication/usage/sandbox failure should produce a terminal sanitized error, never automatic retry or escalation.
