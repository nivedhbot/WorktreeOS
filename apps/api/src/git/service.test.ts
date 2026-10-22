import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../storage/store.js';
import { GitService } from './service.js';
import { commitFixture, createFixture, fixtureGit } from '../test/fixtures.js';
import { buildApp } from '../app.js';

// Several real Git subprocesses per case need a bounded integration budget on Windows under parallel load.
describe('real managed Git worktrees', { timeout: 20000 }, () => {
  let fixture: ReturnType<typeof createFixture>;
  let store: Store;
  let git: GitService;
  let taskId: string;
  beforeEach(() => {
    fixture = createFixture();
    store = new Store(fixture.dataDir);
    git = new GitService(store);
    const repo = store.createRepository({
      name: 'Fixture',
      path: fixture.repoPath,
    });
    taskId = store.createTask({
      repositoryId: repo.id,
      title: 'My feature: $(no shell)',
      objective: 'Test isolated change',
      provider: 'mock',
    }).id;
  });
  afterEach(() => {
    store.close();
    fixture.cleanup();
  });

  it('creates, durably lists, inspects real staged/unstaged/untracked diffs, and removes only after confirmation', async () => {
    commitFixture(fixture);
    const tree = await git.create({ taskId });
    expect(tree.path.startsWith(fixture.repoPath)).toBe(false);
    expect(tree.branch).toMatch(/^worktreeos\/my-feature-no-shell-/);
    expect((await git.status(tree.id)).clean).toBe(true);
    store.close();
    store = new Store(fixture.dataDir);
    git = new GitService(store);
    expect(git.list()).toEqual([tree]);
    writeFileSync(join(tree.path, 'README.md'), 'Changed content\n');
    fixtureGit(tree.path, ['add', '--', 'README.md']);
    writeFileSync(join(tree.path, 'new file.txt'), 'Untracked content\n');
    expect(await git.files(tree.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'README.md' }),
        { path: 'new file.txt', status: '??' },
      ]),
    );
    expect((await git.diff(tree.id)).diff).toContain('+Changed content');
    expect((await git.diff(tree.id)).untrackedFiles).toEqual(['new file.txt']);
    expect(readFileSync(join(fixture.repoPath, 'README.md'), 'utf8')).toBe(
      'Initial content\n',
    );
    await expect(git.remove(tree.id, true)).rejects.toMatchObject({
      code: 'DIRTY_WORKTREE',
    });
    expect(existsSync(join(tree.path, 'new file.txt'))).toBe(true);
    // Restore only the two known fixture files, not through reset/clean/force.
    writeFileSync(join(tree.path, 'README.md'), 'Initial content\n');
    fixtureGit(tree.path, ['add', '--', 'README.md']);
    rmSync(join(tree.path, 'new file.txt'));
    await expect(git.remove(tree.id, false)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    });
    expect(await git.remove(tree.id, true)).toEqual({
      removed: true,
      branchRetained: true,
    });
    expect(existsSync(tree.path)).toBe(false);
    expect(git.list()).toEqual([]);
    expect(
      fixtureGit(fixture.repoPath, ['branch', '--list', tree.branch]),
    ).toContain(tree.branch);
  });

  it('refuses ignored files as well as tracked and untracked changes during removal', async () => {
    commitFixture(fixture);
    const tree = await git.create({ taskId });
    writeFileSync(join(tree.path, 'ignored.log'), 'Keep me');
    expect((await git.status(tree.id)).clean).toBe(true);
    await expect(git.remove(tree.id, true)).rejects.toMatchObject({
      code: 'DIRTY_WORKTREE',
    });
    expect(readFileSync(join(tree.path, 'ignored.log'), 'utf8')).toBe(
      'Keep me',
    );
  });

  it('refuses removal when index flags can hide tracked changes', async () => {
    commitFixture(fixture);
    const tree = await git.create({ taskId });
    fixtureGit(tree.path, [
      'update-index',
      '--assume-unchanged',
      '--',
      'README.md',
    ]);
    writeFileSync(join(tree.path, 'README.md'), 'Hidden local edits\n');
    await expect(git.remove(tree.id, true)).rejects.toMatchObject({
      code: 'UNSAFE_INDEX_FLAGS',
    });
    expect(readFileSync(join(tree.path, 'README.md'), 'utf8')).toBe(
      'Hidden local edits\n',
    );
  });

  it('detects an unborn repository, dirty base, duplicate task, and duplicate branch', async () => {
    await expect(git.create({ taskId })).rejects.toMatchObject({
      code: 'MISSING_COMMIT',
    });
    commitFixture(fixture);
    writeFileSync(join(fixture.repoPath, 'dirty.txt'), 'Changes');
    await expect(git.create({ taskId })).rejects.toMatchObject({
      code: 'DIRTY_REPOSITORY',
    });
    rmSync(join(fixture.repoPath, 'dirty.txt'));
    fixtureGit(fixture.repoPath, ['branch', 'worktreeos/existing']);
    await expect(
      git.create({ taskId, branch: 'worktreeos/existing' }),
    ).rejects.toMatchObject({ code: 'BRANCH_EXISTS' });
    await git.create({ taskId });
    await expect(git.create({ taskId })).rejects.toMatchObject({
      code: 'WORKTREE_EXISTS',
    });
  });

  it('rejects branch injection and unknown tasks without Git mutations', async () => {
    commitFixture(fixture);
    for (const branch of [
      '../../outside',
      '--force',
      'worktreeos/../../outside',
      'worktreeos/test;whoami',
      'main',
      'worktreeos/a.lock',
    ])
      await expect(git.create({ taskId, branch })).rejects.toThrow();
    await expect(git.create({ taskId: randomUUID() })).rejects.toMatchObject({
      code: 'TASK_NOT_FOUND',
    });
    expect(git.list()).toEqual([]);
  });

  it('rejects a configured base inside the registered repository', async () => {
    commitFixture(fixture);
    const unsafe = new GitService(store, join(fixture.repoPath, 'managed'));
    await expect(unsafe.create({ taskId })).rejects.toMatchObject({
      code: 'UNSAFE_WORKTREE_BASE',
    });
  });

  it('rechecks worktree paths and rejects junction replacement before inspecting or removing', async () => {
    commitFixture(fixture);
    const tree = await git.create({ taskId });
    const saved = join(fixture.root, 'saved-tree');
    renameSync(tree.path, saved);
    symlinkSync(
      fixture.repoPath,
      tree.path,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(git.status(tree.id)).rejects.toMatchObject({
      code: 'UNSAFE_WORKTREE_PATH',
    });
    await expect(git.remove(tree.id, true)).rejects.toMatchObject({
      code: 'UNSAFE_WORKTREE_PATH',
    });
    expect(readFileSync(join(fixture.repoPath, 'README.md'), 'utf8')).toBe(
      'Initial content\n',
    );
  });

  it('disables repository hooks and external filters on creation and inspection', async () => {
    commitFixture(fixture);
    writeFileSync(
      join(fixture.repoPath, '.gitattributes'),
      'README.md filter=unsafe\n',
    );
    fixtureGit(fixture.repoPath, ['add', '--', '.gitattributes']);
    fixtureGit(fixture.repoPath, [
      'commit',
      '--quiet',
      '-m',
      'Filter attribute',
    ]);
    fixtureGit(fixture.repoPath, ['config', 'filter.unsafe.smudge', 'exit 97']);
    fixtureGit(fixture.repoPath, ['config', 'filter.unsafe.clean', 'exit 97']);
    fixtureGit(fixture.repoPath, ['config', 'filter.unsafe.required', 'true']);
    const hooks = join(fixture.root, 'hooks');
    mkdirSync(hooks);
    writeFileSync(
      join(hooks, 'post-checkout'),
      '#!/bin/sh\nprintf invoked > hook-executed\n',
      { mode: 0o755 },
    );
    fixtureGit(fixture.repoPath, ['config', 'core.hooksPath', hooks]);
    const tree = await git.create({ taskId });
    expect(existsSync(join(tree.path, 'hook-executed'))).toBe(false);
    expect((await git.status(tree.id)).clean).toBe(true);
    expect((await git.diff(tree.id)).diff).toBe('');
  });

  it('exposes validated create/list/status/files/diff/removal endpoints and sanitizes failures', async () => {
    commitFixture(fixture);
    const app = buildApp({}, { dataDir: fixture.dataDir });
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/worktrees',
        payload: { taskId },
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().id;
      expect(
        (await app.inject('/api/worktrees')).json().worktrees,
      ).toHaveLength(1);
      expect(
        (await app.inject(`/api/worktrees/${id}/status`)).json().clean,
      ).toBe(true);
      expect((await app.inject(`/api/worktrees/${id}/files`)).json()).toEqual({
        files: [],
      });
      expect((await app.inject(`/api/worktrees/${id}/diff`)).json().diff).toBe(
        '',
      );
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/worktrees/${id}`,
            payload: { confirm: false },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/worktrees/${id}`,
            payload: { confirm: true },
          })
        ).statusCode,
      ).toBe(200);
      expect((await app.inject(`/api/worktrees/${id}/status`)).statusCode).toBe(
        404,
      );
    } finally {
      await app.close();
    }
  });
});
