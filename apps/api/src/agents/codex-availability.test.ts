import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAvailabilityCheck } from './codex-availability.js';

class FakeProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  stopped = false;
  kill = vi.fn(() => {
    if (!this.stopped) {
      this.stopped = true;
      queueMicrotask(() => this.emit('close'));
    }
    return true;
  });
  reply(id: number, result: unknown) {
    this.stdout.write(`${JSON.stringify({ id, result })}\n`);
  }
}
afterEach(() => vi.useRealTimers());
describe('read-only Codex discovery (fake process)', () => {
  it('handshakes, checks existing auth without refreshing, paginates models, filters account availability and closes the process', async () => {
    const child = new FakeProcess();
    const methods: string[] = [];
    child.stdin.on('data', (chunk: Buffer) => {
      const request = JSON.parse(chunk.toString()) as {
        method: string;
        id: number;
        params: Record<string, unknown>;
      };
      methods.push(request.method);
      queueMicrotask(() => {
        if (request.method === 'initialize') child.reply(request.id, {});
        if (request.method === 'account/read') {
          expect(request.params.refreshToken).toBe(false);
          child.reply(request.id, {
            account: { type: 'chatgpt', email: 'private@example.invalid' },
          });
        }
        if (request.method === 'model/list')
          child.reply(
            request.id,
            request.params.cursor
              ? {
                  data: [{ model: 'gpt-6.1-sol', hidden: false }],
                  nextCursor: null,
                }
              : {
                  data: [
                    { model: 'other-model' },
                    { model: 'gpt-6-luna', hidden: false },
                  ],
                  nextCursor: 'page-2',
                },
          );
      });
    });
    const launch = vi.fn(() => child);
    const check = createAvailabilityCheck(launch);
    const one = check();
    const two = check();
    const result = await one;
    expect(await two).toEqual(result);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      models: ['gpt-6-luna', 'gpt-6.1-sol'],
      error: null,
    });
    expect(methods).toEqual([
      'initialize',
      'initialized',
      'account/read',
      'model/list',
      'model/list',
    ]);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.stdin.writableEnded).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('fails closed with no account and never asks to log in or lists models', async () => {
    const child = new FakeProcess();
    const methods: string[] = [];
    child.stdin.on('data', (chunk: Buffer) => {
      const request = JSON.parse(chunk.toString()) as {
        method: string;
        id: number;
      };
      methods.push(request.method);
      queueMicrotask(() => {
        if (request.method === 'initialize') child.reply(request.id, {});
        if (request.method === 'account/read')
          child.reply(request.id, { account: null });
      });
    });
    expect(await createAvailabilityCheck(() => child)()).toEqual({
      models: [],
      error: expect.stringContaining('Sign in with the Codex CLI'),
    });
    expect(methods).toEqual(['initialize', 'initialized', 'account/read']);
    expect(child.stopped).toBe(true);
  });
  it('times out, kills the process, clears timers, and offers no unverified models', async () => {
    vi.useFakeTimers();
    const child = new FakeProcess();
    const check = createAvailabilityCheck(() => child, 100);
    const pending = check();
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toEqual({
      models: [],
      error: expect.stringContaining('timed out'),
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('sanitizes process setup failure without retries', async () => {
    const launch = vi.fn(() => {
      throw new Error('secret environment data');
    });
    expect(await createAvailabilityCheck(launch)()).toEqual({
      models: [],
      error: expect.not.stringContaining('secret'),
    });
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
