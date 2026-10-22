import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadEvent } from '@openai/codex-sdk';
import { CodexProvider } from './codex-provider.js';
import type { AgentContext } from './provider.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { codexConfigOverrides } from './codex-policy.js';

afterEach(() => vi.unstubAllEnvs());

const context = (): AgentContext => ({
  task: {
    id: randomUUID(),
    repositoryId: randomUUID(),
    title: 'Inspect',
    objective: 'Summarize README only',
    provider: 'mock',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  worktree: {
    id: randomUUID(),
    taskId: randomUUID(),
    repositoryId: randomUUID(),
    branch: 'task/test',
    path: 'E:\\managed\\test',
    createdAt: new Date().toISOString(),
    removedAt: null,
  },
  signal: new AbortController().signal,
  model: 'gpt-6-luna',
});
describe('Codex adapter (SDK fakes only)', () => {
  it('refuses nested and already canceled execution before constructing an SDK client', async () => {
    const factory = vi.fn();
    const provider = new CodexProvider(factory);
    vi.stubEnv('WORKTREEOS_AGENT_CHILD', '1');
    await expect(
      Array.fromAsync(provider.run(context())),
    ).rejects.toMatchObject({
      code: 'RECURSIVE_AGENT_BLOCKED',
    });
    vi.unstubAllEnvs();
    await expect(
      Array.fromAsync(
        provider.run({
          ...context(),
          signal: AbortSignal.abort(),
        }),
      ),
    ).rejects.toThrow();
    expect(factory).not.toHaveBeenCalled();
  });
  it('unwinds the SDK event iterator on cancellation before returning', async () => {
    const controller = new AbortController();
    let cleaned = false;
    const provider = new CodexProvider(() => ({
      startThread: () => ({
        runStreamed: async (_input, options) => ({
          events: (async function* () {
            try {
              yield {
                type: 'thread.started' as const,
                thread_id: 'cancel-thread',
              };
              await delay(10000, undefined, { signal: options.signal });
            } finally {
              cleaned = true;
            }
          })(),
        }),
      }),
    }));
    const iterable = provider.run({ ...context(), signal: controller.signal });
    const iterator = iterable[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({
      threadId: 'cancel-thread',
    });
    controller.abort();
    await expect(iterator.next()).rejects.toThrow();
    expect(cleaned).toBe(true);
  });
  it('stops failed command items when interactive approval is unavailable', async () => {
    const cleaned = vi.fn();
    const provider = new CodexProvider(() => ({
      startThread: () => ({
        runStreamed: async () => ({
          events: (async function* () {
            try {
              yield {
                type: 'item.completed' as const,
                item: {
                  id: 'command',
                  type: 'command_execution' as const,
                  command: 'restricted action',
                  aggregated_output: 'Approval unavailable',
                  exit_code: 1,
                  status: 'failed' as const,
                },
              };
            } finally {
              cleaned();
            }
          })(),
        }),
      }),
    }));
    await expect(Array.fromAsync(provider.run(context()))).rejects.toThrow(
      'no approval was bypassed',
    );
    expect(cleaned).toHaveBeenCalledOnce();
  });
  it('sets restrictive SDK options, forwards cancellation, and translates actual identifiers/items/usage', async () => {
    const usage = {
      input_tokens: 17,
      cached_input_tokens: 3,
      cache_write_input_tokens: 0,
      output_tokens: 9,
      reasoning_output_tokens: 4,
    };
    const events: ThreadEvent[] = [
      { type: 'thread.started', thread_id: 'actual-thread' },
      {
        type: 'item.completed',
        item: { id: 'i1', type: 'agent_message', text: 'README summary' },
      },
      { type: 'turn.completed', usage },
    ];
    const runStreamed = vi.fn(async () => ({
      events: (async function* () {
        yield* events;
      })(),
    }));
    const startThread = vi.fn(() => ({ runStreamed }));
    const factory = vi.fn(() => ({ startThread }));
    const provider = new CodexProvider(factory);
    const ctx = context();
    const output = await Array.fromAsync(provider.run(ctx));
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: ctx.worktree.path,
        model: 'gpt-6-luna',
        sandboxMode: 'read-only',
        networkAccessEnabled: false,
        webSearchMode: 'disabled',
        skipGitRepoCheck: false,
      }),
    );
    expect(startThread).toHaveBeenCalledWith(
      expect.not.objectContaining({
        approvalPolicy: expect.anything(),
      }),
    );
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({ WORKTREEOS_AGENT_CHILD: '1' }),
        configOverrides: codexConfigOverrides,
        config: expect.objectContaining({
          model_providers: {
            openai: { request_max_retries: 0, stream_max_retries: 0 },
          },
        }),
      }),
      ctx,
    );
    expect(runStreamed).toHaveBeenCalledWith(ctx.task.objective, {
      signal: ctx.signal,
    });
    expect(output).toEqual([
      expect.objectContaining({
        type: 'codex.thread',
        threadId: 'actual-thread',
      }),
      expect.objectContaining({
        type: 'codex.item',
        message: 'README summary',
        item: events[1] && 'item' in events[1] ? events[1].item : null,
      }),
      expect.objectContaining({ type: 'codex.usage', usage }),
    ]);
  });
  it.each([
    '401 auth secret-token',
    '429 quota secret-token',
    'approval required secret-token',
    'process exited secret-token',
  ])(
    'fails once with sanitized setup/usage/approval errors: %s',
    async (message) => {
      const factory = vi.fn(() => ({
        startThread: () => ({
          runStreamed: async () => {
            throw new Error(message);
          },
        }),
      }));
      await expect(
        Array.fromAsync(new CodexProvider(factory).run(context())),
      ).rejects.toMatchObject({
        code: 'CODEX_EXECUTION_FAILED',
        message: expect.not.stringContaining('secret-token'),
      });
      expect(factory).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects incomplete streams without inventing usage', async () => {
    const provider = new CodexProvider(() => ({
      startThread: () => ({
        runStreamed: async () => ({
          events: (async function* () {
            yield { type: 'turn.started' as const };
          })(),
        }),
      }),
    }));
    await expect(Array.fromAsync(provider.run(context()))).rejects.toThrow(
      'Codex setup or execution failed',
    );
  });
});
