import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fixed content, author, branch and dates make the fixture's initial commit reproducible.
// Always allocate a new directory: never initialize or overwrite a user's repository.
export function createDemoFixture(parent = tmpdir()) {
  const root = mkdtempSync(join(realpathSync(parent), 'worktreeos-demo-'));
  const repoPath = join(root, 'hello-worktree');
  const dataDir = join(root, 'data');
  const worktreeDir = join(root, 'worktrees');
  mkdirSync(repoPath);
  mkdirSync(dataDir);
  mkdirSync(worktreeDir);
  writeFileSync(
    join(repoPath, 'README.md'),
    '# Hello, worktree\n\nA tiny local WorktreeOS demo. Run `node --test` to check the greeting.\nMOCK runs simulate events and never edit these files.\n',
  );
  writeFileSync(
    join(repoPath, 'greeting.mjs'),
    "export const greet = (name = 'developer') => `Hello, ${name}!`;\n",
  );
  writeFileSync(
    join(repoPath, 'greeting.test.mjs'),
    "import { test } from 'node:test';\nimport { strict as assert } from 'node:assert';\nimport { greet } from './greeting.mjs';\ntest('greets the developer', () => {\n  assert.equal(greet(), 'Hello, developer!');\n  assert.equal(greet('WorktreeOS'), 'Hello, WorktreeOS!');\n});\n",
  );
  // Remove inherited Git routing/configuration, including signing, hooks and templates.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith('GIT_'),
    ),
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  });
  const git = (args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=WorktreeOS Demo',
        '-c',
        'user.email=demo@example.invalid',
        '-C',
        repoPath,
        ...args,
      ],
      {
        env,
        shell: false,
        windowsHide: true,
        timeout: 15000,
        encoding: 'utf8',
      },
    );
  git([
    'init',
    '--quiet',
    '--template=',
    '--initial-branch=main',
    '--object-format=sha1',
  ]);
  git(['add', '--', 'README.md', 'greeting.mjs', 'greeting.test.mjs']);
  git(['commit', '--quiet', '-m', 'Initial deterministic demo']);
  return { root, repoPath, dataDir, worktreeDir };
}
