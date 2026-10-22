import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createRepositorySchema,
  createTaskSchema,
  editRepositorySchema,
  editTaskSchema,
  repositorySchema,
  taskSchema,
  runSchema,
  eventSchema,
  worktreeSchema,
  type Worktree,
  type CreateRepository,
  type CreateTask,
  type EditRepository,
  type EditTask,
  type Run,
  type RunEvent,
  canTransitionRun,
  isActiveRun,
  type RunStatus,
  type StartRun,
  usageSchema,
} from '@worktreeos/shared';
import { AppError } from '../errors.js';
import { migrate } from './migrations.js';
import { WorkflowStore } from './workflow.js';
import { redactValue } from '../security.js';

const repositoryColumns =
  'id, name, path, created_at AS createdAt, updated_at AS updatedAt';
const taskColumns =
  'id, repository_id AS repositoryId, title, objective, provider, revision, created_at AS createdAt, updated_at AS updatedAt';
const runColumns =
  "id, task_id AS taskId, execution_provider AS provider, CASE execution_provider WHEN 'codex' THEN 'CODEX' ELSE 'MOCK' END AS mode, model, thread_id AS threadId, json(usage) AS usage, status, worktree_id AS worktreeId, retry_of AS retryOf, created_at AS createdAt, updated_at AS updatedAt";
function parseRun(row: Record<string, unknown>) {
  return runSchema.parse({
    ...row,
    usage:
      typeof row.usage === 'string' ? (JSON.parse(row.usage) as unknown) : null,
  });
}
const eventColumns =
  'id, run_id AS runId, sequence, type, payload, created_at AS createdAt';

export class Store {
  readonly workflow: WorkflowStore;
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(
    public readonly dataDir = process.env.WORKTREEOS_DATA_DIR ??
      join(homedir(), '.worktreeos'),
  ) {
    if (!isAbsolute(dataDir))
      throw new Error('WORKTREEOS_DATA_DIR must be an absolute directory path');
    mkdirSync(dataDir, { recursive: true });
    this.database = new DatabaseSync(join(dataDir, 'worktreeos.sqlite'));
    try {
      this.database.exec(
        'PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;',
      );
      migrate(this.database);
      this.workflow = new WorkflowStore(this.database, this);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  close() {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }

  checkHealth() {
    this.database.prepare('SELECT 1').get();
  }

  listRepositories() {
    return this.database
      .prepare(
        `SELECT ${repositoryColumns} FROM repositories ORDER BY created_at, id`,
      )
      .all()
      .map((row) => repositorySchema.parse(row));
  }

  getRepository(id: string) {
    const row = this.database
      .prepare(`SELECT ${repositoryColumns} FROM repositories WHERE id = ?`)
      .get(id);
    return row ? repositorySchema.parse(row) : undefined;
  }

  createRepository(input: CreateRepository) {
    const data = createRepositorySchema.parse(input);
    const key =
      process.platform === 'win32' ? data.path.toLowerCase() : data.path;
    const record = repositorySchema.parse({
      ...data,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const inserted = this.database
      .prepare(
        'INSERT INTO repositories (id, name, path, path_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(path_key) DO NOTHING',
      )
      .run(
        record.id,
        record.name,
        record.path,
        key,
        record.createdAt,
        record.updatedAt,
      );
    if (inserted.changes === 0) {
      throw new AppError(
        409,
        'REPOSITORY_EXISTS',
        'This repository is already registered',
      );
    }
    return record;
  }

  editRepository(id: string, input: EditRepository) {
    const data = editRepositorySchema.parse(input);
    if (!this.getRepository(id))
      throw new AppError(404, 'REPOSITORY_NOT_FOUND', 'Repository not found');
    this.database
      .prepare('UPDATE repositories SET name = ?, updated_at = ? WHERE id = ?')
      .run(data.name, new Date().toISOString(), id);
    return this.getRepository(id)!;
  }

  listTasks(repositoryId?: string) {
    const rows = repositoryId
      ? this.database
          .prepare(
            `SELECT ${taskColumns} FROM tasks WHERE repository_id = ? ORDER BY created_at, id`,
          )
          .all(repositoryId)
      : this.database
          .prepare(`SELECT ${taskColumns} FROM tasks ORDER BY created_at, id`)
          .all();
    return rows.map((row) => taskSchema.parse(row));
  }

  getTask(id: string) {
    const row = this.database
      .prepare(`SELECT ${taskColumns} FROM tasks WHERE id = ?`)
      .get(id);
    return row ? taskSchema.parse(row) : undefined;
  }

  createTask(input: CreateTask) {
    const data = createTaskSchema.parse(input);
    if (!this.getRepository(data.repositoryId))
      throw new AppError(404, 'REPOSITORY_NOT_FOUND', 'Repository not found');
    return this.workflow.transaction(() => {
      const { dependencyIds, ...fields } = data;
      const record = taskSchema.parse({
        ...fields,
        revision: 0,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      this.database
        .prepare(
          'INSERT INTO tasks (id, repository_id, title, objective, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          record.id,
          record.repositoryId,
          record.title,
          record.objective,
          record.provider,
          record.createdAt,
          record.updatedAt,
        );
      this.workflow.setDependenciesInTransaction(
        record.id,
        dependencyIds ?? [],
      );
      return record;
    });
  }

  editTask(id: string, input: EditTask) {
    const data = editTaskSchema.parse(input);
    const existing = this.getTask(id);
    if (!existing) throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    return this.workflow.transaction(() => {
      const record = taskSchema.parse({
        ...existing,
        title: data.title ?? existing.title,
        objective: data.objective ?? existing.objective,
        provider: data.provider ?? existing.provider,
        revision: (existing.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      });
      this.database
        .prepare(
          'UPDATE tasks SET title = ?, objective = ?, provider = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        )
        .run(
          record.title,
          record.objective,
          record.provider,
          record.updatedAt,
          id,
        );
      this.workflow.invalidateAffected(id);
      return record;
    });
  }

  createRun(
    taskId: string,
    worktreeId: string | null = null,
    retryOf: string | null = null,
    options?: StartRun,
  ): Run {
    const task = this.getTask(taskId);
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    const record = runSchema.parse({
      id: randomUUID(),
      taskId,
      provider: options?.provider ?? task.provider,
      mode: options?.provider === 'codex' ? 'CODEX' : 'MOCK',
      model: options?.provider === 'codex' ? options.model : null,
      threadId: null,
      usage: null,
      status: 'queued',
      worktreeId,
      retryOf,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this.database
      .prepare(
        "INSERT INTO runs (id, task_id, provider, status, created_at, updated_at, worktree_id, retry_of, execution_provider, model) VALUES (?, ?, 'mock', ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.taskId,
        record.status,
        record.createdAt,
        record.updatedAt,
        record.worktreeId,
        record.retryOf,
        record.provider,
        record.model ?? null,
      );
    return record;
  }

  getRun(id: string) {
    const row = this.database
      .prepare(`SELECT ${runColumns} FROM runs WHERE id = ?`)
      .get(id);
    return row ? parseRun(row) : undefined;
  }

  listRuns(taskId: string) {
    return this.database
      .prepare(
        `SELECT ${runColumns} FROM runs WHERE task_id = ? ORDER BY created_at, id`,
      )
      .all(taskId)
      .map(parseRun);
  }

  appendEvent(
    runId: string,
    type: string,
    payload: RunEvent['payload'],
  ): RunEvent {
    if (!this.getRun(runId))
      throw new AppError(404, 'RUN_NOT_FOUND', 'Run not found');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const record = this.insertEvent(runId, type, payload);
      this.database.exec('COMMIT');
      return record;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private insertEvent(
    runId: string,
    type: string,
    payload: RunEvent['payload'],
  ): RunEvent {
    const sequence = Number(
      this.database
        .prepare(
          'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM events WHERE run_id = ?',
        )
        .get(runId)?.next,
    );
    const record = eventSchema.parse({
      id: randomUUID(),
      runId,
      sequence,
      type,
      payload: redactValue(payload),
      createdAt: new Date().toISOString(),
    });
    this.database
      .prepare(
        'INSERT INTO events (id, run_id, sequence, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        record.id,
        record.runId,
        record.sequence,
        record.type,
        JSON.stringify(record.payload),
        record.createdAt,
      );
    return record;
  }

  activeRun() {
    const row = this.database
      .prepare(
        `SELECT ${runColumns} FROM runs WHERE worktree_id IS NOT NULL AND status IN ('queued','preparing','running') LIMIT 1`,
      )
      .get();
    return row ? parseRun(row) : undefined;
  }

  activeRuns() {
    return this.database
      .prepare(
        `SELECT ${runColumns} FROM runs WHERE worktree_id IS NOT NULL AND status IN ('queued','preparing','running') ORDER BY created_at, rowid`,
      )
      .all()
      .map(parseRun);
  }

  runTask(id: string) {
    const row = this.database
      .prepare('SELECT task_snapshot FROM runs WHERE id = ?')
      .get(id);
    const run = this.getRun(id);
    if (!run) throw new AppError(404, 'RUN_NOT_FOUND', 'Run not found');
    return typeof row?.task_snapshot === 'string'
      ? taskSchema.parse(JSON.parse(row.task_snapshot))
      : this.getTask(run.taskId)!;
  }

  reserveRun(
    taskId: string,
    worktreeId: string,
    retryOf: string | null = null,
    options?: StartRun,
    capacity = 1,
    approvalId?: string,
  ) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.workflow.assertRunnable(taskId, options?.provider ?? 'mock');
      if (options?.provider === 'codex') {
        if (!approvalId)
          throw new AppError(
            403,
            'APPROVAL_REQUIRED',
            'Request and confirm a task approval before launching Codex',
          );
        this.workflow.assertApproval(
          approvalId,
          taskId,
          worktreeId,
          options.model,
        );
      }
      const active = this.activeRuns();
      if (active.some((run) => run.taskId === taskId))
        throw new AppError(
          409,
          'DUPLICATE_START',
          'This task already has an active or queued run',
        );
      if (active.some((run) => run.worktreeId === worktreeId))
        throw new AppError(
          409,
          'WORKTREE_IN_USE',
          'This worktree already has an active or queued writer',
        );
      if (active.length >= capacity)
        throw new AppError(
          409,
          'RUN_CAPACITY',
          'The bounded execution queue is full; wait or cancel a queued run',
        );
      const tree = this.getWorktree(worktreeId);
      if (!tree || tree.taskId !== taskId)
        throw new AppError(
          409,
          'WORKTREE_MISMATCH',
          'Select an active worktree associated with this task',
        );
      const run = this.createRun(taskId, worktreeId, retryOf, options);
      if (options?.provider === 'codex')
        this.workflow.consumeApproval(approvalId!, run);
      this.database
        .prepare('UPDATE runs SET task_snapshot = ? WHERE id = ?')
        .run(JSON.stringify(this.getTask(taskId)), run.id);
      const event = this.insertEvent(run.id, 'run.status', {
        mode: run.mode,
        status: 'queued',
        message:
          run.provider === 'mock'
            ? 'MOCK run queued; no external model will be called'
            : 'Explicitly confirmed Codex run queued',
      });
      this.database.exec('COMMIT');
      return { run, event };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  transitionRun(id: string, status: RunStatus, message: string) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const run = this.getRun(id);
      if (!run) throw new AppError(404, 'RUN_NOT_FOUND', 'Run not found');
      if (!canTransitionRun(run.status, status))
        throw new AppError(
          409,
          'INVALID_RUN_TRANSITION',
          `Cannot transition ${run.status} to ${status}`,
        );
      this.database
        .prepare('UPDATE runs SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, new Date().toISOString(), id);
      const event = this.insertEvent(id, 'run.status', {
        mode: run.mode,
        status,
        message,
      });
      this.database.exec('COMMIT');
      return { run: this.getRun(id)!, event };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  appendProviderEvent(
    runId: string,
    type: string,
    payload: RunEvent['payload'],
  ) {
    const run = this.getRun(runId);
    if (!run || !isActiveRun(run.status))
      throw new AppError(
        409,
        'RUN_NOT_ACTIVE',
        'Cannot append provider output after a run finishes',
      );
    return this.appendEvent(runId, type, payload);
  }

  updateRunMetadata(id: string, data: { threadId?: string; usage?: unknown }) {
    if (data.threadId)
      this.database
        .prepare('UPDATE runs SET thread_id = ? WHERE id = ?')
        .run(data.threadId, id);
    if (data.usage)
      this.database
        .prepare('UPDATE runs SET usage = ? WHERE id = ?')
        .run(JSON.stringify(usageSchema.parse(data.usage)), id);
  }

  listEvents(runId: string) {
    return this.database
      .prepare(
        `SELECT ${eventColumns} FROM events WHERE run_id = ? ORDER BY sequence`,
      )
      .all(runId)
      .map((row) =>
        eventSchema.parse({
          ...row,
          payload: JSON.parse(String(row.payload)) as unknown,
        }),
      );
  }

  saveWorktree(input: Worktree) {
    const record = worktreeSchema.parse(input);
    this.database
      .prepare(
        'INSERT INTO worktrees (id, task_id, repository_id, branch, path, created_at, removed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        record.id,
        record.taskId,
        record.repositoryId,
        record.branch,
        record.path,
        record.createdAt,
        record.removedAt,
      );
    return record;
  }

  listWorktrees(repositoryId?: string) {
    const columns =
      'id, task_id AS taskId, repository_id AS repositoryId, branch, path, created_at AS createdAt, removed_at AS removedAt';
    const rows = repositoryId
      ? this.database
          .prepare(
            `SELECT ${columns} FROM worktrees WHERE removed_at IS NULL AND repository_id = ? ORDER BY created_at, id`,
          )
          .all(repositoryId)
      : this.database
          .prepare(
            `SELECT ${columns} FROM worktrees WHERE removed_at IS NULL ORDER BY created_at, id`,
          )
          .all();
    return rows.map((row) => worktreeSchema.parse(row));
  }

  getWorktree(id: string) {
    return this.listWorktrees().find((record) => record.id === id);
  }
  getTaskWorktree(taskId: string) {
    return this.listWorktrees().find((record) => record.taskId === taskId);
  }
  markWorktreeRemoved(id: string) {
    this.database
      .prepare(
        'UPDATE worktrees SET removed_at = ? WHERE id = ? AND removed_at IS NULL',
      )
      .run(new Date().toISOString(), id);
  }
}
