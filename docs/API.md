# Local REST API (milestone 02)

Base URL: `http://127.0.0.1:3001`. During development the frontend proxies `/api` to this address. Requests and responses use JSON. IDs are UUIDs, timestamps are UTC ISO 8601 strings. There is no remote repository or execution API.

| Method | Path             | Behavior                                                                                        |
| ------ | ---------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/api/health`    | Checks database access and returns the existing health contract.                                |
| GET    | `/api/repos`     | Returns `{ "repositories": [...] }`; empty on a fresh database.                                 |
| POST   | `/api/repos`     | Registers an existing local Git root; returns the repository, 201, and Location.                |
| GET    | `/api/repos/:id` | Returns one repository, or 404.                                                                 |
| PATCH  | `/api/repos/:id` | Edits the repository name; returns the updated repository.                                      |
| GET    | `/api/tasks`     | Returns `{ "tasks": [...] }`. Optional `?repositoryId=<uuid>` filters by registered repository. |
| POST   | `/api/tasks`     | Creates a task record; returns the task, 201, and Location.                                     |
| GET    | `/api/tasks/:id` | Returns one task, or 404.                                                                       |
| PATCH  | `/api/tasks/:id` | Edits title, objective, and/or provider; returns the updated task.                              |

Repository creation:

```json
{ "name": "My project", "path": "C:/Projects/my-project" }
```

`name` is trimmed and must be 1–120 characters. `path` must identify an existing readable local non-bare repository root, with `.git` metadata contained inside that root. Paths are canonicalized before storage. URL/network/device paths, `..` segments, files, ordinary directories, nested directories, symlink/junction aliases, and Git-file redirects to external metadata are rejected. Register the actual directory rather than an alias. Windows paths are deduplicated without regard to case. A duplicate canonical root returns 409. Registration never follows a remote URL or invokes Git network commands.

Repository responses contain `id`, `name`, canonical `path`, `createdAt`, and `updatedAt`. Repository edits accept only `{ "name": "New name" }`; paths are immutable so switching roots requires a separate explicit registration.

Task creation:

```json
{
  "repositoryId": "6b35c3ca-35ab-48bc-9816-cc368da2437a",
  "title": "Inspect the workspace",
  "objective": "Review the current local changes.",
  "provider": "mock"
}
```

`title` is trimmed and must be 1–200 characters; `objective` is trimmed and must be 1–20,000 characters. `repositoryId` must refer to a registered repository. The task-level `provider` defaults to `mock` and accepts only that default. Real Codex selection requires a separately confirmed run request; see [CODEX.md](CODEX.md). Creating a task only saves a record; it does not create a run or start a provider. Responses add `id`, `createdAt`, and `updatedAt`. Task edits require at least one editable field; repository ownership, IDs, timestamps, and execution status cannot be changed by PATCH. Unknown fields are rejected. Lists have deterministic creation-time/ID ordering.

Errors use a consistent envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "issues": [
      {
        "path": "title",
        "message": "Too small: expected string to have >=1 characters"
      }
    ]
  }
}
```

400 indicates invalid input, malformed JSON, or invalid local paths. 404 indicates a missing repository/task or unknown route, including missing parent repositories on task creation. 409 indicates duplicate registration. 503 indicates Git is unavailable during registration. Unexpected server failures return 500 without internal error details. The health response remains `{ "status": "ok", "service": "worktreeos-api", "version": "0.1.0", "timestamp": "..." }` for compatibility with the dashboard.

SQLite stores repositories, tasks, runs, and events in `WORKTREEOS_DATA_DIR/worktreeos.sqlite` (default `~/.worktreeos`). Foreign keys, uniqueness constraints, transactional migrations, and per-run event sequence uniqueness protect relationships. Repository/task DELETE endpoints remain unavailable. See WORKTREES.md for milestone 03 worktree operations.

See [WORKTREES.md](WORKTREES.md) for worktree operations, [RUNS.md](RUNS.md) for REST/SSE execution controls, [CODEX.md](CODEX.md) for opt-in real execution, and [SCHEDULER.md](SCHEDULER.md) for queue/restart behavior.

Task creation also accepts optional `dependencyIds` (up to 100 unique existing UUIDs). Graph edits, provider/revision completion gating and single-use real-start approvals are documented in [WORKFLOW.md](WORKFLOW.md). The API rejects remote sockets, non-local Host headers and cross-site origins; direct native HTTP clients without Origin remain supported on loopback. See [QA.md](QA.md) for validation and audit-log coverage.
