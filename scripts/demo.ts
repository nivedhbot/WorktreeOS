import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { preview } from 'vite';
import {
  repositorySchema,
  taskSchema,
  worktreeSchema,
  runSchema,
  type Run,
} from '@worktreeos/shared';
import { buildApp } from '../apps/api/src/app.js';
import { createDemoFixture } from '../apps/api/src/demo/fixture.js';
import { listenLoopback } from '../apps/api/src/security.js';

const { values } = parseArgs({
  options: { smoke: { type: 'boolean' } },
  strict: true,
});
const fixture = createDemoFixture();
console.log(`Demo files and database (retained after exit): ${fixture.root}`);
// This entry point deliberately does not load .env or discover account authentication.
// Real execution is unavailable even if the host has a signed-in Codex account.
const createApp = () =>
  buildApp(
    {},
    {
      dataDir: fixture.dataDir,
      worktreeDir: fixture.worktreeDir,
      scheduler: { concurrency: 2, queueCapacity: 32, timeoutMs: 900000 },
      codexAvailability: async () => ({
        models: [],
        error:
          'Codex is disabled in the isolated MOCK demo. Use npm run dev for manually approved real runs.',
      }),
    },
  );
let app = createApp();
let frontend: Awaited<ReturnType<typeof preview>> | undefined;
let address = '';
async function request(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${address}${path}`, {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Demo API ${path} returned ${response.status}`);
  return response.json();
}
async function close() {
  if (frontend) {
    const server = frontend.httpServer;
    frontend = undefined;
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await app.close();
}
try {
  address = await listenLoopback(app, 0);
  const repository = repositorySchema.parse(
    await request('/api/repos', {
      name: 'Hello Worktree',
      path: fixture.repoPath,
    }),
  );
  const task = taskSchema.parse(
    await request('/api/tasks', {
      repositoryId: repository.id,
      title: 'Explore the mock workflow',
      objective:
        'Simulate inspecting the greeting fixture. No commands, file changes or model calls are performed by MOCK.',
      provider: 'mock',
    }),
  );
  if (values.smoke) {
    const tree = worktreeSchema.parse(
      await request('/api/worktrees', { taskId: task.id }),
    );
    let run = runSchema.parse(
      await request(`/api/tasks/${task.id}/runs`, {
        worktreeId: tree.id,
        provider: 'mock',
      }),
    );
    const deadline = Date.now() + 20000;
    while (
      ['queued', 'preparing', 'running'].includes(run.status) &&
      Date.now() < deadline
    ) {
      await delay(100);
      run = runSchema.parse(await request(`/api/runs/${run.id}`));
    }
    if (run.status !== 'completed' || run.mode !== 'MOCK')
      throw new Error('MOCK did not complete');
    const events = await request(`/api/runs/${run.id}/events`);
    await app.close();
    app = createApp();
    address = await listenLoopback(app, 0);
    const restored: Run = runSchema.parse(await request(`/api/runs/${run.id}`));
    if (
      restored.status !== 'completed' ||
      JSON.stringify(events) !==
        JSON.stringify(await request(`/api/runs/${run.id}/events`))
    ) {
      throw new Error('Demo run/event history did not survive API restart');
    }
    console.log(
      `PASS: MOCK completed and its run/events survived API restart. No Codex discovery or model calls. Run: ${run.id}`,
    );
  } else {
    frontend = await preview({
      root: fileURLToPath(new URL('../apps/web/', import.meta.url)),
      configFile: false,
      logLevel: 'error',
      preview: {
        host: '127.0.0.1',
        port: 0,
        strictPort: true,
        proxy: { '/api': { target: address } },
      },
    });
    const server = frontend.httpServer.address();
    if (!server || typeof server === 'string')
      throw new Error('No demo preview address');
    const url = `http://127.0.0.1:${server.port}`;
    writeFileSync(
      join(fixture.root, 'demo.json'),
      JSON.stringify(
        {
          ...fixture,
          url,
          api: address,
          repositoryId: repository.id,
          taskId: task.id,
        },
        null,
        2,
      ),
    );
    console.log(
      `Open ${url}\nAPI: ${address}\nSelect Hello Worktree, click Create worktree, then Start MOCK run.\nPress Enter to stop cleanly (or Ctrl+C to interrupt). No credentials are needed; Codex is disabled.`,
    );
    await new Promise<void>((resolve) => {
      const input = createInterface({ input: process.stdin });
      const stop = () => {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        input.removeListener('line', stop);
        input.close();
        resolve();
      };
      input.once('line', stop);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  }
} finally {
  await close();
}
