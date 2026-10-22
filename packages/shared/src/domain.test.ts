import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createTaskSchema,
  editTaskSchema,
  editRepositorySchema,
  eventSchema,
} from './domain.js';

describe('resource contracts', () => {
  it('normalizes text and defaults new tasks to mock only', () => {
    expect(
      createTaskSchema.parse({
        repositoryId: randomUUID(),
        title: ' Task ',
        objective: ' Objective ',
      }),
    ).toMatchObject({
      title: 'Task',
      objective: 'Objective',
      provider: 'mock',
    });
  });
  it('rejects empty edits, read-only fields, and real providers', () => {
    expect(editTaskSchema.safeParse({}).success).toBe(false);
    expect(editTaskSchema.safeParse({ provider: 'codex' }).success).toBe(false);
    expect(editTaskSchema.safeParse({ status: 'running' }).success).toBe(false);
    expect(editRepositorySchema.safeParse({ path: '/other' }).success).toBe(
      false,
    );
  });
  it('rejects non-JSON event payloads', () => {
    expect(
      eventSchema.safeParse({
        id: randomUUID(),
        runId: randomUUID(),
        sequence: 1,
        type: 'note',
        payload: { value: BigInt(1) },
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });
});
