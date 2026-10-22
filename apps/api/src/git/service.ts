import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  branchSchema,
  createWorktreeSchema,
  type ChangedFile,
  type Worktree,
} from '@worktreeos/shared';
import { AppError } from '../errors.js';
import { validateRepositoryPath } from '../repositories/validate-path.js';
import { Store } from '../storage/store.js';
import { gitCommand } from './command.js';
import { KeyedLock } from './keyed-lock.js';

const same = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (root: string, path: string) => {
  const child = relative(root, path);
  return (
    child === '' ||
    (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
  );
};

export class GitService {
  readonly worktreeDir: string;
  private readonly mutating = new Set<string>();
  private readonly mutationLocks = new KeyedLock();
  private readonly commandLocks = new KeyedLock();
  private readonly executionLeases = new Set<string>();
  // Milestone 04 attaches an execution guard; inspection remains available during a run.
  canRemove: (worktreeId: string) => boolean = () => true;

  acquireExecution(worktreeId: string) {
    if (!this.canAcquireExecution(worktreeId))
      throw new AppError(
        409,
        'WORKTREE_IN_USE',
        'Worktree mutation or execution is in progress',
      );
    this.executionLeases.add(worktreeId);
    return () => {
      this.executionLeases.delete(worktreeId);
    };
  }

  canAcquireExecution(worktreeId: string) {
    const tree = this.store.getWorktree(worktreeId);
    return (
      !!tree &&
      !this.mutating.has(tree.repositoryId) &&
      ![...this.executionLeases].some(
        (id) => this.store.getWorktree(id)?.repositoryId === tree.repositoryId,
      )
    );
  }

  private command(path: string, args: string[], allowedCodes?: number[]) {
    const repositoryId =
      this.store.listRepositories().find((repo) => same(repo.path, path))?.id ??
      this.store.listWorktrees().find((tree) => same(tree.path, path))
        ?.repositoryId ??
      path;
    return this.commandLocks.run(repositoryId, () =>
      gitCommand(path, args, allowedCodes),
    );
  }

  constructor(
    private readonly store: Store,
    directory = process.env.WORKTREEOS_WORKTREE_DIR ??
      join(store.dataDir, 'worktrees'),
  ) {
    if (!isAbsolute(directory))
      throw new Error('WORKTREEOS_WORKTREE_DIR must be absolute');
    mkdirSync(directory, { recursive: true });
    this.worktreeDir = realpathSync.native(directory);
    if (!same(this.worktreeDir, resolve(directory)))
      throw new Error(
        'Worktree directory must not use symlink or junction aliases',
      );
  }

  private async mutate<T>(repositoryId: string, operation: () => Promise<T>) {
    return this.mutationLocks.run(repositoryId, async () => {
      if (
        [...this.executionLeases].some(
          (id) => this.store.getWorktree(id)?.repositoryId === repositoryId,
        )
      )
        throw new AppError(
          409,
          'WORKTREE_IN_USE',
          'Repository execution is in progress; finish or cancel it before Git mutation',
        );
      this.mutating.add(repositoryId);
      try {
        return await operation();
      } finally {
        this.mutating.delete(repositoryId);
      }
    });
  }

  private async repository(id: string) {
    const record = this.store.getRepository(id);
    if (!record)
      throw new AppError(404, 'REPOSITORY_NOT_FOUND', 'Repository not found');
    const path = await this.commandLocks.run(id, () =>
      validateRepositoryPath(record.path),
    );
    if (!same(path, record.path))
      throw new AppError(
        409,
        'REPOSITORY_CHANGED',
        'Registered repository path changed',
      );
    return { ...record, path };
  }

  private async safeBase() {
    if (!same(await realpath(this.worktreeDir), this.worktreeDir))
      throw new AppError(
        409,
        'UNSAFE_WORKTREE_PATH',
        'Worktree base was replaced or redirected',
      );
    for (const repository of this.store.listRepositories()) {
      if (
        inside(repository.path, this.worktreeDir) ||
        inside(this.worktreeDir, repository.path)
      )
        throw new AppError(
          409,
          'UNSAFE_WORKTREE_BASE',
          'Managed worktrees must be separate from all registered repositories',
        );
    }
  }

  list(repositoryId?: string) {
    if (repositoryId && !this.store.getRepository(repositoryId))
      throw new AppError(404, 'REPOSITORY_NOT_FOUND', 'Repository not found');
    return this.store.listWorktrees(repositoryId);
  }

  async create(input: { taskId: string; branch?: string | undefined }) {
    const data = createWorktreeSchema.parse(input);
    const owner = this.store.getTask(data.taskId);
    if (!owner) throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    return this.mutate(owner.repositoryId, async () => {
      const task = this.store.getTask(data.taskId);
      if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
      if (this.store.getTaskWorktree(task.id))
        throw new AppError(
          409,
          'WORKTREE_EXISTS',
          'Task already has a managed worktree',
        );
      const repository = await this.repository(task.repositoryId);
      await this.safeBase();
      if (
        (
          await this.command(repository.path, [
            'status',
            '--porcelain=v1',
            '-z',
            '--untracked-files=all',
            '--ignore-submodules=none',
          ])
        ).length
      )
        throw new AppError(
          409,
          'DIRTY_REPOSITORY',
          'Commit or preserve base repository changes before creating a worktree',
        );
      const head = (
        await this.command(
          repository.path,
          ['rev-parse', '--verify', 'HEAD^{commit}'],
          [0, 128],
        )
      ).trim();
      if (!/^[a-f0-9]{40,64}$/i.test(head))
        throw new AppError(
          409,
          'MISSING_COMMIT',
          'Repository needs an initial commit',
        );
      const id = randomUUID();
      const slug =
        task.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 35) || 'task';
      const branch = branchSchema.parse(
        data.branch ?? `worktreeos/${slug}-${id.slice(0, 8)}`,
      );
      const existing = await this.command(repository.path, [
        'for-each-ref',
        '--format=%(refname)',
        `refs/heads/${branch}`,
      ]);
      if (existing.trim())
        throw new AppError(
          409,
          'BRANCH_EXISTS',
          'Requested branch already exists',
        );
      const path = join(this.worktreeDir, id);
      try {
        await lstat(path);
        throw new AppError(
          409,
          'WORKTREE_PATH_EXISTS',
          'Worktree destination already exists',
        );
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
      }
      await this.command(repository.path, [
        'worktree',
        'add',
        '-b',
        branch,
        '--',
        path,
        head,
      ]);
      // If persistence fails, preserve the created tree for manual inspection; never auto-delete it.
      return this.store.saveWorktree({
        id,
        taskId: task.id,
        repositoryId: repository.id,
        branch,
        path,
        createdAt: new Date().toISOString(),
        removedAt: null,
      });
    });
  }

  async validate(id: string): Promise<Worktree> {
    const record = this.store.getWorktree(id);
    if (!record)
      throw new AppError(
        404,
        'WORKTREE_NOT_FOUND',
        'Managed worktree not found',
      );
    const repository = await this.repository(record.repositoryId);
    await this.safeBase();
    try {
      if (
        !same(record.path, join(this.worktreeDir, record.id)) ||
        !same(await realpath(record.path), record.path)
      )
        throw new Error('redirected');
      const top = await realpath(
        (
          await this.command(record.path, ['rev-parse', '--show-toplevel'])
        ).trim(),
      );
      const common = (
        await this.command(record.path, [
          'rev-parse',
          '--path-format=absolute',
          '--git-common-dir',
        ])
      ).trim();
      const branch = (
        await this.command(record.path, ['symbolic-ref', '--quiet', 'HEAD'])
      ).trim();
      if (
        !same(top, record.path) ||
        !same(
          await realpath(common),
          await realpath(join(repository.path, '.git')),
        ) ||
        branch !== `refs/heads/${record.branch}`
      )
        throw new Error('mismatched');
    } catch {
      throw new AppError(
        409,
        'UNSAFE_WORKTREE_PATH',
        'Managed worktree is missing, redirected, detached, or no longer associated with its registered repository and branch',
      );
    }
    return record;
  }

  async files(id: string): Promise<ChangedFile[]> {
    const tree = await this.validate(id);
    const fields = (
      await this.command(tree.path, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignore-submodules=none',
      ])
    ).split('\0');
    const files: ChangedFile[] = [];
    for (let index = 0; index < fields.length; index++) {
      const field = fields[index];
      if (!field) continue;
      const status = field.slice(0, 2);
      const path = field.slice(3);
      if (status.includes('R') || status.includes('C')) {
        const previousPath = fields[++index];
        if (previousPath) files.push({ status, path, previousPath });
      } else files.push({ status, path });
    }
    return files;
  }

  async status(id: string) {
    const files = await this.files(id);
    return { worktreeId: id, clean: files.length === 0, files };
  }
  async diff(id: string) {
    const tree = await this.validate(id);
    return {
      worktreeId: id,
      diff: await this.command(tree.path, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--ignore-submodules=all',
        'HEAD',
        '--',
      ]),
      untrackedFiles: (await this.files(id))
        .filter((file) => file.status === '??')
        .map((file) => file.path),
    };
  }

  async remove(id: string, confirm: boolean) {
    if (confirm !== true)
      throw new AppError(
        400,
        'CONFIRMATION_REQUIRED',
        'Explicit confirm: true is required',
      );
    const owner = this.store.getWorktree(id);
    if (!owner)
      throw new AppError(404, 'WORKTREE_NOT_FOUND', 'Worktree not found');
    return this.mutate(owner.repositoryId, async () => {
      if (this.executionLeases.has(id) || !this.canRemove(id))
        throw new AppError(
          409,
          'WORKTREE_IN_USE',
          'Cancel or finish the associated run before removing its worktree',
        );
      const tree = await this.validate(id);
      const indexed = (await this.command(tree.path, ['ls-files', '-v', '-z']))
        .split('\0')
        .filter(Boolean);
      if (indexed.some((file) => file[0] !== 'H'))
        throw new AppError(
          409,
          'UNSAFE_INDEX_FLAGS',
          'Clear skip-worktree or assume-unchanged index flags and review files before removal',
        );
      if (
        (await this.files(id)).length ||
        (
          await this.command(tree.path, [
            'ls-files',
            '--others',
            '--ignored',
            '--exclude-standard',
            '-z',
          ])
        ).length
      )
        throw new AppError(
          409,
          'DIRTY_WORKTREE',
          'Worktree contains tracked, untracked, or ignored changes; removal would lose files',
        );
      const repository = await this.repository(tree.repositoryId);
      await this.command(repository.path, [
        'worktree',
        'remove',
        '--',
        tree.path,
      ]);
      this.store.markWorktreeRemoved(id);
      return { removed: true, branchRetained: true };
    });
  }
}
