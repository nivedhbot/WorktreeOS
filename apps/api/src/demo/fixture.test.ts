import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixture, fixtureGit } from '../test/fixtures.js';
import { createDemoFixture } from './fixture.js';

describe('deterministic demo fixture', () => {
  it('allocates distinct repositories with identical commits, no remotes, and a passing tiny test', () => {
    const owner = createFixture();
    try {
      const a = createDemoFixture(owner.root);
      const b = createDemoFixture(owner.root);
      expect(a.root).not.toBe(b.root);
      expect(fixtureGit(a.repoPath, ['rev-parse', 'HEAD'])).toBe(
        fixtureGit(b.repoPath, ['rev-parse', 'HEAD']),
      );
      expect(fixtureGit(a.repoPath, ['remote'])).toBe('');
      expect(fixtureGit(a.repoPath, ['status', '--porcelain'])).toBe('');
      expect(readFileSync(join(a.repoPath, 'greeting.mjs'), 'utf8')).toContain(
        'Hello,',
      );
      expect(
        execFileSync(process.execPath, ['--test'], {
          cwd: a.repoPath,
          shell: false,
          windowsHide: true,
          encoding: 'utf8',
          timeout: 15000,
        }),
      ).toContain('fail 0');
    } finally {
      owner.cleanup();
    }
  });
  it('fails for a missing parent without modifying an existing repository', () => {
    const owner = createFixture();
    try {
      expect(() => createDemoFixture(join(owner.root, 'missing'))).toThrow();
      expect(fixtureGit(owner.repoPath, ['status', '--porcelain'])).toBe('');
    } finally {
      owner.cleanup();
    }
  });
});
