# Execution and replayable events

MOCK is the default: `provider: "mock"`, `mode: "MOCK"`. It simulates progress, tools and files without running commands, writing files or calling a model. Opt-in Codex uses `provider: "codex"`, `mode: "CODEX"`; see [CODEX.md](CODEX.md). Real Git preparation and inspection use the guarded [worktree API](WORKTREES.md).

## Start and control

Register a local repository, create a task, and explicitly create its managed worktree first. Inputs use strict shared Zod contracts; unknown fields, missing consent and invalid identifiers return 400. Unknown resources return 404. State conflicts return 409; unavailable Codex setup/model access returns 422.

| Method | Route                  | Result                                                                                                                                                           |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/tasks/:id/runs`  | `{ "worktreeId": "<uuid>" }` starts MOCK; 202 run with Location. Codex requires the additional consent fields described in CODEX.md.                             |
| GET    | `/api/tasks/:id/runs`  | `{ "runs": [...] }` persisted history.                                                                                                                           |
| GET    | `/api/runs/:id`        | Persisted run including provider, mode, status, model/thread/actual usage when available.                                                                        |
| POST   | `/api/runs/:id/cancel` | Empty body or `{}`; cancels queued work or aborts active execution and waits for provider cleanup. Repeated cancellation is idempotent.                          |
| POST   | `/api/runs/:id/retry`  | Empty body or `{}`; explicit MOCK retry of failed/canceled/interrupted work creates a distinct run with `retryOf`. Codex requires a new confirmed start instead. |
| GET    | `/api/runs/:id/events` | `{ "mode": ..., "events": [...] }`; optional `?since=<event-uuid>`.                                                                                              |
| GET    | `/api/runs/:id/stream` | SSE history and live events; optional `?since=<event-uuid>` or `Last-Event-ID`.                                                                                  |

The server verifies canonical paths, branch and task/repository association before queueing and again before execution. A task snapshot fixes the objective at enqueue time. Duplicate queued/active tasks or worktree writers are rejected. Queued/active worktrees cannot be removed. The [bounded scheduler](SCHEDULER.md) allows at most two active executions and serializes repository writers.

## Lifecycle and integrity

`queued -> preparing -> running -> completed`. Queued/active work may be canceled; errors and timeouts become failed. API shutdown/restart marks unfinished active work interrupted. Queued Codex runs are also interrupted when the API stops/restarts, requiring new consent. Queued MOCK work survives restart and may resume. Failed/interrupted work never retries automatically.

Terminal states do not transition back to active; explicit retry creates a new record. Status changes and status events commit in one SQLite transaction. Event UUIDs and increasing per-run sequences survive restart. SQL triggers reject event UPDATE and DELETE. Cancellation holds the execution lease until the provider has stopped; timeout and cancellation preserve worktree files and branches.

MOCK emits `mock.message`, `mock.progress`, `mock.tool`, and `mock.file`; file events explicitly carry `simulated: true`. Codex emits `codex.thread`, `codex.item`, and `codex.usage` with structured SDK items and actual usage. `run.status` events carry the run's mode. No token totals are estimated.

## SSE

Frames use `id: <persisted-event-uuid>`, `event: run-event`, and `data: <JSON RunEvent>`. Each event contains `id`, `runId`, `sequence`, `type`, `payload`, and `createdAt`. Execution payloads include the matching mode.

Malformed cursors return 400; unknown/wrong-run cursors return 404 before opening a stream. Replay excludes the cursor and preserves sequence order. Replay/subscription have no asynchronous gap. Last-Event-ID takes precedence over the initial query cursor so native EventSource reconnections resume from the newest acknowledged event. Streams close on terminal state, disconnect or shutdown; clients validate payloads, discard repeated or out-of-order sequences and reconnect from the last verified event. Replay queries read only events after the run-scoped cursor. Heartbeats occur every 15 seconds. Limits remain 32 clients and a bounded output-buffer check for slow clients.

Milestone 08 adds [dependency gating, task approvals and final review](WORKFLOW.md). Direct Codex starts are now refused; use the single-use approval queue. This does not grant per-command escalation. No automatic merge, reset, push or force cleanup is implemented.
