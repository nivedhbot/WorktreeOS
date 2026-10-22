import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateRepositoryPath } from './validate-path.js';
import { createFixture } from '../test/fixtures.js';

describe('local repository registration', () => {
  let fixture: ReturnType<typeof createFixture>;
  beforeEach(() => {
    fixture = createFixture();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fixture.cleanup();
  });

  it('canonicalizes a real repository path with spaces and ignores inherited Git overrides', async () => {
    vi.stubEnv('GIT_DIR', join(fixture.root, 'not-a-repo'));
    vi.stubEnv('GIT_WORK_TREE', fixture.root);
    expect(await validateRepositoryPath(`${fixture.repoPath}/.`)).toBe(
      realpathSync(fixture.repoPath),
    );
  });

  it('rejects a child directory instead of silently registering its parent', async () => {
    const child = join(fixture.repoPath, 'src');
    mkdirSync(child);
    await expect(validateRepositoryPath(child)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects a fake .git directory and a bare repository', async () => {
    const fake = join(fixture.root, 'fake');
    mkdirSync(join(fake, '.git'), { recursive: true });
    await expect(validateRepositoryPath(fake)).rejects.toMatchObject({
      statusCode: 400,
    });
    const bare = join(fixture.root, 'bare');
    execFileSync('git', ['init', '--bare', '--quiet', bare], {
      shell: false,
      windowsHide: true,
    });
    await expect(validateRepositoryPath(bare)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects junction or symbolic-link aliases and escaping Git metadata', async () => {
    const alias = join(fixture.root, 'alias');
    symlinkSync(
      fixture.repoPath,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(validateRepositoryPath(alias)).rejects.toMatchObject({
      statusCode: 400,
    });
    const fake = join(fixture.root, 'escape');
    mkdirSync(fake);
    symlinkSync(
      join(fixture.repoPath, '.git'),
      join(fake, '.git'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(validateRepositoryPath(fake)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it.each([
    '../repo',
    '/tmp/a/../b',
    'https://example.com/repo',
    'ssh://host/repo',
    'file:///tmp/repo',
    '//server/share',
    '\\\\server\\share',
    '\\\\?\\C:\\repo',
    'C:\\repo\u0000',
  ])('rejects unsafe path %j before Git', async (path) => {
    await expect(validateRepositoryPath(path)).rejects.toMatchObject({
      code: 'INVALID_REPOSITORY_PATH',
    });
  });
});
