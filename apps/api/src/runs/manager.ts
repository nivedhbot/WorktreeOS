import { EventEmitter } from 'node:events';
import {
  isActiveRun,
  providerEventSchema,
  eventPayloadSchema,
  type RunEvent,
  type RunStatus,
  type StartRun,
  type Run,
  type Approval,
} from '@worktreeos/shared';
import { AppError } from '../errors.js';
import { GitService } from '../git/service.js';
import { Store } from '../storage/store.js';
import type { AgentProvider } from '../agents/provider.js';
import { CodexProvider } from '../agents/codex-provider.js';
import {
  checkCodexAvailability,
  type AvailabilityCheck,
} from '../agents/codex-availability.js';
import { schedulerConfig, type SchedulerOptions } from './config.js';

interface Execution {
  controller: AbortController;
  done: Promise<void>;
  release: () => void;
  reason?: 'canceled' | 'timeout' | 'interrupted';
}
export class RunManager {
  private readonly active = new Map<string, Execution>();
  private readonly emitter = new EventEmitter();
  private readonly config: ReturnType<typeof schedulerConfig>;
  private readonly timer: ReturnType<typeof setInterval>;
  private closing = false;

  constructor(
    private readonly store: Store,
    private readonly git: GitService,
    private readonly provider: AgentProvider,
    private readonly codex: AgentProvider = new CodexProvider(),
    readonly availability: AvailabilityCheck = checkCodexAvailability,
    options: SchedulerOptions = {},
  ) {
    this.config = schedulerConfig(options);
    this.emitter.setMaxListeners(0);
    git.canRemove = (id) =>
      !store.activeRuns().some((run) => run.worktreeId === id);
    // All in-flight work is interrupted. Queued MOCK work may resume; real consent never survives restart.
    for (const run of store.activeRuns()) {
      if (run.status !== 'queued' || run.provider === 'codex')
        this.transition(
          run.id,
          'interrupted',
          'API restarted before execution finished; review retained files and retry explicitly',
        );
    }
    this.timer = setInterval(() => this.pump(), 100);
    this.timer.unref();
  }
  get(id: string) {
    const run = this.store.getRun(id);
    if (!run) throw new AppError(404, 'RUN_NOT_FOUND', 'Run not found');
    return run;
  }
  subscribe(id: string, listener: (event: RunEvent) => void) {
    this.emitter.on(id, listener);
    return () => {
      this.emitter.off(id, listener);
    };
  }
  private publish(event: RunEvent) {
    this.emitter.emit(event.runId, event);
  }
  private transition(id: string, status: RunStatus, message: string) {
    const result = this.store.transitionRun(id, status, message);
    this.publish(result.event);
    return result.run;
  }

  async start(
    taskId: string,
    worktreeId: string,
    retryOf: string | null = null,
    options?: StartRun,
  ) {
    if (options?.provider === 'codex')
      throw new AppError(
        403,
        'APPROVAL_REQUIRED',
        'Request and confirm a task approval before launching Codex',
      );
    return this.admit(taskId, worktreeId, retryOf, options);
  }

  async requestApproval(
    taskId: string,
    worktreeId: string,
    model: Approval['model'],
  ) {
    if (this.closing)
      throw new AppError(503, 'API_CLOSING', 'API is shutting down');
    await this.git.validate(worktreeId);
    return this.store.workflow.requestApproval(taskId, worktreeId, model);
  }
  async confirmApproval(id: string) {
    const approval = this.store.workflow.getApproval(id);
    this.store.workflow.assertApproval(
      id,
      approval.taskId,
      approval.worktreeId,
      approval.model,
    );
    return this.admit(
      approval.taskId,
      approval.worktreeId,
      null,
      {
        provider: 'codex',
        worktreeId: approval.worktreeId,
        model: approval.model,
        confirmation: {
          repositoryId: approval.context.repository.id,
          worktreePath: approval.context.worktree.path,
          model: approval.model,
          acknowledgeRisk: true,
        },
      },
      id,
    );
  }
  private async admit(
    taskId: string,
    worktreeId: string,
    retryOf: string | null,
    options?: StartRun,
    approvalId?: string,
  ) {
    if (this.closing)
      throw new AppError(503, 'API_CLOSING', 'API is shutting down');
    const task = this.store.getTask(taskId);
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    if (this.store.activeRuns().some((run) => run.taskId === taskId))
      throw new AppError(
        409,
        'DUPLICATE_START',
        'This task already has an active or queued run',
      );
    const tree = await this.git.validate(worktreeId);
    if (tree.taskId !== taskId || tree.repositoryId !== task.repositoryId)
      throw new AppError(
        409,
        'WORKTREE_MISMATCH',
        'Worktree does not belong to the requested task',
      );
    if (options?.provider === 'codex') {
      if (
        options.confirmation.repositoryId !== task.repositoryId ||
        options.confirmation.worktreePath !== tree.path ||
        options.confirmation.model !== options.model
      )
        throw new AppError(
          400,
          'CONFIRMATION_MISMATCH',
          'Review the current repository, worktree and model before confirming',
        );
      const available = await this.availability();
      if (!available.models.includes(options.model))
        throw new AppError(
          422,
          'CODEX_UNAVAILABLE',
          available.error ??
            'Selected model is unavailable to this Codex account',
        );
      if (this.store.getTask(taskId)?.updatedAt !== task.updatedAt)
        throw new AppError(
          409,
          'TASK_CHANGED',
          'The task changed during confirmation; review and confirm again',
        );
    }
    if (this.closing)
      throw new AppError(503, 'API_CLOSING', 'API is shutting down');
    const { run, event } = this.store.reserveRun(
      taskId,
      worktreeId,
      retryOf,
      options,
      this.config.queueCapacity + this.config.concurrency,
      approvalId,
    );
    this.publish(event);
    this.pump();
    return run;
  }

  private pump() {
    if (this.closing) return;
    for (const run of this.store.activeRuns()) {
      if (run.status !== 'queued' || this.active.has(run.id) || !run.worktreeId)
        continue;
      // Expired or changed real consent must leave the queue even when all
      // execution slots are occupied or a prerequisite is no longer runnable.
      if (run.provider === 'codex') {
        try {
          this.store.workflow.assertRunApproval(run);
        } catch (error) {
          this.transition(
            run.id,
            'failed',
            error instanceof AppError
              ? error.message
              : 'Approval validation failed; request a fresh review',
          );
          continue;
        }
      }
      if (!this.store.getWorktree(run.worktreeId)) {
        this.transition(
          run.id,
          'failed',
          'Managed worktree is unavailable; no execution started',
        );
        continue;
      }
      if (this.active.size >= this.config.concurrency) continue;
      if (!this.git.canAcquireExecution(run.worktreeId)) continue;
      if (this.store.workflow.blockedBy(run.taskId, run.provider).length)
        continue;
      const execution: Execution = {
        controller: new AbortController(),
        done: Promise.resolve(),
        release: this.git.acquireExecution(run.worktreeId),
      };
      this.active.set(run.id, execution);
      execution.done = this.execute(run, execution);
    }
  }
  private async execute(run: Run, execution: Execution) {
    const { id } = run;
    const timeout = setTimeout(() => {
      execution.reason = 'timeout';
      execution.controller.abort();
    }, this.config.timeoutMs);
    timeout.unref();
    try {
      this.transition(
        id,
        'preparing',
        `${run.mode}: verifying the associated managed worktree`,
      );
      const tree = await this.git.validate(run.worktreeId!);
      execution.controller.signal.throwIfAborted();
      this.store.workflow.assertRunnable(run.taskId, run.provider);
      if (run.provider === 'codex') this.store.workflow.assertRunApproval(run);
      if (!isActiveRun(this.get(id).status)) return;
      this.transition(
        id,
        'running',
        run.provider === 'mock'
          ? 'MOCK simulation running; no external APIs or commands'
          : 'Confirmed Codex run executing in a read-only sandbox',
      );
      for await (const output of (run.provider === 'codex'
        ? this.codex
        : this.provider
      ).run({
        task: this.store.runTask(id),
        worktree: tree,
        model: run.model,
        signal: execution.controller.signal,
      })) {
        execution.controller.signal.throwIfAborted();
        const event = providerEventSchema.parse(output);
        if (event.mode !== run.mode) throw new Error('Provider mode mismatch');
        if (event.type === 'codex.thread')
          this.store.updateRunMetadata(id, { threadId: event.threadId });
        if (event.type === 'codex.usage')
          this.store.updateRunMetadata(id, { usage: event.usage });
        this.publish(
          this.store.appendProviderEvent(
            id,
            event.type,
            eventPayloadSchema.parse(JSON.parse(JSON.stringify(event))),
          ),
        );
      }
      execution.controller.signal.throwIfAborted();
      if (isActiveRun(this.get(id).status))
        this.transition(
          id,
          'completed',
          run.provider === 'mock'
            ? 'MOCK simulation completed; no real agent was executed'
            : 'Codex read-only run completed',
        );
    } catch (error) {
      if (isActiveRun(this.get(id).status)) {
        const status =
          execution.reason === 'interrupted'
            ? 'interrupted'
            : execution.reason === 'canceled'
              ? 'canceled'
              : 'failed';
        this.transition(
          id,
          status,
          execution.reason === 'timeout'
            ? 'Run timed out; provider canceled. Review retained files and retry explicitly.'
            : execution.reason === 'interrupted'
              ? 'API stopped; provider canceled. Review retained files and retry explicitly.'
              : execution.reason === 'canceled'
                ? `${run.mode} run canceled by explicit request`
                : error instanceof AppError
                  ? error.message
                  : 'Execution failed; inspect repository state and retry explicitly',
        );
      }
    } finally {
      clearTimeout(timeout);
      execution.release();
      this.active.delete(id);
      this.pump();
    }
  }
  async cancel(id: string) {
    const run = this.get(id);
    if (run.status === 'canceled') return run;
    if (!isActiveRun(run.status))
      throw new AppError(
        409,
        'RUN_NOT_ACTIVE',
        'Only an active run can be canceled',
      );
    const execution = this.active.get(id);
    if (execution) {
      execution.reason = 'canceled';
      execution.controller.abort();
      // Keep the lease and active state until the provider has actually stopped.
      await execution.done;
    } else
      this.transition(
        id,
        'canceled',
        `${run.mode} queued run canceled by explicit request`,
      );
    this.pump();
    return this.get(id);
  }
  async retry(id: string) {
    const run = this.get(id);
    if (run.provider === 'codex')
      throw new AppError(
        409,
        'CONFIRMATION_REQUIRED',
        'A new Codex run requires fresh explicit confirmation',
      );
    if (!['failed', 'canceled', 'interrupted'].includes(run.status))
      throw new AppError(
        409,
        'RETRY_NOT_ALLOWED',
        'Only failed, canceled or interrupted runs can be retried',
      );
    if (!run.worktreeId)
      throw new AppError(
        409,
        'WORKTREE_REQUIRED',
        'This historical run has no associated worktree',
      );
    return this.start(run.taskId, run.worktreeId, run.id);
  }
  eventsSince(id: string, since?: string) {
    this.get(id);
    return this.store.listEvents(id, since);
  }
  async shutdown() {
    this.closing = true;
    clearInterval(this.timer);
    for (const execution of this.active.values()) {
      execution.reason = 'interrupted';
      execution.controller.abort();
    }
    for (const run of this.store.activeRuns()) {
      if (!this.active.has(run.id) && run.provider === 'codex')
        this.transition(
          run.id,
          'interrupted',
          'API stopped before confirmed Codex execution; confirm a new run explicitly',
        );
    }
    await Promise.all(
      [...this.active.values()].map((execution) => execution.done),
    );
  }
}
