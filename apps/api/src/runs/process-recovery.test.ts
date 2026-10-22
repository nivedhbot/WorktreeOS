import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { commitFixture, createFixture } from '../test/fixtures.js';

it(
  'reaps an abruptly stopped local Node process on Windows, reclaims its scheduler lock, and interrupts durable work without replay',
  { timeout: 30000 },
  async () => {
    const fixture = createFixture();
    commitFixture(fixture);
    let app = buildApp({}, { dataDir: fixture.dataDir });
    const repo = (
      await app.inject({
        method: 'POST',
        url: '/api/repos',
        payload: { name: 'Process test', path: fixture.repoPath },
      })
    ).json();
    const task = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          repositoryId: repo.id,
          title: 'Crash test',
          objective: 'MOCK only',
        },
      })
    ).json();
    const tree = (
      await app.inject({
        method: 'POST',
        url: '/api/worktrees',
        payload: { taskId: task.id },
      })
    ).json();
    await app.close();
    const code = `import {buildApp} from ${JSON.stringify(new URL('../app.ts', import.meta.url).href)}; import {MockProvider} from ${JSON.stringify(new URL('../agents/mock-provider.ts', import.meta.url).href)}; const app=buildApp({}, {dataDir:${JSON.stringify(fixture.dataDir)},provider:new MockProvider(60000)}); const address=await app.listen({host:'127.0.0.1',port:0}); process.stdout.write(JSON.stringify({address})+String.fromCharCode(10));`;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', code],
      { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const closed = once(child, 'close');
    let stderr = '';
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    try {
      const address = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Child API startup timed out: ${stderr}`)),
          10000,
        );
        let output = '';
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('close', () => {
          clearTimeout(timer);
          reject(new Error(`Child API exited: ${stderr}`));
        });
        child.stdout.on('data', (data: Buffer) => {
          output += data.toString();
          if (output.includes('\n')) {
            clearTimeout(timer);
            resolve(
              (JSON.parse(output.split('\n')[0]!) as { address: string })
                .address,
            );
          }
        });
      });
      const response = await fetch(`${address}/api/tasks/${task.id}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worktreeId: tree.id }),
        signal: AbortSignal.timeout(10000),
      });
      expect(response.status).toBe(202);
      const run = (await response.json()) as { id: string };
      let status = '';
      for (let index = 0; index < 200 && status !== 'running'; index++) {
        status = (
          (await (
            await fetch(`${address}/api/runs/${run.id}`, {
              signal: AbortSignal.timeout(5000),
            })
          ).json()) as { status: string }
        ).status;
        if (status !== 'running') await delay(20);
      }
      expect(status).toBe('running');
      writeFileSync(
        join(tree.path as string, 'retained.txt'),
        'Keep this work\n',
      );
      const pid = child.pid!;
      expect(
        Number(readFileSync(join(fixture.dataDir, 'scheduler.lock'), 'utf8')),
      ).toBe(pid);
      child.kill();
      await closed;
      expect(() => process.kill(pid, 0)).toThrow();
      app = buildApp({}, { dataDir: fixture.dataDir });
      expect((await app.inject(`/api/runs/${run.id}`)).json().status).toBe(
        'interrupted',
      );
      expect(
        (await app.inject(`/api/runs/${run.id}/events`)).json().events.at(-1)
          .payload.status,
      ).toBe('interrupted');
      await delay(150);
      expect(
        (await app.inject(`/api/tasks/${task.id}/runs`)).json().runs,
      ).toHaveLength(1);
      expect(
        readFileSync(join(tree.path as string, 'retained.txt'), 'utf8'),
      ).toBe('Keep this work\n');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
      await app.close();
      fixture.cleanup();
    }
  },
);
