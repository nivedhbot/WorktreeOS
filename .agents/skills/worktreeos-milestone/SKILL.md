---
name: worktreeos-milestone
description: Use in the WorktreeOS repository when implementing, fixing, or verifying one numbered project milestone from docs/ROADMAP.md. Read scoped project instructions, change only the milestone's code, run targeted checks, and update docs/SESSION_STATE.md. Do not use for generic questions or open-ended re-architecture.
---

# WorktreeOS Milestone Executor

1. Read `AGENTS.md`, `docs/PRODUCT.md`, `docs/ROADMAP.md`, and `docs/SESSION_STATE.md` once at the start of the current milestone. Do not dump their content into the reply.
2. Select the exact milestone requested; do not begin later milestones.
3. Inspect only relevant files with precise searches. Never scan `node_modules`, `dist`, `build`, `.git`, caches, generated logs, or databases.
4. Implement the smallest complete working vertical slice for the milestone. Follow root stack and safety constraints. Prefer deterministic built-in tools and existing libraries over new model calls.
5. Add focused regression tests for new behavior. Run targeted tests and changed-package typecheck/build; do not re-run the complete E2E suite after every small edit.
6. Repair failing checks if possible, limiting repeat reruns without code changes. If a genuine blocker exists, stop and report it accurately.
7. Update `docs/SESSION_STATE.md` with changed files, tests/results, blockers and next exact prompt filename. Check off milestones in `docs/ROADMAP.md` only when acceptance tests pass.
8. Reply with no more than 150 words in four fields: Changed, Verified, Risks, Next. Do not include entire diffs or file dumps.
