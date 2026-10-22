import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Approval, Run, Task, Worktree } from '@worktreeos/shared';
import { buildApp } from '../app.js';
import { commitFixture, createFixture } from '../test/fixtures.js';
import { MockProvider } from '../agents/mock-provider.js';
import type { AgentProvider } from '../agents/provider.js';

describe(
  'task DAGs and durable single-use approvals',
  { timeout: 20000 },
  () => {
    let fixture: ReturnType<typeof createFixture>;
    let app: ReturnType<typeof buildApp>;
    let repoId: string;
    const invoked = vi.fn();
    const provider: AgentProvider = {
      id: 'codex',
      mode: 'CODEX',
      async *run(context) {
        invoked(context);
        yield {
          type: 'codex.thread',
          mode: 'CODEX',
          threadId: 'test-only-thread',
          message: 'SDK fake',
        };
      },
    };
    const availability = async () => ({
      models: ['gpt-6-luna' as const],
      error: null,
    });
    beforeEach(async () => {
      invoked.mockClear();
      fixture = createFixture();
      commitFixture(fixture);
      app = buildApp(
        {},
        {
          dataDir: fixture.dataDir,
          provider: new MockProvider(1),
          codexProvider: provider,
          codexAvailability: availability,
        },
      );
      repoId = (
        await app.inject({
          method: 'POST',
          url: '/api/repos',
          payload: { name: 'DAG fixture', path: fixture.repoPath },
        })
      ).json().id;
    });
    afterEach(async () => {
      await app.close();
      fixture.cleanup();
    });
    async function task(title = 'Task', dependencyIds: string[] = []) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          repositoryId: repoId,
          title,
          objective: 'Inspect only',
          dependencyIds,
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<Task>();
    }
    async function tree(task: Task) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/worktrees',
        payload: { taskId: task.id },
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<Worktree>();
    }
    const edit = (id: string, dependencyIds: string[]) =>
      app.inject({
        method: 'PATCH',
        url: `/api/tasks/${id}/dependencies`,
        payload: { dependencyIds },
      });
    async function request(
      worktree: Worktree,
      model: Approval['model'] = 'gpt-6-luna',
    ) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/tasks/${worktree.taskId}/approvals`,
        payload: { worktreeId: worktree.id, model },
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<Approval>();
    }
    const confirm = (id: string) =>
      app.inject({
        method: 'POST',
        url: `/api/approvals/${id}/confirm`,
        payload: { acknowledgeRisk: true },
      });
    async function done(id: string) {
      for (let index = 0; index < 200; index++) {
        const run = (await app.inject(`/api/runs/${id}`)).json<Run>();
        if (['completed', 'failed', 'canceled'].includes(run.status))
          return run;
        await delay(10);
      }
      throw new Error('Run did not finish');
    }
    it('saves a DAG at creation/edit, rejects missing references, duplicates/self/transitive cycles and rolls back failures', async () => {
      const a = await task('A');
      const b = await task('B', [a.id]);
      const c = await task('C', [b.id]);
      expect((await edit(a.id, [c.id])).json().error.code).toBe(
        'DEPENDENCY_CYCLE',
      );
      expect((await edit(a.id, [a.id])).json().error.code).toBe(
        'DEPENDENCY_CYCLE',
      );
      expect((await edit(a.id, [randomUUID()])).json().error.code).toBe(
        'DEPENDENCY_NOT_FOUND',
      );
      expect((await edit(b.id, [a.id, a.id])).statusCode).toBe(400);
      const failed = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          repositoryId: repoId,
          title: 'Invalid',
          objective: 'No insertion',
          dependencyIds: [randomUUID()],
        },
      });
      expect(failed.statusCode).toBe(404);
      expect((await app.inject('/api/tasks')).json().tasks).toHaveLength(3);
      expect(
        (await app.inject(`/api/tasks/${a.id}/dependencies`)).json()
          .dependencyIds,
      ).toEqual([]);
      expect((await app.inject('/api/graph')).json().dependencies).toEqual(
        expect.arrayContaining([
          { taskId: b.id, dependsOnId: a.id },
          { taskId: c.id, dependsOnId: b.id },
        ]),
      );
    });
    it('gates prerequisites by provider and current revision, including transitive invalidation', async () => {
      const a = await task('A');
      const b = await task('B', [a.id]);
      const ta = await tree(a);
      const tb = await tree(b);
      const start = (target: Worktree) =>
        app.inject({
          method: 'POST',
          url: `/api/tasks/${target.taskId}/runs`,
          payload: { worktreeId: target.id },
        });
      expect((await start(tb)).json().error.code).toBe('DEPENDENCIES_BLOCKED');
      expect((await app.inject(`/api/tasks/${b.id}/runs`)).json().runs).toEqual(
        [],
      );
      const first = await start(ta);
      expect((await done(first.json().id)).status).toBe('completed');
      const second = await start(tb);
      expect((await done(second.json().id)).status).toBe('completed');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/tasks/${b.id}/approvals`,
            payload: { worktreeId: tb.id, model: 'gpt-6-luna' },
          })
        ).json().error.code,
      ).toBe('DEPENDENCIES_BLOCKED');
      await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${a.id}`,
        payload: { objective: 'Revised prerequisite' },
      });
      expect((await start(tb)).json().error.code).toBe('DEPENDENCIES_BLOCKED');
      const readiness = (await app.inject('/api/graph'))
        .json()
        .readiness.find((item: { taskId: string }) => item.taskId === b.id);
      expect(readiness.mockBlockedBy).toEqual([a.id]);
      expect(readiness.codexBlockedBy).toEqual([a.id]);
    });
    it('requires a queued approval and explicit acknowledgement, consumes once under concurrent confirmations, and preserves history after restart', async () => {
      const t = await task();
      const w = await tree(t);
      const direct = await app.inject({
        method: 'POST',
        url: `/api/tasks/${t.id}/runs`,
        payload: {
          worktreeId: w.id,
          provider: 'codex',
          model: 'gpt-6-luna',
          confirmation: {
            repositoryId: repoId,
            worktreePath: w.path,
            model: 'gpt-6-luna',
            acknowledgeRisk: true,
          },
        },
      });
      expect(direct.statusCode).toBe(403);
      expect(direct.json().error.code).toBe('APPROVAL_REQUIRED');
      const approval = await request(w);
      expect(invoked).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/tasks/${t.id}/approvals`,
            payload: { worktreeId: w.id, model: 'gpt-6-luna' },
          })
        ).json().error.code,
      ).toBe('APPROVAL_PENDING');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/approvals/${approval.id}/confirm`,
            payload: { acknowledgeRisk: false },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/approvals/${approval.id}/confirm`,
            payload: { acknowledgeRisk: true, model: 'gpt-6.1-sol' },
          })
        ).statusCode,
      ).toBe(400);
      const responses = await Promise.all([
        confirm(approval.id),
        confirm(approval.id),
      ]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([
        202, 409,
      ]);
      const run = responses
        .find((response) => response.statusCode === 202)!
        .json<Run>();
      expect((await done(run.id)).status).toBe('completed');
      expect(invoked).toHaveBeenCalledOnce();
      expect((await confirm(approval.id)).statusCode).toBe(409);
      await app.close();
      app = buildApp(
        {},
        {
          dataDir: fixture.dataDir,
          codexProvider: provider,
          codexAvailability: availability,
        },
      );
      expect(
        (await app.inject(`/api/approvals/${approval.id}`)).json(),
      ).toMatchObject({ status: 'consumed', runId: run.id });
      expect(
        (await app.inject(`/api/tasks/${t.id}/runs`)).json().runs,
      ).toHaveLength(1);
      expect(invoked).toHaveBeenCalledOnce();
    });
    it('rejects stale, expired and denied approvals without executing or consuming an available replacement', async () => {
      const t = await task();
      const w = await tree(t);
      const stale = await request(w);
      await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${t.id}`,
        payload: { objective: 'Changed after review request' },
      });
      expect((await confirm(stale.id)).statusCode).toBe(409);
      const expired = await request(w);
      const db = new DatabaseSync(join(fixture.dataDir, 'worktreeos.sqlite'));
      try {
        db.prepare('UPDATE approvals SET expires_at = ? WHERE id = ?').run(
          '2000-01-01T00:00:00.000Z',
          expired.id,
        );
      } finally {
        db.close();
      }
      expect((await confirm(expired.id)).json().error.code).toBe(
        'APPROVAL_STALE',
      );
      const denied = await request(w);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/approvals/${denied.id}/reject`,
          })
        ).json().status,
      ).toBe('rejected');
      expect((await confirm(denied.id)).statusCode).toBe(409);
      expect((await app.inject(`/api/tasks/${t.id}/runs`)).json().runs).toEqual(
        [],
      );
      expect(invoked).not.toHaveBeenCalled();
    });
    it('does not let an unavailable model consume approval or trigger a fallback run', async () => {
      const w = await tree(await task());
      const approval = await request(w, 'gpt-6.1-sol');
      expect((await confirm(approval.id)).json().error.code).toBe(
        'CODEX_UNAVAILABLE',
      );
      expect(
        (await app.inject(`/api/approvals/${approval.id}`)).json().status,
      ).toBe('pending');
      expect(invoked).not.toHaveBeenCalled();
    });
    it('invalidates approvals when a prerequisite revision changes after a real prerequisite completes', async () => {
      const a = await task('A');
      const b = await task('B', [a.id]);
      const ta = await tree(a);
      const tb = await tree(b);
      const first = await confirm((await request(ta)).id);
      expect((await done(first.json().id)).status).toBe('completed');
      const pending = await request(tb);
      await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${a.id}`,
        payload: { objective: 'New work' },
      });
      expect(
        (await app.inject(`/api/approvals/${pending.id}`)).json().status,
      ).toBe('invalidated');
      expect((await confirm(pending.id)).statusCode).toBe(409);
      expect(invoked).toHaveBeenCalledOnce();
    });
    it('rechecks consumed approval context at dispatch after queued task edits and never invokes Codex', async () => {
      const a = await task('Blocking mock');
      const b = await task('Queued real');
      const ta = await tree(a);
      const tb = await tree(b);
      await app.close();
      app = buildApp(
        {},
        {
          dataDir: fixture.dataDir,
          provider: new MockProvider(60000),
          codexProvider: provider,
          codexAvailability: availability,
        },
      );
      const blocker = (
        await app.inject({
          method: 'POST',
          url: `/api/tasks/${a.id}/runs`,
          payload: { worktreeId: ta.id },
        })
      ).json<Run>();
      const approval = await request(tb);
      const queued = await confirm(approval.id);
      expect(queued.statusCode, queued.body).toBe(202);
      await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${b.id}`,
        payload: { objective: 'Changed while queued' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/runs/${blocker.id}/cancel`,
      });
      expect((await done(queued.json().id)).status).toBe('failed');
      expect(invoked).not.toHaveBeenCalled();
      expect(
        (await app.inject(`/api/runs/${queued.json().id}/events`))
          .json()
          .events.at(-1).payload.message,
      ).toContain('fresh approval');
    });
    it.each(['expired', 'prerequisite changed'] as const)(
      'fails queued Codex with %s consent while capacity is occupied',
      async (reason) => {
        const parent = await task('Prerequisite');
        const parentTree = await tree(parent);
        const blockerTree = await tree(await task('Capacity blocker'));
        const dependentTree = await tree(await task('Dependent', [parent.id]));
        const completed = await confirm((await request(parentTree)).id);
        expect((await done(completed.json().id)).status).toBe('completed');
        invoked.mockClear();
        await app.close();
        app = buildApp(
          {},
          {
            dataDir: fixture.dataDir,
            provider: new MockProvider(60000),
            codexProvider: provider,
            codexAvailability: availability,
            scheduler: { concurrency: 1 },
          },
        );
        const blocker = await app.inject({
          method: 'POST',
          url: `/api/tasks/${blockerTree.taskId}/runs`,
          payload: { worktreeId: blockerTree.id },
        });
        expect(blocker.statusCode).toBe(202);
        const approval = await request(dependentTree);
        const queued = await confirm(approval.id);
        expect(queued.statusCode).toBe(202);
        if (reason === 'expired') {
          const db = new DatabaseSync(
            join(fixture.dataDir, 'worktreeos.sqlite'),
          );
          try {
            db.prepare('UPDATE approvals SET expires_at = ? WHERE id = ?').run(
              '2000-01-01T00:00:00.000Z',
              approval.id,
            );
          } finally {
            db.close();
          }
        } else {
          expect(
            (
              await app.inject({
                method: 'PATCH',
                url: `/api/tasks/${parent.id}`,
                payload: { objective: 'Changed prerequisite' },
              })
            ).statusCode,
          ).toBe(200);
        }
        expect((await done(queued.json().id)).status).toBe('failed');
        expect(
          (await app.inject(`/api/runs/${blocker.json().id}`)).json().status,
        ).toBe('running');
        expect(invoked).not.toHaveBeenCalled();
      },
    );
    it('fails a confirmation when the reviewed task changes during asynchronous model discovery', async () => {
      const t = await task();
      const w = await tree(t);
      const approval = await request(w);
      await app.close();
      let release: (() => void) | undefined;
      app = buildApp(
        {},
        {
          dataDir: fixture.dataDir,
          codexProvider: provider,
          codexAvailability: () =>
            new Promise((resolve) => {
              release = () => resolve({ models: ['gpt-6-luna'], error: null });
            }),
        },
      );
      const response = confirm(approval.id).then((result) => result);
      try {
        for (let index = 0; index < 100 && !release; index++) await delay(10);
        expect(release).toBeDefined();
        await app.inject({
          method: 'PATCH',
          url: `/api/tasks/${t.id}`,
          payload: { objective: 'Edited during discovery' },
        });
      } finally {
        release?.();
      }
      expect((await response).statusCode).toBe(409);
      expect(invoked).not.toHaveBeenCalled();
      expect((await app.inject(`/api/tasks/${t.id}/runs`)).json().runs).toEqual(
        [],
      );
    });
  },
);
