import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './index.js';

describe('health contract', () => {
  it('rejects malformed or unhealthy responses', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(
      false,
    );
    expect(
      healthResponseSchema.safeParse({
        status: 'down',
        service: 'worktreeos-api',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });
});
