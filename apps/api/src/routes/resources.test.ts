import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  repositorySchema,
  taskSchema,
} from '@worktreeos/shared';
import { buildApp } from '../app.js';
import { createFixture } from '../test/fixtures.js';

describe('persistent REST API', () => {
  let fixture: ReturnType<typeof createFixture>;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    fixture = createFixture();
    app = buildApp({}, { dataDir: fixture.dataDir });
  });
  afterEach(async () => {
    await app.close();
    fixture.cleanup();
  });

  async function createRepository() {
    const response = await app.inject({
      method: 'POST',
      url: '/api/repos',
      payload: { name: 'Example', path: fixture.repoPath },
    });
    expect(response.statusCode).toBe(201);
    return repositorySchema.parse(response.json());
  }

  it('starts with no seeded records', async () => {
    expect((await app.inject('/api/repos')).json()).toEqual({
      repositories: [],
    });
    expect((await app.inject('/api/tasks')).json()).toEqual({ tasks: [] });
  });

  it('creates, lists, reads, edits, and durably reopens repositories and tasks', async () => {
    const repository = await createRepository();
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        repositoryId: repository.id,
        title: ' Initial task ',
        objective: ' Inspect changes ',
      },
    });
    expect(created.statusCode).toBe(201);
    const task = taskSchema.parse(created.json());
    expect(task).toMatchObject({
      title: 'Initial task',
      objective: 'Inspect changes',
      provider: 'mock',
    });
    expect(created.headers.location).toBe(`/api/tasks/${task.id}`);
    expect((await app.inject(`/api/repos/${repository.id}`)).json()).toEqual(
      repository,
    );
    expect((await app.inject(`/api/tasks/${task.id}`)).json()).toEqual(task);
    expect((await app.inject('/api/repos')).json()).toEqual({
      repositories: [repository],
    });
    expect(
      (await app.inject(`/api/tasks?repositoryId=${repository.id}`)).json(),
    ).toEqual({ tasks: [task] });
    const editedRepo = await app.inject({
      method: 'PATCH',
      url: `/api/repos/${repository.id}`,
      payload: { name: ' Renamed ' },
    });
    expect(editedRepo.statusCode).toBe(200);
    const editedTask = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { title: 'Updated task', objective: 'Updated objective' },
    });
    expect(editedTask.statusCode).toBe(200);
    await app.close();
    app = buildApp({}, { dataDir: fixture.dataDir });
    expect((await app.inject(`/api/repos/${repository.id}`)).json()).toEqual(
      editedRepo.json(),
    );
    expect((await app.inject(`/api/tasks/${task.id}`)).json()).toEqual(
      editedTask.json(),
    );
    expect((await app.inject('/api/tasks')).json()).toEqual({
      tasks: [editedTask.json()],
    });
  });

  it('returns 409 for duplicate canonical paths without overwriting a repository', async () => {
    await createRepository();
    const response = await app.inject({
      method: 'POST',
      url: '/api/repos',
      payload: { name: 'Duplicate', path: `${fixture.repoPath}/.` },
    });
    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe(
      'REPOSITORY_EXISTS',
    );
    expect((await app.inject('/api/repos')).json().repositories).toHaveLength(
      1,
    );
  });

  it.each([
    { name: '', path: '/missing' },
    { name: 'Example' },
    { name: 'Example', path: 5 },
    { name: 'Example', path: '/missing', unexpected: true },
  ])('rejects invalid repository inputs: %j', async (payload) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/repos',
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('rejects invalid paths with a useful error', async () => {
    const ordinary = join(fixture.root, 'ordinary');
    mkdirSync(ordinary);
    const file = join(fixture.root, 'file');
    writeFileSync(file, 'not a directory');
    for (const path of [
      'relative/path',
      join(fixture.root, 'missing'),
      ordinary,
      file,
      `${fixture.repoPath}/../repo with spaces`,
      'https://example.com/repo.git',
      '\\\\server\\repo',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/repos',
        payload: { name: 'Invalid', path },
      });
      expect(response.statusCode, path).toBe(400);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe(
        'INVALID_REPOSITORY_PATH',
      );
    }
    expect((await app.inject('/api/repos')).json()).toEqual({
      repositories: [],
    });
  });

  it.each([
    { title: '', objective: 'Objective' },
    { title: 'Task', objective: '' },
    { title: 'Task', objective: 'Objective', provider: 'codex' },
    { title: 'Task', objective: 'Objective', status: 'running' },
    { title: 'x'.repeat(201), objective: 'Objective' },
  ])('rejects invalid task inputs: %j', async (fields) => {
    const repository = await createRepository();
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { repositoryId: repository.id, ...fields },
    });
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect((await app.inject('/api/tasks')).json()).toEqual({ tasks: [] });
  });

  it('rejects malformed IDs, JSON, unknown filters, empty edits, and root reassignment', async () => {
    const repository = await createRepository();
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        repositoryId: repository.id,
        title: 'Task',
        objective: 'Objective',
      },
    });
    const task = taskSchema.parse(created.json());
    const requests = [
      { method: 'GET' as const, url: '/api/repos/not-a-uuid' },
      { method: 'GET' as const, url: '/api/tasks?repositoryId=invalid' },
      { method: 'GET' as const, url: '/api/tasks?unknown=value' },
      { method: 'PATCH' as const, url: `/api/tasks/${task.id}`, payload: {} },
      {
        method: 'PATCH' as const,
        url: `/api/tasks/${task.id}`,
        payload: { repositoryId: randomUUID() },
      },
      {
        method: 'PATCH' as const,
        url: `/api/repos/${repository.id}`,
        payload: { path: fixture.root },
      },
      {
        method: 'POST' as const,
        url: '/api/tasks',
        payload: '{',
        headers: { 'content-type': 'application/json' },
      },
    ];
    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode, request.url).toBe(400);
      expect(apiErrorSchema.safeParse(response.json()).success).toBe(true);
    }
    expect((await app.inject(`/api/tasks/${task.id}`)).json()).toEqual(task);
  });

  it('returns meaningful 404 errors for missing records and routes', async () => {
    const id = randomUUID();
    const requests = [
      { method: 'GET' as const, url: `/api/repos/${id}` },
      { method: 'GET' as const, url: `/api/tasks/${id}` },
      {
        method: 'PATCH' as const,
        url: `/api/repos/${id}`,
        payload: { name: 'Missing' },
      },
      {
        method: 'PATCH' as const,
        url: `/api/tasks/${id}`,
        payload: { title: 'Missing' },
      },
      {
        method: 'POST' as const,
        url: '/api/tasks',
        payload: { repositoryId: id, title: 'Missing', objective: 'Missing' },
      },
      { method: 'GET' as const, url: `/api/tasks?repositoryId=${id}` },
      { method: 'GET' as const, url: '/api/unknown' },
    ];
    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode, request.url).toBe(404);
      expect(apiErrorSchema.parse(response.json()).error.message).toMatch(
        /not found/,
      );
    }
  });
});
