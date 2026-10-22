$worktreeos-milestone Execute milestone 08 - Dependencies and approvals.

Add React Flow view of task dependencies and backend DAG validation (reject cycles and missing task references), prerequisite completion gating, explicit per-task approval queue before launching a real Codex run, and a final review screen showing changes and merge guidance. Never automatically merge, push or delete worktrees. Bind task creation and dependency changes to Zod validation. Add clear status indicators, keyboard accessible controls, negative tests for DAG cycles, unauthorized starts and duplicate confirmations.

Acceptance: user can build a simple DAG, see blocked/runnable tasks, approve one real run, and inspect changes without auto-merging. Update docs.
