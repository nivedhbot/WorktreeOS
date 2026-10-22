import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../api/src/app';
import { MockProvider } from '../../api/src/agents/mock-provider';
import { commitFixture, createFixture } from '../../api/src/test/fixtures';
import { worktreeSchema } from '@worktreeos/shared';
import { App } from './App';

const nativeFetch = globalThis.fetch;
function click(element: HTMLElement) {
  fireEvent.mouseDown(element, { button: 0, ctrlKey: false });
  fireEvent.click(element);
}

describe(
  'dashboard with real local Git, SQLite, REST, and SSE',
  { timeout: 20000 },
  () => {
    let fixture: ReturnType<typeof createFixture>;
    let app: ReturnType<typeof buildApp>;
    let origin: string;
    const sources: AbortController[] = [];

    beforeEach(async () => {
      fixture = createFixture();
      commitFixture(fixture);
      app = buildApp(
        {},
        {
          dataDir: fixture.dataDir,
          worktreeDir: join(fixture.root, 'managed'),
          provider: new MockProvider(80),
          heartbeatMs: 20,
        },
      );
      origin = await app.listen({ host: '127.0.0.1', port: 0 });
      vi.stubGlobal(
        'fetch',
        async (input: RequestInfo | URL, options?: RequestInit) => {
          const url = new URL(String(input), origin);
          return nativeFetch(url, options);
        },
      );

      // Test-only EventSource adapter consumes the real HTTP SSE stream; no events are fabricated.
      class HttpEventSource extends EventTarget {
        onopen: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private readonly controller = new AbortController();
        constructor(url: string) {
          super();
          sources.push(this.controller);
          void this.consume(url);
        }
        close() {
          this.controller.abort();
        }
        private async consume(url: string) {
          try {
            const response = await nativeFetch(new URL(url, origin), {
              signal: this.controller.signal,
            });
            if (!response.ok || !response.body)
              throw new Error('SSE unavailable');
            this.onopen?.();
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let pending = '';
            while (!this.controller.signal.aborted) {
              const chunk = await reader.read();
              if (chunk.done) break;
              pending += decoder.decode(chunk.value, { stream: true });
              const frames = pending.split('\n\n');
              pending = frames.pop() ?? '';
              for (const frame of frames) {
                const data = frame
                  .split('\n')
                  .filter((line) => line.startsWith('data: '))
                  .map((line) => line.slice(6))
                  .join('\n');
                if (data && !this.controller.signal.aborted)
                  this.dispatchEvent(new MessageEvent('run-event', { data }));
              }
            }
          } catch {
            if (!this.controller.signal.aborted) this.onerror?.();
          }
        }
      }
      vi.stubGlobal('EventSource', HttpEventSource);
    });
    afterEach(async () => {
      cleanup();
      for (const source of sources) source.abort();
      sources.length = 0;
      await app.close();
      fixture.cleanup();
      vi.unstubAllGlobals();
    });

    it('registers a temporary repo, creates a task/worktree, watches a real MOCK stream, and inspects a real dirty diff', async () => {
      render(<App />);
      click(
        await screen.findByRole('button', {
          name: 'Register your first repository',
        }),
      );
      let dialog = screen.getByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Repository name'), {
        target: { value: 'Temporary integration repo' },
      });
      fireEvent.change(
        within(dialog).getByLabelText('Local Git repository path'),
        { target: { value: fixture.repoPath } },
      );
      click(
        within(dialog).getByRole('button', { name: 'Register repository' }),
      );
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      click(screen.getByRole('button', { name: 'New task' }));
      dialog = screen.getByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Task title'), {
        target: { value: 'Inspect a real local run' },
      });
      fireEvent.change(within(dialog).getByLabelText('Objective'), {
        target: {
          value: 'Simulate the workflow and inspect actual Git changes.',
        },
      });
      click(within(dialog).getByRole('button', { name: 'Create task' }));
      expect(
        await screen.findByRole('heading', {
          name: 'Inspect a real local run',
        }),
      ).toBeInTheDocument();
      click(screen.getByRole('button', { name: 'Create worktree' }));
      await waitFor(
        () =>
          expect(
            screen.getByRole('button', { name: 'Start MOCK run' }),
          ).toBeEnabled(),
        { timeout: 5000 },
      );
      click(screen.getByRole('button', { name: 'Start MOCK run' }));
      expect(
        await screen.findByText(
          'MOCK: simulated tool inspection; no command executed',
          {},
          { timeout: 6000 },
        ),
      ).toBeInTheDocument();
      expect(
        await screen.findByText(
          'MOCK simulation completed; no real agent was executed',
          {},
          { timeout: 6000 },
        ),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Cancel run' }),
        ).not.toBeInTheDocument(),
      );
      const listed = await app.inject('/api/worktrees');
      const tree = worktreeSchema.parse(listed.json().worktrees[0]);
      writeFileSync(
        join(tree.path, 'README.md'),
        'A real change for inspection\n',
      );
      writeFileSync(
        join(tree.path, 'new-file.txt'),
        'Preserve this untracked file\n',
      );
      click(screen.getByRole('tab', { name: 'Changes' }));
      expect(
        await screen.findByRole(
          'region',
          { name: 'Git diff' },
          { timeout: 5000 },
        ),
      ).toHaveTextContent('+A real change for inspection');
      expect(
        screen.getByText('new-file.txt', { selector: 'code' }),
      ).toBeInTheDocument();
      expect(readFileSync(join(fixture.repoPath, 'README.md'), 'utf8')).toBe(
        'Initial content\n',
      );
      click(screen.getByRole('button', { name: 'Remove managed worktree' }));
      dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('checkbox'));
      click(within(dialog).getByRole('button', { name: 'Confirm removal' }));
      expect(
        await within(dialog).findByRole('alert', {}, { timeout: 5000 }),
      ).toHaveTextContent('removal would lose files');
      expect(readFileSync(join(tree.path, 'new-file.txt'), 'utf8')).toBe(
        'Preserve this untracked file\n',
      );
    });
  },
);
