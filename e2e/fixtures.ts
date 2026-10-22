import { test as base, expect } from '@playwright/test';
import { preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../apps/api/src/app.js';
import { MockProvider } from '../apps/api/src/agents/mock-provider.js';
import type { AgentProvider } from '../apps/api/src/agents/provider.js';
import { commitFixture, createFixture } from '../apps/api/src/test/fixtures.js';
import { listenLoopback } from '../apps/api/src/security.js';

type LocalApp = { url: string; fixtures: ReturnType<typeof createFixture>[] };
export const test = base.extend<{
  repo: ReturnType<typeof createFixture>;
  localApp: LocalApp;
}>({
  localApp: [
    async ({ browserName }, use) => {
      if (browserName !== 'chromium')
        throw new Error('The QA fixture is configured for Chromium');
      const fixture = createFixture();
      const fixtures: ReturnType<typeof createFixture>[] = [];
      const codex: AgentProvider = {
        id: 'codex',
        mode: 'CODEX',
        async *run({ signal }) {
          signal.throwIfAborted();
          yield {
            type: 'codex.thread',
            mode: 'CODEX',
            threadId: 'e2e-fake-thread',
            message: 'E2E fake Codex provider; no model called',
          };
        },
      };
      let app: ReturnType<typeof buildApp> | undefined;
      let frontend: Awaited<ReturnType<typeof preview>> | undefined;
      try {
        app = buildApp(
          {},
          {
            dataDir: fixture.dataDir,
            provider: new MockProvider(450),
            codexProvider: codex,
            codexAvailability: async () => ({
              models: ['gpt-6-luna'],
              error: null,
            }),
            heartbeatMs: 100,
          },
        );
        const address = await listenLoopback(app, 0);
        const root = fileURLToPath(new URL('../apps/web/', import.meta.url));
        frontend = await preview({
          root,
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
          throw new Error('Missing preview address');
        await use({ url: `http://127.0.0.1:${server.port}`, fixtures });
      } finally {
        try {
          if (frontend) {
            const server = frontend.httpServer;
            if ('closeAllConnections' in server) server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
          }
        } finally {
          try {
            await app?.close();
          } finally {
            for (const repo of fixtures) repo.cleanup();
            fixture.cleanup();
          }
        }
      }
    },
    { timeout: 30000 },
  ],
  baseURL: async ({ localApp }, use) => {
    await use(localApp.url);
  },
  repo: async ({ localApp }, use) => {
    const fixture = createFixture();
    commitFixture(fixture);
    localApp.fixtures.push(fixture);
    await use(fixture);
  },
});
export { expect };
