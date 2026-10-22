import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

export function createFixture() {
  // The JS realpath implementation can preserve Windows 8.3 names such as
  // RUNNER~1; use the same native canonical spelling as fs.promises.realpath.
  const temporaryBase = realpathSync.native(tmpdir());
  const root = mkdtempSync(join(temporaryBase, 'worktreeos-test-'));
  const repoPath = join(root, 'repo with spaces');
  mkdirSync(repoPath);
  execFileSync('git', ['-C', repoPath, 'init', '--quiet'], {
    windowsHide: true,
    shell: false,
  });
  return {
    root,
    repoPath,
    dataDir: join(root, 'data'),
    cleanup() {
      const child = relative(temporaryBase, root);
      if (
        isAbsolute(child) ||
        child === '..' ||
        child.startsWith(`..${sep}`) ||
        !child.startsWith('worktreeos-test-')
      )
        throw new Error('Refusing to clean an unexpected test directory');
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function fixtureGit(repoPath: string, args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'core.autocrlf=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=WorktreeOS Test',
      '-c',
      'user.email=test@example.invalid',
      '-C',
      repoPath,
      ...args,
    ],
    { shell: false, windowsHide: true, encoding: 'utf8' },
  );
}

export function commitFixture(fixture: ReturnType<typeof createFixture>) {
  writeFileSync(join(fixture.repoPath, 'README.md'), 'Initial content\n');
  writeFileSync(join(fixture.repoPath, '.gitignore'), 'ignored.log\n');
  fixtureGit(fixture.repoPath, ['add', '--', 'README.md', '.gitignore']);
  fixtureGit(fixture.repoPath, ['commit', '--quiet', '-m', 'Initial fixture']);
}
