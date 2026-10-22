import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFixture } from '../test/fixtures.js';
import { claimScheduler } from './ownership.js';

it(
  'allows only one process to reclaim stale scheduler ownership',
  { timeout: 20000 },
  async () => {
    const fixture = createFixture();
    mkdirSync(fixture.dataDir);
    const dead = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
    expect(dead.status).toBe(0);
    writeFileSync(join(fixture.dataDir, 'scheduler.lock'), String(dead.pid));
    const code = `import {claimScheduler} from ${JSON.stringify(new URL('./ownership.ts', import.meta.url).href)};
    let release;
    process.on('message', (action) => {
      if (action === 'claim') {
        try { release = claimScheduler(${JSON.stringify(fixture.dataDir)}); process.send({acquired:true}); }
        catch { process.send({acquired:false}); }
      } else { release?.(); process.disconnect(); }
    }); process.send({ready:true});`;
    const children = Array.from({ length: 4 }, () =>
      spawn(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', code],
        {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        },
      ),
    );
    const closed = children.map((child) => once(child, 'close'));
    try {
      await Promise.all(children.map((child) => once(child, 'message')));
      const results = children.map((child) => once(child, 'message'));
      for (const child of children) child.send('claim');
      const acquired = (await Promise.all(results)).map(
        ([result]) => (result as { acquired: boolean }).acquired,
      );
      expect(acquired.filter(Boolean)).toHaveLength(1);
      const winner = children[acquired.indexOf(true)]!;
      expect(
        readFileSync(join(fixture.dataDir, 'scheduler.lock'), 'utf8'),
      ).toBe(String(winner.pid));
      expect(() => claimScheduler(fixture.dataDir)).toThrow(
        'Another WorktreeOS API',
      );
      for (const child of children) child.send('release');
      await Promise.all(closed);
      expect(existsSync(join(fixture.dataDir, 'scheduler.lock'))).toBe(false);
      expect(existsSync(join(fixture.dataDir, 'scheduler.recovery'))).toBe(
        false,
      );
    } finally {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) child.kill();
      await Promise.all(closed);
      fixture.cleanup();
    }
  },
);

it('preserves a live recovery guard instead of stealing stale ownership', () => {
  const fixture = createFixture();
  mkdirSync(fixture.dataDir);
  const lock = join(fixture.dataDir, 'scheduler.lock');
  writeFileSync(lock, '2147483647');
  mkdirSync(join(fixture.dataDir, 'scheduler.recovery'));
  try {
    expect(() => claimScheduler(fixture.dataDir)).toThrow(
      'reclaiming scheduler.lock',
    );
    expect(readFileSync(lock, 'utf8')).toBe('2147483647');
  } finally {
    fixture.cleanup();
  }
});
