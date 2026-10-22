import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run, Worktree } from '@worktreeos/shared';
import { buildApp } from '../app.js';
import type { AgentContext, AgentProvider } from '../agents/provider.js';
import { MockProvider } from '../agents/mock-provider.js';
import { Store } from '../storage/store.js';
import { commitFixture, createFixture } from '../test/fixtures.js';
import { schedulerConfig } from './config.js';
import { KeyedLock } from '../git/keyed-lock.js';

class ControlledProvider implements AgentProvider {
  readonly id = 'mock' as const;
  readonly mode = 'MOCK' as const;
  readonly live = new Map<string, AgentContext>();
  readonly seen: AgentContext[] = [];
  readonly finish = new Map<string, () => void>();
  peak = 0;
  async *run(context: AgentContext) {
    this.live.set(context.task.id, context);
    this.seen.push(context);
    this.peak = Math.max(this.peak, this.live.size);
    try {
      yield {
        type: 'mock.message' as const,
        mode: 'MOCK' as const,
        message: 'Controlled MOCK started',
      };
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(context.signal.reason);
        this.finish.set(context.task.id, () => {
          context.signal.removeEventListener('abort', abort);
          resolve();
        });
        context.signal.addEventListener('abort', abort, { once: true });
        if (context.signal.aborted) abort();
      });
    } finally {
      this.live.delete(context.task.id);
      this.finish.delete(context.task.id);
    }
  }
}

describe('persistent bounded scheduler', { timeout: 20000 }, () => {
  let first: ReturnType<typeof createFixture>;
  let second: ReturnType<typeof createFixture>;
  let app: ReturnType<typeof buildApp>;
  let provider: ControlledProvider;
  let repoA: string;
  let repoB: string;
  beforeEach(async () => {
    first = createFixture();
    second = createFixture();
    commitFixture(first);
    commitFixture(second);
    provider = new ControlledProvider();
    app = buildApp({}, { dataDir: first.dataDir, provider });
    repoA = (
      await app.inject({
        method: 'POST',
        url: '/api/repos',
        payload: { name: 'A', path: first.repoPath },
      })
    ).json().id;
    repoB = (
      await app.inject({
        method: 'POST',
        url: '/api/repos',
        payload: { name: 'B', path: second.repoPath },
      })
    ).json().id;
  });
  afterEach(async () => {
    await app.close();
    second.cleanup();
    first.cleanup();
  });
  async function task(repositoryId: string, objective = 'Original objective') {
    const record = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { repositoryId, title: 'Scheduler task', objective },
      })
    ).json();
    const response = await app.inject({
      method: 'POST',
      url: '/api/worktrees',
      payload: { taskId: record.id },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<Worktree>();
  }
  async function start(tree: Worktree) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/tasks/${tree.taskId}/runs`,
      payload: { worktreeId: tree.id },
    });
    expect(response.statusCode, response.body).toBe(202);
    return response.json<Run>();
  }
  async function get(id: string) {
    return (await app.inject(`/api/runs/${id}`)).json<Run>();
  }
  async function until(predicate: () => boolean | Promise<boolean>) {
    for (let index = 0; index < 400; index++) {
      if (await predicate()) return;
      await delay(10);
    }
    throw new Error('Scheduler condition timed out');
  }
  it('runs two independent repos concurrently, serializes writers within a repo, blocks duplicate worktrees, and snapshots queued objectives', async () => {
    const a1 = await task(repoA);
    const a2 = await task(repoA);
    const b1 = await task(repoB);
    const one = await start(a1);
    const waiting = await start(a2);
    const two = await start(b1);
    await until(() => provider.live.size === 2);
    expect(provider.live.has(a1.taskId)).toBe(true);
    expect(provider.live.has(b1.taskId)).toBe(true);
    expect((await get(waiting.id)).status).toBe('queued');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/tasks/${a1.taskId}/runs`,
          payload: { worktreeId: a1.id },
        })
      ).json().error.code,
    ).toBe('DUPLICATE_START');
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/worktrees/${a2.id}`,
          payload: { confirm: true },
        })
      ).json().error.code,
    ).toBe('WORKTREE_IN_USE');
    await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${a2.taskId}`,
      payload: { objective: 'Edited after enqueue' },
    });
    provider.finish.get(a1.taskId)!();
    await until(() => provider.live.has(a2.taskId));
    expect(
      provider.seen.find((item) => item.task.id === a2.taskId)?.task.objective,
    ).toBe('Original objective');
    expect((await get(one.id)).status).toBe('completed');
    expect(provider.peak).toBe(2);
    expect((await get(two.id)).status).toBe('running');
  });
  it('bounds pending work, cancels queued and running work without deleting diffs, and retries only explicitly', async () => {
    const a = await task(repoA);
    const b = await task(repoB);
    const c = await task(repoB);
    await app.close();
    app = buildApp(
      {},
      {
        dataDir: first.dataDir,
        provider,
        scheduler: { concurrency: 1, queueCapacity: 1 },
      },
    );
    const one = await start(a);
    await until(() => provider.live.size === 1);
    const waiting = await start(b);
    const full = await app.inject({
      method: 'POST',
      url: `/api/tasks/${c.taskId}/runs`,
      payload: { worktreeId: c.id },
    });
    expect(full.statusCode).toBe(409);
    expect(full.json().error.code).toBe('RUN_CAPACITY');
    expect((await get(waiting.id)).status).toBe('queued');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/runs/${waiting.id}/cancel`,
        })
      ).json().status,
    ).toBe('canceled');
    expect(provider.seen.some((item) => item.task.id === b.taskId)).toBe(false);
    writeFileSync(join(a.path, 'review.txt'), 'Preserve this diff\n');
    expect(
      (
        await app.inject({ method: 'POST', url: `/api/runs/${one.id}/cancel` })
      ).json().status,
    ).toBe('canceled');
    expect(provider.live.size).toBe(0);
    expect(provider.seen[0]?.signal.aborted).toBe(true);
    expect(readFileSync(join(a.path, 'review.txt'), 'utf8')).toBe(
      'Preserve this diff\n',
    );
    await delay(150);
    expect(provider.seen).toHaveLength(1);
    const retry = await app.inject({
      method: 'POST',
      url: `/api/runs/${waiting.id}/retry`,
    });
    expect(retry.statusCode).toBe(202);
    expect(retry.json().retryOf).toBe(waiting.id);
    await until(() => provider.live.has(b.taskId));
  });
  it('times out cleanly, retains failure history, and does not retry automatically', async () => {
    const a = await task(repoA);
    await app.close();
    app = buildApp(
      {},
      { dataDir: first.dataDir, provider, scheduler: { timeoutMs: 2000 } },
    );
    const run = await start(a);
    await until(async () => (await get(run.id)).status === 'failed');
    expect(provider.live.size).toBe(0);
    expect(provider.seen[0]?.signal.aborted).toBe(true);
    expect(
      (await app.inject(`/api/runs/${run.id}/events`)).json().events.at(-1)
        .payload.message,
    ).toContain('timed out');
    await delay(200);
    expect(provider.seen).toHaveLength(1);
  });
  it('reconciles interrupted writers and queued Codex runs, resumes only queued MOCK work, and requires fresh real consent', async () => {
    const a = await task(repoA);
    const b = await task(repoB);
    const c = await task(repoA);
    await app.close();
    const store = new Store(first.dataDir);
    const prior = store.reserveRun(a.taskId, a.id, null, undefined, 10).run;
    store.transitionRun(prior.id, 'preparing', 'prepare');
    store.transitionRun(prior.id, 'running', 'running');
    const queued = store.reserveRun(b.taskId, b.id, null, undefined, 10).run;
    const approval = store.workflow.requestApproval(
      c.taskId,
      c.id,
      'gpt-6-luna',
    );
    const real = store.reserveRun(
      c.taskId,
      c.id,
      null,
      {
        provider: 'codex',
        worktreeId: c.id,
        model: 'gpt-6-luna',
        confirmation: {
          repositoryId: c.repositoryId,
          worktreePath: c.path,
          model: 'gpt-6-luna',
          acknowledgeRisk: true,
        },
      },
      10,
      approval.id,
    ).run;
    store.close();
    const realInvoked = vi.fn();
    const realProvider: AgentProvider = {
      id: 'codex',
      mode: 'CODEX',
      async *run() {
        realInvoked();
        yield {
          type: 'codex.thread',
          mode: 'CODEX',
          message: 'unexpected',
          threadId: 'unexpected',
        };
      },
    };
    app = buildApp(
      {},
      {
        dataDir: first.dataDir,
        provider: new MockProvider(1),
        codexProvider: realProvider,
      },
    );
    expect((await get(prior.id)).status).toBe('interrupted');
    expect((await get(real.id)).status).toBe('interrupted');
    await until(async () => (await get(queued.id)).status === 'completed');
    expect(realInvoked).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({ method: 'POST', url: `/api/runs/${real.id}/retry` })
      ).json().error.code,
    ).toBe('CONFIRMATION_REQUIRED');
    expect(
      (await app.inject(`/api/tasks/${a.taskId}/runs`)).json().runs,
    ).toHaveLength(1);
  });
  it('prevents a second scheduler from opening the same data directory and releases ownership on close', async () => {
    expect(() => buildApp({}, { dataDir: first.dataDir })).toThrow(
      'Another WorktreeOS API',
    );
    await app.close();
    app = buildApp({}, { dataDir: first.dataDir });
    expect((await app.inject('/api/health')).statusCode).toBe(200);
  });
});

it('rejects concurrency above two and invalid queue/timeout settings', () => {
  expect(() => schedulerConfig({ concurrency: 3 })).toThrow();
  expect(() => schedulerConfig({ concurrency: 0 })).toThrow();
  expect(() => schedulerConfig({ queueCapacity: 0 })).toThrow();
  expect(() => schedulerConfig({ timeoutMs: 0 })).toThrow();
});
it('serializes per-repo Git locks, releases after failure, and allows independent keys', async () => {
  const lock = new KeyedLock();
  const order: string[] = [];
  let release!: () => void;
  const first = lock.run('repo-a', async () => {
    order.push('a1');
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    throw new Error('expected');
  });
  const rejected = expect(first).rejects.toThrow('expected');
  const second = lock.run('repo-a', async () => {
    order.push('a2');
  });
  await lock.run('repo-b', async () => {
    order.push('b');
  });
  expect(order).toEqual(['a1', 'b']);
  release();
  await rejected;
  await second;
  expect(order).toEqual(['a1', 'b', 'a2']);
});
