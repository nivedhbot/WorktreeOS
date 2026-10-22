import {
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { Writable } from 'node:stream';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { commitFixture, createFixture, fixtureGit } from './test/fixtures.js';
import { listenLoopback, redactText, redactValue } from './security.js';
import { Store } from './storage/store.js';

describe('local API security and integrity', { timeout: 20000 }, () => {
  let fixture: ReturnType<typeof createFixture>;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    fixture = createFixture();
    commitFixture(fixture);
    app = buildApp({}, { dataDir: fixture.dataDir });
  });
  afterEach(async () => {
    await app.close();
    fixture.cleanup();
  });
  async function taskAndTree() {
    const repo = (
      await app.inject({
        method: 'POST',
        url: '/api/repos',
        payload: { name: 'Security', path: fixture.repoPath },
      })
    ).json();
    const task = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          repositoryId: repo.id,
          title: 'Security task',
          objective: 'Inspect only',
        },
      })
    ).json();
    const tree = await app.inject({
      method: 'POST',
      url: '/api/worktrees',
      payload: { taskId: task.id },
    });
    expect(tree.statusCode, tree.body).toBe(201);
    return { repo, task, tree: tree.json() };
  }
  it('binds the production listener to IPv4 loopback and rejects remote addresses, DNS rebinding hosts and cross-site origins', async () => {
    const address = await listenLoopback(app, 0);
    expect(app.server.address()).toMatchObject({
      address: '127.0.0.1',
      family: 'IPv4',
    });
    expect((await fetch(`${address}/api/health`)).status).toBe(200);
    for (const headers of [
      { host: 'attacker.invalid' },
      { origin: 'https://attacker.invalid' },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
      { host: 'localhost.attacker.invalid' },
    ]) {
      expect(
        (await app.inject({ url: '/api/health', headers })).statusCode,
      ).toBe(403);
    }
    expect(
      (await app.inject({ url: '/api/health', remoteAddress: '203.0.113.5' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: '/api/health',
          headers: { origin: 'http://127.0.0.1:5173' },
        })
      ).statusCode,
    ).toBe(200);
    const response = await app.inject('/api/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  it('rejects traversal, remote paths, nested directories and registration symlink/junction escapes through REST', async () => {
    const alias = join(fixture.root, 'alias');
    symlinkSync(
      fixture.repoPath,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const child = join(fixture.repoPath, 'src');
    mkdirSync(child);
    for (const path of [
      `${fixture.repoPath}/../escape`,
      '../repo',
      'https://example.invalid/repo',
      '\\\\server\\share',
      alias,
      child,
      `${fixture.repoPath}\u0000`,
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/repos',
        payload: { name: 'Unsafe', path },
      });
      expect(response.statusCode, response.body).toBe(400);
    }
    expect((await app.inject('/api/repos')).json().repositories).toEqual([]);
  });
  it('rejects branch injection and swapped worktree paths before running or removing anything', async () => {
    const { task, tree } = await taskAndTree();
    const other = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          repositoryId: task.repositoryId,
          title: 'Other',
          objective: 'Other',
        },
      })
    ).json();
    for (const branch of [
      '--force',
      '../../escape',
      'worktreeos/a;whoami',
      'worktreeos/$(whoami)',
      'worktreeos/a.lock',
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/worktrees',
            payload: { taskId: other.id, branch },
          })
        ).statusCode,
      ).toBe(400);
    }
    const saved = join(fixture.root, 'saved-worktree');
    renameSync(tree.path as string, saved);
    symlinkSync(
      fixture.repoPath,
      tree.path as string,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(
      (await app.inject(`/api/worktrees/${tree.id}/diff`)).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/tasks/${task.id}/runs`,
          payload: { worktreeId: tree.id },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/worktrees/${tree.id}`,
          payload: { confirm: true },
        })
      ).statusCode,
    ).toBe(409);
    expect(readFileSync(join(fixture.repoPath, 'README.md'), 'utf8')).toBe(
      'Initial content\n',
    );
  });
  it('preserves foreign keys, approval linkage and append-only history and refuses invalid terminal transitions', async () => {
    const { task } = await taskAndTree();
    const store = new Store(fixture.dataDir);
    try {
      const run = store.createRun(task.id);
      store.transitionRun(run.id, 'preparing', 'prepare');
      store.transitionRun(run.id, 'failed', 'failed');
      expect(() => store.transitionRun(run.id, 'running', 'invalid')).toThrow(
        'Cannot transition',
      );
      const db = new DatabaseSync(join(fixture.dataDir, 'worktreeos.sqlite'));
      try {
        db.exec('PRAGMA foreign_keys=ON');
        expect(() =>
          db
            .prepare(
              'INSERT INTO dependencies(task_id, depends_on_id) VALUES (?, ?)',
            )
            .run(task.id, randomUUID()),
        ).toThrow(/FOREIGN KEY/);
        expect(() =>
          db
            .prepare(
              'INSERT INTO dependencies(task_id, depends_on_id) VALUES (?, ?)',
            )
            .run(task.id, task.id),
        ).toThrow(/CHECK/);
        expect(() =>
          db
            .prepare('UPDATE events SET payload = ? WHERE run_id = ?')
            .run('{}', run.id),
        ).toThrow('append-only');
        expect(() =>
          db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id),
        ).toThrow(/FOREIGN KEY/);
      } finally {
        db.close();
      }
      expect(store.getRun(run.id)?.status).toBe('failed');
      expect(store.listEvents(run.id)).toHaveLength(2);
    } finally {
      store.close();
    }
  });
  it('sanitizes unexpected errors and request logs instead of logging credentials, bodies or query strings', async () => {
    await app.close();
    let output = '';
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    app = buildApp(
      { logger: { level: 'info', stream } },
      { dataDir: fixture.dataDir },
    );
    const secret = 'sk-proj-0123456789abcdefgh';
    app.post('/api/test-error', async () => {
      throw new Error(`Authorization: Bearer ${secret}`);
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/test-error?api_key=${secret}`,
      headers: {
        authorization: `Bearer ${secret}`,
        cookie: `session=${secret}`,
      },
      payload: { api_key: secret, password: 'private-test-password' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(secret);
    expect(output).toContain('request.failure');
    expect(output).toContain('http.request');
    expect(output).not.toContain(secret);
    expect(output).not.toContain('private-test-password');
    expect(output).not.toContain('api_key=');
  });
  it('redacts nested agent credentials before durable event storage without changing actual usage', async () => {
    const { task } = await taskAndTree();
    const store = new Store(fixture.dataDir);
    try {
      const run = store.createRun(task.id);
      const event = store.appendEvent(run.id, 'codex.item', {
        mode: 'CODEX',
        message:
          'OPENAI_API_KEY=sk-proj-0123456789abcdefgh Bearer private-bearer-token',
        item: {
          arguments: {
            api_key: 'private-key-value',
            password: 'private-password',
            usage: { input_tokens: 13 },
          },
        },
      });
      const serialized = JSON.stringify(store.listEvents(run.id));
      expect(serialized).not.toContain('sk-proj-');
      expect(serialized).not.toContain('private-');
      expect(serialized).toContain('[REDACTED]');
      expect(event.payload.item).toMatchObject({
        arguments: { usage: { input_tokens: 13 } },
      });
    } finally {
      store.close();
    }
    expect(
      redactText('password="abc def" api_key=private sk-12345678'),
    ).not.toContain('abc def');
    expect(
      redactValue({
        authorization: 'private',
        usage: { input_tokens: 13, output_tokens: 7 },
      }),
    ).toEqual({
      authorization: '[REDACTED]',
      usage: { input_tokens: 13, output_tokens: 7 },
    });
  });
  it('does not execute repository hooks or configured external diff helpers during inspection', async () => {
    const { tree } = await taskAndTree();
    fixtureGit(fixture.repoPath, [
      'config',
      'diff.external',
      'invalid-executable-test-marker',
    ]);
    writeFileSync(
      join(tree.path as string, 'README.md'),
      'Security inspection change\n',
    );
    const response = await app.inject(`/api/worktrees/${tree.id}/diff`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().diff).toContain('Security inspection change');
  });
});
