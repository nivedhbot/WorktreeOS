# Managed Git worktrees (milestone 03)

Register a real local Git root and create a task first. The base must have an initial commit and no tracked/untracked changes. Git is invoked through a fixed executable and argument arrays, without a shell. Inherited Git overrides, global/system configuration, hooks, external filters, fsmonitor, and diff/textconv helpers are disabled. No remote Git commands are used.

| Method | Route                       | Request / result                                                                                                         |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/worktrees`            | `{ "taskId": "<uuid>" }` -> 201 worktree. Optional `branch` must match `worktreeos/<lowercase-slug>`.                    |
| GET    | `/api/worktrees`            | `{ "worktrees": [...] }`; optional `?repositoryId=<uuid>`. Lists app-managed active records only.                        |
| GET    | `/api/worktrees/:id`        | Revalidates and returns the managed worktree.                                                                            |
| GET    | `/api/worktrees/:id/status` | `{ "worktreeId": "...", "clean": true, "files": [] }`.                                                                   |
| GET    | `/api/worktrees/:id/files`  | Changed tracked/untracked files with porcelain status and previous path for renames.                                     |
| GET    | `/api/worktrees/:id/diff`   | Tracked changes versus HEAD, including staged changes; untracked file paths are reported separately in `untrackedFiles`. |
| DELETE | `/api/worktrees/:id`        | Requires JSON `{ "confirm": true }`; returns `{ "removed": true, "branchRetained": true }`.                              |

Worktree records include `id`, `taskId`, `repositoryId`, `branch`, `path`, `createdAt`, and nullable `removedAt`. One active worktree is permitted per task. Default names combine a safe task-title slug and random ID; no user-provided filesystem destination is accepted. Paths are `<WORKTREEOS_DATA_DIR>/worktrees/<uuid>` unless the absolute `WORKTREEOS_WORKTREE_DIR` override is set. The base must be separate from every registered repository. The original checkout is never reset or switched.

Before inspecting or removing a managed tree, the API verifies its canonical destination, registered repository, Git common directory, current branch, and unchanged base directory. Unknown IDs cannot select arbitrary paths. Junction/symlink substitution is rejected. Mutating Git operations are serialized within the API process; concurrent mutations return 409 and can be retried explicitly.

Removal refuses tracked, untracked, and ignored files that could be lost, and never uses force. Branches and committed history are retained. There is no merge, reset, branch deletion, push, or automatic cleanup. External changes or failed operations may require manual inspection; if SQLite persistence fails after Git creation, the tree is preserved rather than automatically deleted. Git errors omit raw subprocess output and paths.

This API assumes one local backend process. Registered paths must remain under the developer's control; worktree isolation does not sandbox programs. All integration tests use disposable temporary repositories and confirm the original checkout remains unchanged.
