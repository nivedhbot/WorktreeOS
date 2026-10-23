# Functional dashboard (milestone 05)

Run `npm ci` and `npm run dev` from the project root, then open http://127.0.0.1:5173. Node 22.13+ and Git on PATH are required. The backend remains bound to loopback and uses the existing SQLite data directory. No external model credentials are needed.

## First local workflow

1. Choose **Register repo** and enter a display name and the absolute path to an existing local Git root, for example `C:/Projects/example`. Registration errors appear inside the dialog and preserve your input for correction.
2. Select the repository from the repository picker. Its actual tasks, active/completed runs, and managed worktrees populate the dashboard. Empty totals are only shown after successful loading; unavailable data is not reported as a successful zero-count workspace.
3. Choose **New task**, enter its title and objective, and save. Task creation defaults to **MOCK**. Saving does not start execution or create a worktree.
4. Select the task and choose **Create worktree**. The base needs an initial commit and a clean checkout. The API creates a generated branch in its dedicated managed directory; the original checkout stays separate.
5. Choose **Start MOCK run**. Follow the live **Timeline**, inspect the persisted **Event log**, and select earlier runs from **Run history**. Active/queued runs can be canceled; failed/canceled/interrupted MOCK runs can be retried as distinct runs. For Codex, request a review using **Start Codex run…**, then separately confirm the queued approval; see [WORKFLOW.md](WORKFLOW.md). CODEX runs show actual mode, model/thread ID and reported usage, with no simulated progress.
6. Open **Changes** to inspect tracked/untracked filenames and the real tracked patch against HEAD. Use **Refresh** after editing a managed worktree outside the application. MOCK itself does not write files; an unchanged MOCK worktree correctly reports no changes. Untracked contents are not part of the backend's tracked patch.
7. Optional cleanup: choose **Remove managed worktree**, review the exact path and retained branch, check the explicit confirmation, and submit. Dirty/ignored/hidden-index changes and active execution cause a visible refusal; there is no force removal, merge, or reset action.

## Navigation and state

Use **Rename repository** beside the picker to change its display name; the registered path is read-only. **Edit task** beside the task status updates its title/objective after active work finishes. Saving creates a new revision and invalidates old approvals while retaining execution history. Use the dependency editor for prerequisite changes. Both forms remain disabled in mobile read-only view.

The sidebar shows the current repository and its tasks. The task panel supports searchable list and board views, plus All, Not started, Active, Completed, and Needs attention filters. Status is derived from each task's latest persisted run. The board groups tasks into Ready, Active, and Review. Run history and worktree inspection stay scoped to the selected task/repository.

API responses are parsed with shared Zod contracts. Network, server validation, Git state, and stream errors have visible feedback and retry controls. Repository data refreshes every ten seconds and after actions. Run status events update the UI immediately and trigger a REST refresh. An older REST snapshot cannot regress a completed/canceled/failed run back to active.

The SSE client loads persisted history before subscribing, ignores duplicate or older sequences, reconnects from its last verified cursor, and closes on terminal states or task selection changes. Invalid status payloads and cross-run streamed events are rejected. Connection loss is shown as reconnecting rather than successful completion. Selecting a different task cancels stale requests/subscriptions.

Forms use shared validation, labeled fields, announced errors, and editable shadcn-style Radix dialogs with keyboard focus handling. Inspection tabs use Radix keyboard navigation. The layout stacks at narrower widths. At 760px and below, mobile inspection remains available while mutation controls are disabled with an explanatory read-only notice. CSS animations honor reduced-motion preferences.

## Verification and limits

Frontend tests cover registration, task validation, explicit worktree/start actions, streamed progress and deduplication, cancel/retry/history, list/board filtering, repository switching, escaped patch rendering, explicit dirty-removal errors, mobile read-only behavior, connectivity retry, invalid responses, reconnect cleanup, and stale-snapshot consistency.

An integration test drives the actual React application against a temporary Git repository, isolated SQLite storage, Fastify over HTTP, and real SSE data via a test-only EventSource adapter. It verifies the full register/create/worktree/MOCK-stream/diff workflow, preserves the original checkout, and confirms that dirty cleanup is refused. Tests never touch user repositories or invoke models.

Milestone 09 adds actual Chromium E2E and screenshots for workflow/graph/mobile inspection; see [QA.md](QA.md). The [scheduler](SCHEDULER.md) allows up to two separate repositories concurrently. Duplicate writer and queue-capacity conflicts produce meaningful 409 errors. Open **Dependencies & approvals** for the React Flow graph, keyboard-accessible edge editor, provider-specific readiness and pending approval queue. **Final review** shows actual changes and manual merge guidance. Per-command interactive escalation remains unavailable and fails closed. No merge, push or cleanup occurs automatically.
