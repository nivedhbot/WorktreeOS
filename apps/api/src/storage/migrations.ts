import type { DatabaseSync } from 'node:sqlite';

const migrations = [
  `CREATE TABLE repositories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
    path TEXT NOT NULL UNIQUE,
    path_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
    objective TEXT NOT NULL CHECK(length(trim(objective)) BETWEEN 1 AND 20000),
    provider TEXT NOT NULL CHECK(provider = 'mock'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX tasks_repository ON tasks(repository_id, created_at, id);`,
  `CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    provider TEXT NOT NULL CHECK(provider = 'mock'),
    status TEXT NOT NULL CHECK(status IN ('queued','preparing','awaiting_approval','running','completed','failed','canceled','interrupted')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX runs_task ON runs(task_id, created_at, id);
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    type TEXT NOT NULL CHECK(length(trim(type)) BETWEEN 1 AND 120),
    payload TEXT NOT NULL CHECK(json_valid(payload)),
    created_at TEXT NOT NULL,
    UNIQUE(run_id, sequence)
  ) STRICT;`,
  `CREATE TABLE worktrees (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
    branch TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    removed_at TEXT
  ) STRICT;
  CREATE UNIQUE INDEX worktrees_active_task ON worktrees(task_id) WHERE removed_at IS NULL;
  CREATE INDEX worktrees_repository ON worktrees(repository_id, created_at, id);`,
  `ALTER TABLE runs ADD COLUMN worktree_id TEXT REFERENCES worktrees(id) ON DELETE RESTRICT;
  ALTER TABLE runs ADD COLUMN retry_of TEXT REFERENCES runs(id) ON DELETE RESTRICT;
  CREATE UNIQUE INDEX runs_single_active ON runs((1))
    WHERE worktree_id IS NOT NULL AND status IN ('queued','preparing','running');
  CREATE TRIGGER events_append_only_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'Events are append-only'); END;
  CREATE TRIGGER events_append_only_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'Events are append-only'); END;`,
  // Preserve the legacy provider CHECK and referenced run/event tables; execution_provider is authoritative.
  `ALTER TABLE runs ADD COLUMN execution_provider TEXT NOT NULL DEFAULT 'mock' CHECK(execution_provider IN ('mock','codex'));
  ALTER TABLE runs ADD COLUMN model TEXT;
  ALTER TABLE runs ADD COLUMN thread_id TEXT;
  ALTER TABLE runs ADD COLUMN usage TEXT CHECK(usage IS NULL OR json_valid(usage));`,
  `DROP INDEX runs_single_active;
  ALTER TABLE runs ADD COLUMN task_snapshot TEXT CHECK(task_snapshot IS NULL OR json_valid(task_snapshot));
  CREATE UNIQUE INDEX runs_active_task ON runs(task_id) WHERE worktree_id IS NOT NULL AND status IN ('queued','preparing','running');
  CREATE UNIQUE INDEX runs_active_worktree ON runs(worktree_id) WHERE worktree_id IS NOT NULL AND status IN ('queued','preparing','running');`,
  `ALTER TABLE tasks ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
  CREATE TABLE dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    PRIMARY KEY(task_id, depends_on_id), CHECK(task_id <> depends_on_id)
  ) STRICT;
  CREATE INDEX dependencies_parent ON dependencies(depends_on_id);
  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE RESTRICT,
    model TEXT NOT NULL CHECK(model IN ('gpt-6-luna','gpt-6.1-sol')),
    status TEXT NOT NULL CHECK(status IN ('pending','rejected','consumed','invalidated')),
    context TEXT NOT NULL CHECK(json_valid(context)), fingerprint TEXT NOT NULL,
    run_id TEXT UNIQUE REFERENCES runs(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX approvals_one_pending ON approvals(task_id) WHERE status = 'pending';`,
];

export function migrate(database: DatabaseSync) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const current = Number(
      database.prepare('PRAGMA user_version').get()?.user_version,
    );
    if (
      !Number.isInteger(current) ||
      current < 0 ||
      current > migrations.length
    ) {
      throw new Error(
        'Database schema is newer than this application or has an invalid version',
      );
    }
    for (let index = current; index < migrations.length; index++) {
      const sql = migrations[index];
      if (!sql) throw new Error('Missing database migration');
      database.exec(sql);
      database.exec(`PRAGMA user_version = ${index + 1}`);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
