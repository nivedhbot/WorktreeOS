import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from './store.js';
import { createFixture } from '../test/fixtures.js';

describe('file-backed storage', () => {
  let fixture: ReturnType<typeof createFixture>;
  let store: Store;
  beforeEach(() => {
    fixture = createFixture();
    store = new Store(fixture.dataDir);
  });
  afterEach(() => {
    store.close();
    vi.unstubAllEnvs();
    fixture.cleanup();
  });
  it('looks up only active worktrees by ID or task', () => {
    const repo = store.createRepository({
      name: 'Lookup',
      path: fixture.repoPath,
    });
    const firstTask = store.createTask({
      repositoryId: repo.id,
      title: 'First',
      objective: 'First objective',
      provider: 'mock',
    });
    const secondTask = store.createTask({
      repositoryId: repo.id,
      title: 'Second',
      objective: 'Second objective',
      provider: 'mock',
    });
    const first = store.saveWorktree({
      id: randomUUID(),
      taskId: firstTask.id,
      repositoryId: repo.id,
      branch: 'worktreeos/first',
      path: join(fixture.root, 'first'),
      createdAt: new Date().toISOString(),
      removedAt: null,
    });
    const second = store.saveWorktree({
      ...first,
      id: randomUUID(),
      taskId: secondTask.id,
      branch: 'worktreeos/second',
      path: join(fixture.root, 'second'),
    });
    expect(store.getWorktree(first.id)).toEqual(first);
    expect(store.getTaskWorktree(secondTask.id)).toEqual(second);
    store.markWorktreeRemoved(first.id);
    expect(store.getWorktree(first.id)).toBeUndefined();
    expect(store.getTaskWorktree(firstTask.id)).toBeUndefined();
    expect(store.getWorktree(second.id)).toEqual(second);
  });
  it('orders history by insertion when runs share a millisecond timestamp', () => {
    const repo = store.createRepository({
      name: 'Example',
      path: fixture.repoPath,
    });
    const task = store.createTask({
      repositoryId: repo.id,
      title: 'Task',
      objective: 'Objective',
      provider: 'mock',
    });
    const first = store.createRun(task.id);
    const second = store.createRun(task.id);
    const db = new DatabaseSync(join(fixture.dataDir, 'worktreeos.sqlite'));
    try {
      db.prepare('UPDATE runs SET created_at = ?').run(
        '2026-01-01T00:00:00.000Z',
      );
      db.prepare('UPDATE runs SET id = ? WHERE id = ?').run(
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        first.id,
      );
      db.prepare('UPDATE runs SET id = ? WHERE id = ?').run(
        '00000000-0000-4000-8000-000000000000',
        second.id,
      );
      expect(store.listRuns(task.id).map((run) => run.id)).toEqual([
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        '00000000-0000-4000-8000-000000000000',
      ]);
    } finally {
      db.close();
    }
  });

  it('preserves all four record types, edits, and ordered events across reopen', () => {
    const repo = store.createRepository({
      name: 'Example',
      path: fixture.repoPath,
    });
    const task = store.createTask({
      repositoryId: repo.id,
      title: 'Task',
      objective: 'Objective',
      provider: 'mock',
    });
    const run = store.createRun(task.id);
    const first = store.appendEvent(run.id, 'note', {
      message: 'first',
      details: [1, true, null],
    });
    const second = store.appendEvent(run.id, 'note', { message: 'second' });
    store.editRepository(repo.id, { name: 'Edited' });
    store.editTask(task.id, { objective: 'Edited objective' });
    store.close();
    store = new Store(fixture.dataDir);
    expect(store.getRepository(repo.id)?.name).toBe('Edited');
    expect(store.getTask(task.id)?.objective).toBe('Edited objective');
    expect(store.getRun(run.id)).toEqual(run);
    expect(store.listRuns(task.id)).toEqual([run]);
    expect(store.listEvents(run.id)).toEqual([first, second]);
    expect(store.appendEvent(run.id, 'note', {}).sequence).toBe(3);
    const other = store.createRun(task.id);
    expect(store.appendEvent(other.id, 'note', {}).sequence).toBe(1);
  });

  it('rejects missing parents and rolls back an invalid append', () => {
    const repo = store.createRepository({
      name: 'Example',
      path: fixture.repoPath,
    });
    const task = store.createTask({
      repositoryId: repo.id,
      title: 'Task',
      objective: 'Objective',
      provider: 'mock',
    });
    const run = store.createRun(task.id);
    expect(() =>
      store.createTask({
        repositoryId: randomUUID(),
        title: 'Task',
        objective: 'Objective',
        provider: 'mock',
      }),
    ).toThrow('Repository not found');
    expect(() => store.createRun(randomUUID())).toThrow('Task not found');
    expect(() => store.appendEvent(randomUUID(), 'note', {})).toThrow(
      'Run not found',
    );
    expect(() => store.appendEvent(run.id, '', {})).toThrow();
    expect(store.listEvents(run.id)).toEqual([]);
    expect(store.appendEvent(run.id, 'note', {}).sequence).toBe(1);
  });
  it('queries only events after a run-scoped cursor and refuses another run cursor', () => {
    const repo = store.createRepository({
      name: 'Example',
      path: fixture.repoPath,
    });
    const task = store.createTask({
      repositoryId: repo.id,
      title: 'Task',
      objective: 'Objective',
      provider: 'mock',
    });
    const run = store.createRun(task.id);
    const first = store.appendEvent(run.id, 'note', { message: 'one' });
    const second = store.appendEvent(run.id, 'note', { message: 'two' });
    expect(store.listEvents(run.id, first.id)).toEqual([second]);
    expect(store.listEvents(run.id, second.id)).toEqual([]);
    const other = store.createRun(task.id);
    expect(() => store.listEvents(other.id, first.id)).toThrow(
      'does not belong',
    );
  });

  it('enforces database foreign keys and uniqueness independently of validation', () => {
    const repo = store.createRepository({
      name: 'Example',
      path: fixture.repoPath,
    });
    expect(() =>
      store.createRepository({ name: 'Duplicate', path: fixture.repoPath }),
    ).toThrow('already registered');
    const db = new DatabaseSync(join(fixture.dataDir, 'worktreeos.sqlite'));
    try {
      db.exec('PRAGMA foreign_keys = ON');
      expect(() =>
        db
          .prepare(
            'INSERT INTO tasks (id, repository_id, title, objective, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            randomUUID(),
            randomUUID(),
            'Task',
            'Objective',
            'mock',
            new Date().toISOString(),
            new Date().toISOString(),
          ),
      ).toThrow(/FOREIGN KEY/);
      expect(() =>
        db
          .prepare('INSERT INTO repositories VALUES (?, ?, ?, ?, ?, ?)')
          .run(
            randomUUID(),
            'Duplicate',
            repo.path,
            repo.path,
            repo.createdAt,
            repo.updatedAt,
          ),
      ).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it('reads the configurable directory and keeps separate databases isolated', () => {
    const otherDir = join(fixture.root, 'other-data');
    vi.stubEnv('WORKTREEOS_DATA_DIR', otherDir);
    const other = new Store();
    try {
      other.createRepository({ name: 'Other', path: fixture.repoPath });
      expect(store.listRepositories()).toEqual([]);
      expect(other.listRepositories()).toHaveLength(1);
    } finally {
      other.close();
    }
    expect(() => new Store('relative')).toThrow(/absolute/);
  });

  it('upgrades a version-one database without losing existing records', () => {
    const repo = store.createRepository({
      name: 'Before migration',
      path: fixture.repoPath,
    });
    store.close();
    const old = new DatabaseSync(join(fixture.dataDir, 'worktreeos.sqlite'));
    old.exec(
      'DROP TABLE approvals; DROP TABLE dependencies; ALTER TABLE tasks DROP COLUMN revision; DROP TABLE worktrees; DROP TABLE events; DROP TABLE runs; PRAGMA user_version = 1',
    );
    old.close();
    store = new Store(fixture.dataDir);
    expect(store.getRepository(repo.id)).toEqual(repo);
    const task = store.createTask({
      repositoryId: repo.id,
      title: 'After migration',
      objective: 'Check new tables',
      provider: 'mock',
    });
    const run = store.createRun(task.id);
    expect(store.appendEvent(run.id, 'note', {}).sequence).toBe(1);
  });

  it('rolls back an incomplete migration and preserves its previous schema version', () => {
    const repo = store.createRepository({
      name: 'Before failure',
      path: fixture.repoPath,
    });
    store.close();
    const old = new DatabaseSync(join(fixture.dataDir, 'worktreeos.sqlite'));
    old.exec(
      'DROP TABLE approvals; DROP TABLE dependencies; ALTER TABLE tasks DROP COLUMN revision; DROP TABLE worktrees; DROP TABLE events; DROP TABLE runs; CREATE TABLE events (marker TEXT); PRAGMA user_version = 1',
    );
    old.close();
    expect(() => new Store(fixture.dataDir)).toThrow(/already exists/);
    const db = new DatabaseSync(join(fixture.dataDir, 'worktreeos.sqlite'));
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runs'",
          )
          .get(),
      ).toBeUndefined();
      expect(
        db.prepare('SELECT name FROM repositories WHERE id = ?').get(repo.id)
          ?.name,
      ).toBe(repo.name);
      // Repair the test-only collision so cleanup can exercise the normal store lifecycle.
      db.exec('DROP TABLE events');
    } finally {
      db.close();
    }
    store = new Store(fixture.dataDir);
  });

  it('rejects a future schema without overwriting it', () => {
    const dir = join(fixture.root, 'future');
    mkdirSync(dir);
    const db = new DatabaseSync(join(dir, 'worktreeos.sqlite'));
    db.exec('PRAGMA user_version = 999');
    db.close();
    expect(() => new Store(dir)).toThrow(/newer/);
    const reopened = new DatabaseSync(join(dir, 'worktreeos.sqlite'));
    try {
      expect(reopened.prepare('PRAGMA user_version').get()?.user_version).toBe(
        999,
      );
    } finally {
      reopened.close();
    }
  });
});
