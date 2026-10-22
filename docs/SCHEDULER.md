# Persistent bounded scheduler — milestone 07

SQLite run rows are the durable queue; admission and the initial event commit together. Selection is oldest-first within eligible repositories, ordered by creation time and SQLite insertion order. A busy repository does not block a different repository. The provider receives the saved task snapshot rather than later edits.

| Setting                     | Default | Valid values                             |
| --------------------------- | ------- | ---------------------------------------- |
| `WORKTREEOS_CONCURRENCY`    | 2       | Integer 1–2                              |
| `WORKTREEOS_QUEUE_CAPACITY` | 32      | Integer 1–1000                           |
| `WORKTREEOS_RUN_TIMEOUT_MS` | 900000  | Integer 1–86400000; includes preparation |

The outstanding run budget is queue capacity plus concurrency (34 by default), counting queued/preparing/running associated runs. Admission beyond that budget returns 409 `RUN_CAPACITY`. Tests can inject `buildApp({}, { scheduler: { concurrency, queueCapacity, timeoutMs }, dataDir })`. Invalid configuration fails startup.

Partial unique SQLite indexes block duplicate active/queued task IDs and worktree IDs. A process-local repository execution lease and per-repository Git command/mutation locks serialize writers and Git metadata operations. Different repositories can proceed independently. Conservatively, only one task executes per repository, even with separate worktrees. Read-only inspection remains available. Queued work also prevents explicit worktree removal.

## Cancellation, timeout and exit

Queued cancellation is immediate and does not invoke a provider. Active cancellation aborts the provider and waits for stream/iterator cleanup. The lease and active state remain held until cleanup completes, preventing a replacement writer from overlapping a stopping provider. The SDK receives the same AbortSignal. Timeout aborts execution and records a failed status with a timeout message after cleanup. No failure, timeout, auth error or usage error is automatically retried. MOCK retries require the explicit retry action; Codex requires a newly confirmed start.

Graceful shutdown stops dispatch, closes SSE clients, aborts active providers, waits for cleanup, and marks unfinished work interrupted. Queued MOCK work remains durable. Queued Codex work is interrupted so consent cannot survive a stop/restart. On startup, preparing/running records are reconciled to interrupted before dispatch; only queued MOCK work may resume. All histories remain replayable. Files, diffs, branches and worktrees are retained for review; cleanup is an independent guarded user action. The scheduler never creates or removes worktrees automatically.

A PID ownership file `scheduler.lock` inside the app data directory prevents two APIs from scheduling against the same database. Ownership is acquired before migrations/reconciliation and released on close. After an abrupt exit, a dead PID allows safe lock reclamation. A live/inaccessible PID or invalid lock fails closed. For an invalid lock, first verify the API is stopped before manually removing the lock file. No shell-based process cleanup is used.

Tests prove concurrency across separate temporary Git repositories, serialization in one repository/worktree, duplicate prevention, bounded admission, queued/running cancellation, timeout, immutable objectives, retained diffs, restart reconciliation, no automatic real replay, explicit retries and lock release after failures. A Windows-compatible test starts a local Node API process with `shell: false`/`windowsHide: true`, waits for running MOCK work, terminates and awaits process exit, reclaims the stale ownership file, and verifies durable interruption without replay or lost files. It never launches a real agent. Native Codex cancellation is verified through SDK fakes; an authenticated real-agent process test remains manual.
