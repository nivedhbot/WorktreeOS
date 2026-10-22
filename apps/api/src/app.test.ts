import { afterEach, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@worktreeos/shared';
import { buildApp } from './app.js';
import { createFixture } from './test/fixtures.js';

describe('API', () => {
  const fixture = createFixture();
  const app = buildApp({}, { dataDir: fixture.dataDir });
  afterEach(async () => {
    await app.close();
    fixture.cleanup();
  });

  it('serves a valid, fresh health response', async () => {
    const before = Date.now();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const health = healthResponseSchema.parse(response.json());
    expect(Date.parse(health.timestamp)).toBeGreaterThanOrEqual(before);
  });
});
