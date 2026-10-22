# Dependencies, approvals and final review

Open **Dependencies & approvals** to see the React Flow graph, a keyboard-accessible task readiness list, the prerequisite editor and the real-run approval queue. Arrows point from prerequisite to dependent. The graph includes prerequisite tasks from other repositories when needed. Use the labeled task selectors and Add/Remove buttons to edit edges without dragging. New-task forms also accept optional prerequisites.

## Dependency rules

`dependencyIds` is optional on task creation. `PATCH /api/tasks/:id/dependencies` replaces the task's prerequisite list using `{ "dependencyIds": ["<task-uuid>"] }`. `GET /api/tasks/:id/dependencies` reads it; `GET /api/graph` returns tasks, edges and provider-specific blocked IDs.

Inputs use shared Zod validation. Duplicate/invalid IDs return 400, missing task references return 404, and self/transitive cycles return 409. Creation/edge updates are transactional; failure leaves prior records/edges intact. Dependency changes increment task revision and invalidate affected pending approvals. Changing prerequisites on an active/queued task is refused.

A prerequisite must have a completed, associated run for its current revision and objective, with its own prerequisites satisfied. MOCK and Codex completion are checked separately. A simulated MOCK success cannot unlock a real Codex dependent. Admission rejects blocked starts with 409 DEPENDENCIES_BLOCKED; dispatch rechecks prerequisites. Task changes make older completions insufficient until an explicit new run succeeds. No dependent task starts automatically merely because its prerequisites finish.

## Single-use real-run approval

1. Create the task's managed worktree explicitly. Choose **Start Codex run…** and select an available supported model.
2. **Add to approval queue** saves a pending review request and launches nothing.
3. In the queue, choose **Review and approve**. Read the exact task/objective/revision, repository root, worktree path, fixed model, expiration and usage/context-sharing risk.
4. Check the fresh single-run acknowledgement and choose **Approve and start Codex**. The server checks account model availability, current context and prerequisites, then atomically consumes the approval while reserving one run.

| Method | Endpoint                     | Behavior                                                                                 |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------- |
| POST   | `/api/tasks/:id/approvals`   | `{ "worktreeId": "<uuid>", "model": "gpt-6-luna" }`; 201 pending approval, no execution. |
| GET    | `/api/approvals`             | Pending and historical approvals.                                                        |
| GET    | `/api/approvals/:id`         | Reviewed snapshot, state, expiry and associated run ID.                                  |
| POST   | `/api/approvals/:id/confirm` | `{ "acknowledgeRisk": true }`; 202 reserved run after single-use consumption.            |
| POST   | `/api/approvals/:id/reject`  | `{}` or empty body; rejects a pending request.                                           |

Approvals expire after 15 minutes and bind to task/repository/worktree/model plus prerequisite revisions and real-run history. Modified, expired, rejected or consumed approvals cannot start execution. Concurrent duplicate confirmations produce at most one run. Missing acknowledgement/extra fields fail validation. The old direct real start endpoint now returns 403 APPROVAL_REQUIRED even with the former confirmation payload. This is an intentional safety upgrade from milestone 06. Auth/model/capacity rejection does not consume a still-valid approval; retry requires another explicit confirmation action. A pending unconfirmed request can be reviewed after restart while still valid, but consumed queued/active real work is interrupted and never replayed.

Run-start approval does not approve arbitrary commands. Codex remains in a read-only sandbox, with untrusted approval policy and unavailable interactive escalation failing closed. See [CODEX.md](CODEX.md). No model call occurs in automated tests.

## Final review

Select a run and open **Final review**. Inspect its actual state, branch, managed path, tracked patch and changed/untracked file list. The checklist asks you to inspect untracked contents, run the project's tests locally, review target/conflicts, and merge manually in your Git client only when satisfied. MOCK completion never claims that project tests passed. This screen executes no commands and performs no merge, push, reset or worktree deletion. Cleanup remains a separate guarded explicit action.
