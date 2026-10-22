import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createFixture, commitFixture } from '../test/fixtures.js';
import type { AgentProvider } from './provider.js';

const fixture = createFixture();
commitFixture(fixture);
const invoked = vi.fn();
const availability = vi.fn(async () => ({
  models: ['gpt-6-luna' as const],
  error: null,
}));
const provider: AgentProvider = {
  id: 'codex',
  mode: 'CODEX',
  async *run() {
    invoked();
    yield {
      type: 'codex.thread',
      mode: 'CODEX',
      threadId: 'sdk-thread-id',
      message: 'Started',
    };
    yield {
      type: 'codex.usage',
      mode: 'CODEX',
      usage: { input_tokens: 12, cached_input_tokens: 2, output_tokens: 7 },
      message: 'Usage',
    };
  },
};
let app = buildApp(
  {},
  {
    dataDir: fixture.dataDir,
    codexProvider: provider,
    codexAvailability: availability,
  },
);
afterEach(async () => {
  await app.close();
  fixture.cleanup();
});
it('requires matching real-run consent and available auth models; persists actual SDK metadata across restart', async () => {
  const repo = (
    await app.inject({
      method: 'POST',
      url: '/api/repos',
      payload: { name: 'Codex fixture', path: fixture.repoPath },
    })
  ).json();
  const task = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        repositoryId: repo.id,
        title: 'Inspect',
        objective: 'Read only',
      },
    })
  ).json();
  const tree = (
    await app.inject({
      method: 'POST',
      url: '/api/worktrees',
      payload: { taskId: task.id },
    })
  ).json();
  expect(invoked).not.toHaveBeenCalled();
  expect(availability).not.toHaveBeenCalled();
  expect((await app.inject('/api/providers/codex')).json().models).toEqual([
    'gpt-6-luna',
  ]);
  const body = {
    worktreeId: tree.id,
    provider: 'codex',
    model: 'gpt-6-luna',
    confirmation: {
      repositoryId: repo.id,
      worktreePath: tree.path,
      model: 'gpt-6-luna',
      acknowledgeRisk: true,
    },
  };
  const start = (payload: unknown) =>
    app.inject({ method: 'POST', url: `/api/tasks/${task.id}/runs`, payload });
  expect(
    (
      await start({
        worktreeId: tree.id,
        provider: 'codex',
        model: 'gpt-6-luna',
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await start({
        ...body,
        confirmation: { ...body.confirmation, worktreePath: fixture.repoPath },
      })
    ).json().error.code,
  ).toBe('APPROVAL_REQUIRED');
  const unavailable = (
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/approvals`,
      payload: { worktreeId: tree.id, model: 'gpt-6.1-sol' },
    })
  ).json();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/approvals/${unavailable.id}/confirm`,
        payload: { acknowledgeRisk: true },
      })
    ).json().error.code,
  ).toBe('CODEX_UNAVAILABLE');
  await app.inject({
    method: 'POST',
    url: `/api/approvals/${unavailable.id}/reject`,
  });
  expect(invoked).not.toHaveBeenCalled();
  const pending = (
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/approvals`,
      payload: { worktreeId: tree.id, model: 'gpt-6-luna' },
    })
  ).json();
  const response = await app.inject({
    method: 'POST',
    url: `/api/approvals/${pending.id}/confirm`,
    payload: { acknowledgeRisk: true },
  });
  expect(response.statusCode, response.body).toBe(202);
  const id: string = response.json().id;
  let record = (await app.inject(`/api/runs/${id}`)).json();
  for (let index = 0; index < 100 && record.status !== 'completed'; index++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    record = (await app.inject(`/api/runs/${id}`)).json();
  }
  expect(record).toMatchObject({
    status: 'completed',
    mode: 'CODEX',
    provider: 'codex',
    model: 'gpt-6-luna',
    threadId: 'sdk-thread-id',
    usage: { input_tokens: 12, cached_input_tokens: 2, output_tokens: 7 },
  });
  expect(
    (await app.inject(`/api/runs/${id}/events`))
      .json()
      .events.every(
        (event: { payload: { mode: string } }) =>
          event.payload.mode === 'CODEX',
      ),
  ).toBe(true);
  expect(
    (await app.inject({ method: 'POST', url: `/api/runs/${id}/retry` })).json()
      .error.code,
  ).toBe('CONFIRMATION_REQUIRED');
  await app.close();
  app = buildApp(
    {},
    {
      dataDir: fixture.dataDir,
      codexProvider: provider,
      codexAvailability: availability,
    },
  );
  expect((await app.inject(`/api/runs/${id}`)).json()).toEqual(record);
  expect(invoked).toHaveBeenCalledTimes(1);
});
