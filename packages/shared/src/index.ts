import { z } from 'zod';
export * from './domain.js';
export * from './worktrees.js';
export * from './runs.js';
export * from './workflow.js';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('worktreeos-api'),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
