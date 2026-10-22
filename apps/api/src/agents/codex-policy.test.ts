import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createFixture } from '../test/fixtures.js';
import { codexBinary, createAvailabilityCheck } from './codex-availability.js';
import {
  codexConfigOverrides,
  isolatedCodexOverrides,
} from './codex-policy.js';

afterEach(() => vi.unstubAllEnvs());

describe('Codex execution boundaries', () => {
  it('blocks child API startup and discovery before creating data or launching a process', async () => {
    const fixture = createFixture();
    try {
      vi.stubEnv('WORKTREEOS_AGENT_CHILD', '1');
      expect(() => buildApp({}, { dataDir: fixture.dataDir })).toThrow(
        'cannot start inside an agent execution',
      );
      expect(existsSync(fixture.dataDir)).toBe(false);
      const launch = vi.fn();
      expect((await createAvailabilityCheck(launch)()).models).toEqual([]);
      expect(launch).not.toHaveBeenCalled();
    } finally {
      fixture.cleanup();
    }
  });

  it('the installed CLI accepts deny-only approvals and disables inherited tools without a model turn', async () => {
    const fixture = createFixture();
    const configDir = join(fixture.root, 'empty-codex-home');
    mkdirSync(configDir);
    writeFileSync(
      join(configDir, 'config.toml'),
      [
        '[mcp_servers."must.not_launch"]',
        'command = "nonexistent-worktreeos-test-command"',
        '[features]',
        'apps = true',
        'plugins = true',
        'multi_agent = true',
        '[agents]',
        'enabled = true',
      ].join('\n'),
    );
    const env = {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      CODEX_HOME: configDir,
    };
    const cli = (args: string[], overrides = codexConfigOverrides) =>
      execFileSync(
        codexBinary(),
        [...overrides.flatMap((value) => ['-c', value]), ...args],
        {
          cwd: fixture.root,
          // Empty authentication/configuration directory; these commands only read configuration.
          env,
          windowsHide: true,
          shell: false,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10000,
        },
      );
    try {
      expect(JSON.parse(cli(['mcp', 'list', '--json'], []))).toHaveLength(1);
      const overrides = await isolatedCodexOverrides(env, fixture.root);
      expect(JSON.parse(cli(['mcp', 'list', '--json'], overrides))).toEqual([
        expect.objectContaining({ name: 'must.not_launch', enabled: false }),
      ]);
      const features = cli(['features', 'list']);
      for (const name of [
        'apps',
        'plugins',
        'multi_agent',
        'shell_snapshot',
        'hooks',
        'skill_mcp_dependency_install',
      ])
        expect(features).toMatch(new RegExp(`^${name}\\s+.*\\sfalse$`, 'm'));
    } finally {
      fixture.cleanup();
    }
  });
});
