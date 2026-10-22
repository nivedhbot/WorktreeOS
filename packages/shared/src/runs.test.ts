import { describe, expect, it } from 'vitest';
import { canTransitionRun, providerEventSchema } from './runs.js';

describe('MOCK event and state contracts', () => {
  it('permits only explicit lifecycle transitions', () => {
    expect(canTransitionRun('queued', 'preparing')).toBe(true);
    expect(canTransitionRun('queued', 'completed')).toBe(false);
    expect(canTransitionRun('preparing', 'running')).toBe(true);
    expect(canTransitionRun('running', 'completed')).toBe(true);
    for (const terminal of [
      'completed',
      'failed',
      'canceled',
      'interrupted',
    ] as const)
      expect(canTransitionRun(terminal, 'running')).toBe(false);
  });
  it('rejects events that pretend to be real output', () => {
    expect(
      providerEventSchema.safeParse({
        type: 'mock.file',
        mode: 'REAL',
        path: 'file',
        simulated: false,
        message: 'Real result',
      }).success,
    ).toBe(false);
    expect(
      providerEventSchema.safeParse({
        type: 'mock.progress',
        mode: 'MOCK',
        percent: 101,
        message: 'MOCK',
      }).success,
    ).toBe(false);
  });
});
