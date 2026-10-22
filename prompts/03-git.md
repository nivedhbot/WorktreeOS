$worktreeos-milestone Execute milestone 03 - Git worktree management only.

Implement a GitService using safe fixed git executable and argument arrays (no user command interpolation or shell strings), registered-repository allowlist, canonical path resolution, safe branch slug/IDs, and worktrees in dedicated app-controlled directory outside the original repo. Expose explicitly requested create/list/status/diff/changed files operations. Detect dirty base repo, missing commit, duplicate branch, Windows path edge cases. Worktree deletion must require an explicit confirmation API flag, must refuse if changes would be lost, and must never silently force-remove, reset or merge. Return sanitized errors.

Acceptance: integration tests create temporary git repositories and validate real git worktree create/diff/remove behavior and traversal defense, plus typecheck/build. Update docs. No AI agent runs.
