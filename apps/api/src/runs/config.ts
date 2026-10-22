import { z } from 'zod';
export interface SchedulerOptions {
  concurrency?: number;
  queueCapacity?: number;
  timeoutMs?: number;
}
export function schedulerConfig(options: SchedulerOptions = {}) {
  return z
    .object({
      concurrency: z.coerce.number().int().min(1).max(2),
      queueCapacity: z.coerce.number().int().min(1).max(1000),
      timeoutMs: z.coerce.number().int().min(1).max(86_400_000),
    })
    .parse({
      concurrency:
        options.concurrency ?? process.env.WORKTREEOS_CONCURRENCY ?? 2,
      queueCapacity:
        options.queueCapacity ?? process.env.WORKTREEOS_QUEUE_CAPACITY ?? 32,
      timeoutMs:
        options.timeoutMs ?? process.env.WORKTREEOS_RUN_TIMEOUT_MS ?? 900000,
    });
}
