$worktreeos-milestone Execute milestone 02 - Persistence and REST only. Read session state first.

Implement file-backed SQLite storage for repositories, tasks, runs and events using small migrations and typed data access. Add Zod-validated REST endpoints for /api/repos and /api/tasks, including create/list/detail/edit; include health and meaningful 400/404 errors. Repo registration must require an existing local Git repo path, canonicalize it and reject invalid directories or traversal, and never access remote repositories. Initialize app data outside tracked source (e.g. user home .worktreeos), configurable for tests. Add temp-dir DB tests and Fastify inject integration tests. Seed sample data only through an explicit development command.

Acceptance: durable records survive API restart, inputs are validated, tests cover failures, typecheck/build pass. Update docs and do not create worktrees or execute agents.
