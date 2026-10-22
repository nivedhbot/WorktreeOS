import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isActiveRun,
  runSchema,
  type Run,
  type RunEvent,
  type ProviderEvent,
} from '@worktreeos/shared';
import { buildApp } from '../app.js';
import { MockProvider } from '../agents/mock-provider.js';
import type { AgentContext, AgentProvider } from '../agents/provider.js';
import { Store } from '../storage/store.js';
import { commitFixture, createFixture } from '../test/fixtures.js';

describe('MOCK runs and durable streaming', { timeout: 15000 }, () => {
  let fixture: ReturnType<typeof createFixture>;
  let app: ReturnType<typeof buildApp>;
  let taskId: string;
  let worktreeId: string;
  let worktreePath: string;
  beforeEach(async () => {
    fixture = createFixture();
    commitFixture(fixture);
    app = buildApp(
      {},
      {
        dataDir: fixture.dataDir,
        provider: new MockProvider(10),
        heartbeatMs: 10,
      },
    );
    const repo = await app.inject({
      method: 'POST',
      url: '/api/repos',
      payload: { name: 'Runs fixture', path: fixture.repoPath },
    });
    const task = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        repositoryId: repo.json().id,
        title: 'MOCK task',
        objective: 'Simulate only',
      },
    });
    taskId = task.json().id;
    const tree = await app.inject({
      method: 'POST',
      url: '/api/worktrees',
      payload: { taskId },
    });
    expect(tree.statusCode, tree.body).toBe(201);
    worktreeId = tree.json().id;
    worktreePath = tree.json().path;
  });
  afterEach(async () => {
    await app.close();
    fixture.cleanup();
  });

  async function start() {
    const response = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/runs`,
      payload: { worktreeId },
    });
    expect(response.statusCode, response.body).toBe(202);
    return runSchema.parse(response.json());
  }
  async function getRun(id: string) {
    return runSchema.parse((await app.inject(`/api/runs/${id}`)).json());
  }
  async function waitFor(
    id: string,
    predicate: (run: Run) => boolean = (run) => !isActiveRun(run.status),
  ) {
    let run = await getRun(id);
    for (let index = 0; index < 300 && !predicate(run); index++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      run = await getRun(id);
    }
    expect(predicate(run), `Run ${id} remained ${run.status}`).toBe(true);
    return run;
  }
  async function events(id: string): Promise<RunEvent[]> {
    return (await app.inject(`/api/runs/${id}/events`)).json().events;
  }

  it('streams deterministic MOCK progress/tool/file events and persists completion without touching files', async () => {
    const initial = await start();
    expect(initial).toMatchObject({
      mode: 'MOCK',
      status: 'queued',
      worktreeId,
      retryOf: null,
    });
    const run = await waitFor(initial.id);
    expect(run.status).toBe('completed');
    const log = await events(run.id);
    expect(log.map((event) => event.sequence)).toEqual(
      log.map((_, index) => index + 1),
    );
    expect(
      log
        .filter((event) => event.type === 'run.status')
        .map((event) => event.payload.status),
    ).toEqual(['queued', 'preparing', 'running', 'completed']);
    expect(log.every((event) => event.payload.mode === 'MOCK')).toBe(true);
    expect(log.map((event) => event.type)).toEqual(
      expect.arrayContaining(['mock.progress', 'mock.tool', 'mock.file']),
    );
    expect(
      log.find((event) => event.type === 'mock.file')?.payload.simulated,
    ).toBe(true);
    expect(readFileSync(join(worktreePath, 'README.md'), 'utf8')).toBe(
      'Initial content\n',
    );
    expect(
      (await app.inject(`/api/worktrees/${worktreeId}/status`)).json().clean,
    ).toBe(true);
    await app.close();
    app = buildApp({}, { dataDir: fixture.dataDir });
    expect(await getRun(run.id)).toEqual(run);
    expect(await events(run.id)).toEqual(log);
    expect((await app.inject(`/api/tasks/${taskId}/runs`)).json().runs).toEqual(
      [run],
    );
  });

  it('blocks duplicate starts, mismatched worktrees, and overlapping tasks', async () => {
    // Hold execution until explicit cancellation; a 60ms simulation can finish while real Git checks run.
    await app.close();
    app = buildApp(
      {},
      { dataDir: fixture.dataDir, provider: new MockProvider(60000) },
    );
    const missing = await app.inject({
      method: 'POST',
      url: `/api/tasks/${randomUUID()}/runs`,
      payload: { worktreeId },
    });
    expect(missing.statusCode).toBe(404);
    const otherTask = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        repositoryId: (await app.inject(`/api/worktrees/${worktreeId}`)).json()
          .repositoryId,
        title: 'Other',
        objective: 'Other',
      },
    });
    const mismatch = await app.inject({
      method: 'POST',
      url: `/api/tasks/${otherTask.json().id}/runs`,
      payload: { worktreeId },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe('WORKTREE_MISMATCH');
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/runs`,
        payload: { worktreeId },
      }),
      app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/runs`,
        payload: { worktreeId },
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([202, 409]);
    const active = [first, second]
      .find((response) => response.statusCode === 202)!
      .json();
    const overlap = await app.inject({
      method: 'POST',
      url: `/api/tasks/${otherTask.json().id}/runs`,
      payload: { worktreeId },
    });
    expect(overlap.statusCode).toBe(409);
    const removal = await app.inject({
      method: 'DELETE',
      url: `/api/worktrees/${worktreeId}`,
      payload: { confirm: true },
    });
    expect(removal.statusCode).toBe(409);
    expect(removal.json().error.code).toBe('WORKTREE_IN_USE');
    await app.inject({ method: 'POST', url: `/api/runs/${active.id}/cancel` });
  });

  it('cancels preparing runs idempotently and retries with a new linked run and preserved history', async () => {
    const run = await start();
    const canceled = await app.inject({
      method: 'POST',
      url: `/api/runs/${run.id}/cancel`,
    });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().status).toBe('canceled');
    const history = await events(run.id);
    expect(
      (
        await app.inject({ method: 'POST', url: `/api/runs/${run.id}/cancel` })
      ).json().status,
    ).toBe('canceled');
    const retry = await app.inject({
      method: 'POST',
      url: `/api/runs/${run.id}/retry`,
    });
    expect(retry.statusCode, retry.body).toBe(202);
    expect(retry.json().id).not.toBe(run.id);
    expect(retry.json().retryOf).toBe(run.id);
    expect((await waitFor(retry.json().id)).status).toBe('completed');
    expect(await events(run.id)).toEqual(history);
  });

  it('cancels a running provider and appends no output after cancellation', async () => {
    await app.close();
    app = buildApp(
      {},
      { dataDir: fixture.dataDir, provider: new MockProvider(100) },
    );
    const run = await start();
    await waitFor(run.id, (item) => item.status === 'running');
    const canceled = await app.inject({
      method: 'POST',
      url: `/api/runs/${run.id}/cancel`,
    });
    expect(canceled.json().status).toBe('canceled');
    const log = await events(run.id);
    await new Promise((resolve) => setTimeout(resolve, 130));
    expect(await events(run.id)).toEqual(log);
    expect(log.at(-1)?.payload.status).toBe('canceled');
    const removal = await app.inject({
      method: 'DELETE',
      url: `/api/worktrees/${worktreeId}`,
      payload: { confirm: true },
    });
    expect(removal.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: `/api/runs/${run.id}/retry` }))
        .statusCode,
    ).toBe(404);
  });

  it('handles provider failures without leaking raw errors and permits explicit retry', async () => {
    const failing: AgentProvider = {
      id: 'mock',
      mode: 'MOCK',
      async *run({ signal }: AgentContext): AsyncIterable<ProviderEvent> {
        signal.throwIfAborted();
        yield {
          type: 'mock.message',
          mode: 'MOCK',
          message: 'MOCK failing fixture',
        };
        throw new Error('private-token-and-path-must-not-leak');
      },
    };
    await app.close();
    app = buildApp({}, { dataDir: fixture.dataDir, provider: failing });
    const run = await start();
    expect((await waitFor(run.id)).status).toBe('failed');
    expect(JSON.stringify(await events(run.id))).not.toContain('private-token');
    await app.close();
    app = buildApp(
      {},
      { dataDir: fixture.dataDir, provider: new MockProvider(0) },
    );
    const retry = await app.inject({
      method: 'POST',
      url: `/api/runs/${run.id}/retry`,
    });
    expect(retry.statusCode).toBe(202);
    expect((await waitFor(retry.json().id)).status).toBe('completed');
  });

  it('rejects invalid transitions, completed cancellation/retry, and mutation of appended events', async () => {
    const run = await start();
    await waitFor(run.id);
    expect(
      (await app.inject({ method: 'POST', url: `/api/runs/${run.id}/cancel` }))
        .statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ method: 'POST', url: `/api/runs/${run.id}/retry` }))
        .statusCode,
    ).toBe(409);
    const store = new Store(fixture.dataDir);
    try {
      const queued = store.createRun(taskId);
      expect(() =>
        store.transitionRun(queued.id, 'completed', 'Invalid jump'),
      ).toThrow('Cannot transition');
      expect(store.getRun(queued.id)?.status).toBe('queued');
      expect(store.listEvents(queued.id)).toEqual([]);
      expect(() => store.transitionRun(run.id, 'running', 'Invalid')).toThrow(
        'Cannot transition',
      );
      expect(() =>
        store.appendProviderEvent(run.id, 'mock.message', { mode: 'MOCK' }),
      ).toThrow('after a run finishes');
    } finally {
      store.close();
    }
    const db = new DatabaseSync(join(fixture.dataDir, 'worktreeos.sqlite'));
    try {
      expect(() =>
        db
          .prepare('UPDATE events SET type = ? WHERE run_id = ?')
          .run('tampered', run.id),
      ).toThrow('append-only');
      expect(() =>
        db.prepare('DELETE FROM events WHERE run_id = ?').run(run.id),
      ).toThrow('append-only');
    } finally {
      db.close();
    }
  });

  it('replays SSE since persisted UUID via query or Last-Event-ID, including after restart', async () => {
    const run = await start();
    await waitFor(run.id);
    const log = await events(run.id);
    const cursor = log[3]!;
    await app.close();
    app = buildApp({}, { dataDir: fixture.dataDir });
    for (const request of [
      { url: `/api/runs/${run.id}/stream?since=${cursor.id}` },
      {
        url: `/api/runs/${run.id}/stream`,
        headers: { 'last-event-id': cursor.id },
      },
    ]) {
      const replay = await app.inject(request);
      expect(replay.statusCode).toBe(200);
      expect(replay.headers['content-type']).toContain('text/event-stream');
      expect(replay.body).not.toContain(`id: ${cursor.id}`);
      const ids = replay.body
        .split('\n')
        .filter((line) => line.startsWith('id: '))
        .map((line) => line.slice(4));
      expect(ids).toEqual(log.slice(4).map((event) => event.id));
    }
    expect(
      (await app.inject(`/api/runs/${run.id}/stream?since=${randomUUID()}`))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject(`/api/runs/${run.id}/stream?since=invalid`)).statusCode,
    ).toBe(400);
    expect(
      (await app.inject(`/api/runs/${randomUUID()}/events`)).statusCode,
    ).toBe(404);
  });

  it('sends live SSE events and heartbeats and closes on completion', async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing test server');
    const run = await start();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/runs/${run.id}/stream`,
      { signal: AbortSignal.timeout(8000) },
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain(': heartbeat MOCK');
    expect(body).toContain('mock.progress');
    expect(body).toContain('"status":"completed"');
    const ids = body
      .split('\n')
      .filter((line) => line.startsWith('id: '))
      .map((line) => line.slice(4));
    expect(ids).toEqual((await events(run.id)).map((event) => event.id));
  });

  it('gracefully closes live streams and cancels a provider on API shutdown', async () => {
    await app.close();
    app = buildApp(
      {},
      { dataDir: fixture.dataDir, provider: new MockProvider(1000) },
    );
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing test server');
    const run = await start();
    await waitFor(run.id, (item) => item.status === 'running');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/runs/${run.id}/stream`,
      { signal: AbortSignal.timeout(8000) },
    );
    const stream = response.text();
    await app.close();
    await stream;
    app = buildApp({}, { dataDir: fixture.dataDir });
    expect((await getRun(run.id)).status).toBe('interrupted');
  });

  it('blocks duplicate persisted queued tasks and allows explicit queue cancellation', async () => {
    const store = new Store(fixture.dataDir);
    const stale = store.reserveRun(taskId, worktreeId).run;
    store.close();
    expect(isActiveRun((await getRun(stale.id)).status)).toBe(true);
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/runs`,
      payload: { worktreeId },
    });
    expect(blocked.statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/runs/${stale.id}/cancel`,
        })
      ).json().status,
    ).toBe('canceled');
    const retry = await app.inject({
      method: 'POST',
      url: `/api/runs/${stale.id}/retry`,
    });
    expect(retry.statusCode).toBe(202);
    await waitFor(retry.json().id);
  });
});
