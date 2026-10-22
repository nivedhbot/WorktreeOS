import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  approvalSchema,
  dependencyIdsSchema,
  dependencySchema,
  isDag,
  type Approval,
  type Run,
} from '@worktreeos/shared';
import type { Store } from './store.js';
import { AppError } from '../errors.js';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const columns =
  'id, task_id AS taskId, worktree_id AS worktreeId, model, status, context, fingerprint, run_id AS runId, created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt';
export class WorkflowStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly store: Store,
  ) {}
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = operation();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  dependencies() {
    return this.db
      .prepare(
        'SELECT task_id AS taskId, depends_on_id AS dependsOnId FROM dependencies ORDER BY task_id, depends_on_id',
      )
      .all()
      .map((row) => dependencySchema.parse(row));
  }
  dependencyIds(id: string) {
    return this.dependencies()
      .filter((edge) => edge.taskId === id)
      .map((edge) => edge.dependsOnId);
  }
  setDependenciesInTransaction(id: string, input: string[]) {
    const ids = dependencyIdsSchema.parse(input);
    for (const parent of ids)
      if (!this.store.getTask(parent))
        throw new AppError(
          404,
          'DEPENDENCY_NOT_FOUND',
          'A prerequisite task does not exist',
        );
    const edges = this.dependencies()
      .filter((edge) => edge.taskId !== id)
      .concat(ids.map((dependsOnId) => ({ taskId: id, dependsOnId })));
    if (
      !isDag(
        this.store.listTasks().map((task) => task.id),
        edges,
      )
    )
      throw new AppError(
        409,
        'DEPENDENCY_CYCLE',
        'This prerequisite would create a dependency cycle',
      );
    this.db.prepare('DELETE FROM dependencies WHERE task_id = ?').run(id);
    for (const parent of ids)
      this.db
        .prepare(
          'INSERT INTO dependencies(task_id, depends_on_id) VALUES (?, ?)',
        )
        .run(id, parent);
  }
  editDependencies(id: string, ids: string[]) {
    if (!this.store.getTask(id))
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    return this.transaction(() => {
      if (this.store.activeRuns().some((run) => run.taskId === id))
        throw new AppError(
          409,
          'TASK_BUSY',
          'Cancel or finish this task before changing its prerequisites',
        );
      this.setDependenciesInTransaction(id, ids);
      this.db
        .prepare(
          'UPDATE tasks SET revision = revision + 1, updated_at = ? WHERE id = ?',
        )
        .run(new Date().toISOString(), id);
      this.invalidateAffected(id);
      return { taskId: id, dependencyIds: this.dependencyIds(id) };
    });
  }
  invalidateAffected(id: string) {
    const affected = new Set([id]);
    const edges = this.dependencies();
    for (const current of affected)
      for (const edge of edges)
        if (edge.dependsOnId === current) affected.add(edge.taskId);
    for (const taskId of affected)
      this.db
        .prepare(
          "UPDATE approvals SET status = 'invalidated', updated_at = ? WHERE task_id = ? AND status = 'pending'",
        )
        .run(new Date().toISOString(), taskId);
  }
  blockedBy(id: string, provider: Run['provider']): string[] {
    return this.dependencyIds(id).filter((parent) => {
      return (
        !this.hasCurrentCompletion(parent, provider) ||
        this.blockedAncestor(parent, provider, new Set())
      );
    });
  }
  private hasCurrentCompletion(id: string, provider: Run['provider']) {
    const latest = this.store
      .listRuns(id)
      .filter((run) => run.provider === provider)
      .at(-1);
    if (!latest || !latest.worktreeId || latest.status !== 'completed')
      return false;
    const snapshot = this.store.runTask(latest.id);
    const task = this.store.getTask(id);
    return (
      !!task &&
      (snapshot.revision ?? 0) === (task.revision ?? 0) &&
      snapshot.objective === task.objective &&
      snapshot.title === task.title
    );
  }
  private blockedAncestor(
    id: string,
    provider: Run['provider'],
    seen: Set<string>,
  ): boolean {
    const pending = this.dependencyIds(id);
    for (let index = 0; index < pending.length; index++) {
      const parent = pending[index]!;
      if (seen.has(parent)) continue;
      seen.add(parent);
      if (!this.hasCurrentCompletion(parent, provider)) return true;
      pending.push(...this.dependencyIds(parent));
    }
    return false;
  }
  assertRunnable(id: string, provider: Run['provider']) {
    if (this.blockedBy(id, provider).length)
      throw new AppError(
        409,
        'DEPENDENCIES_BLOCKED',
        `${provider === 'mock' ? 'MOCK' : 'Codex'} prerequisites must complete for their current task revisions before starting`,
      );
  }
  graph() {
    const tasks = this.store.listTasks();
    return {
      tasks,
      dependencies: this.dependencies(),
      readiness: tasks.map((task) => ({
        taskId: task.id,
        mockBlockedBy: this.blockedBy(task.id, 'mock'),
        codexBlockedBy: this.blockedBy(task.id, 'codex'),
      })),
    };
  }

  private context(
    taskId: string,
    worktreeId: string,
    model: Approval['model'],
  ) {
    const task = this.store.getTask(taskId);
    const worktree = this.store.getWorktree(worktreeId);
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    if (
      !worktree ||
      worktree.taskId !== taskId ||
      worktree.repositoryId !== task.repositoryId
    )
      throw new AppError(
        409,
        'WORKTREE_MISMATCH',
        'Select the active managed worktree for this task',
      );
    const ancestors = new Set<string>(this.dependencyIds(taskId));
    for (const id of ancestors)
      for (const parent of this.dependencyIds(id)) ancestors.add(parent);
    const signature = [...ancestors].sort().map((id) => ({
      task: this.store.getTask(id),
      run:
        this.store
          .listRuns(id)
          .filter((run) => run.provider === 'codex')
          .at(-1) ?? null,
    }));
    return {
      repository: this.store.getRepository(task.repositoryId)!,
      task,
      worktree,
      model,
      prerequisiteFingerprint: hash(signature),
    };
  }
  getApproval(id: string) {
    const row = this.db
      .prepare(`SELECT ${columns} FROM approvals WHERE id = ?`)
      .get(id);
    if (!row)
      throw new AppError(404, 'APPROVAL_NOT_FOUND', 'Approval not found');
    return approvalSchema.parse({
      ...row,
      context: JSON.parse(String(row.context)) as unknown,
    });
  }
  listApprovals() {
    return this.db
      .prepare('SELECT id FROM approvals ORDER BY created_at, rowid')
      .all()
      .map((row) => this.getApproval(String(row.id)));
  }
  requestApproval(
    taskId: string,
    worktreeId: string,
    model: Approval['model'],
  ) {
    return this.transaction(() => {
      this.assertRunnable(taskId, 'codex');
      if (this.store.activeRuns().some((run) => run.taskId === taskId))
        throw new AppError(
          409,
          'DUPLICATE_START',
          'This task already has an active or queued run',
        );
      for (const pending of this.listApprovals().filter(
        (approval) =>
          approval.taskId === taskId && approval.status === 'pending',
      )) {
        let current = false;
        try {
          current =
            Date.parse(pending.expiresAt) > Date.now() &&
            pending.fingerprint ===
              hash(this.context(taskId, pending.worktreeId, pending.model));
        } catch {
          /* A removed/replaced worktree invalidates the prior request. */
        }
        if (current)
          throw new AppError(
            409,
            'APPROVAL_PENDING',
            'This task already has an approval waiting for review',
          );
        this.db
          .prepare(
            "UPDATE approvals SET status = 'invalidated', updated_at = ? WHERE id = ?",
          )
          .run(new Date().toISOString(), pending.id);
      }
      const context = this.context(taskId, worktreeId, model);
      const now = new Date().toISOString();
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO approvals(id, task_id, worktree_id, model, status, context, fingerprint, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          taskId,
          worktreeId,
          model,
          JSON.stringify(context),
          hash(context),
          now,
          now,
          new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        );
      return this.getApproval(id);
    });
  }
  assertApproval(
    id: string,
    taskId: string,
    worktreeId: string,
    model: Approval['model'],
  ) {
    const approval = this.getApproval(id);
    if (approval.status !== 'pending')
      throw new AppError(
        409,
        'APPROVAL_ALREADY_USED',
        'This approval is no longer pending; request a new review',
      );
    this.assertContext(approval, taskId, worktreeId, model);
    this.assertRunnable(taskId, 'codex');
    return approval;
  }
  private assertContext(
    approval: Approval,
    taskId: string,
    worktreeId: string,
    model: Approval['model'],
  ) {
    if (
      approval.taskId !== taskId ||
      approval.worktreeId !== worktreeId ||
      approval.model !== model ||
      Date.parse(approval.expiresAt) <= Date.now() ||
      approval.fingerprint !== hash(this.context(taskId, worktreeId, model))
    )
      throw new AppError(
        409,
        'APPROVAL_STALE',
        'The approved context changed or expired; request and review a fresh approval',
      );
  }
  consumeApproval(id: string, run: Run) {
    this.assertApproval(id, run.taskId, run.worktreeId!, run.model!);
    this.db
      .prepare(
        "UPDATE approvals SET status = 'consumed', run_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(run.id, new Date().toISOString(), id);
  }
  assertRunApproval(run: Run) {
    const row = this.db
      .prepare(
        "SELECT id FROM approvals WHERE run_id = ? AND status = 'consumed'",
      )
      .get(run.id);
    if (!row)
      throw new AppError(
        403,
        'APPROVAL_REQUIRED',
        'A real run requires a single-use task approval',
      );
    this.assertContext(
      this.getApproval(String(row.id)),
      run.taskId,
      run.worktreeId!,
      run.model!,
    );
  }
  rejectApproval(id: string) {
    return this.transaction(() => {
      if (this.getApproval(id).status !== 'pending')
        throw new AppError(
          409,
          'APPROVAL_ALREADY_USED',
          'Only a pending approval can be rejected',
        );
      this.db
        .prepare(
          "UPDATE approvals SET status = 'rejected', updated_at = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), id);
      return this.getApproval(id);
    });
  }
}
