import { z } from 'zod';

export const idSchema = z.uuid();
const nameSchema = z.string().trim().min(1).max(120);
const timestampSchema = z.iso.datetime();
export const providerSchema = z.literal('mock');
export const dependencyIdsSchema = z
  .array(idSchema)
  .max(100)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'Duplicate prerequisites are not allowed',
  );
export const codexModelSchema = z.enum(['gpt-6-luna', 'gpt-6.1-sol']);
export const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_write_input_tokens: z.number().int().nonnegative().optional(),
  reasoning_output_tokens: z.number().int().nonnegative().optional(),
});
export const runStatusSchema = z.enum([
  'queued',
  'preparing',
  'awaiting_approval',
  'running',
  'completed',
  'failed',
  'canceled',
  'interrupted',
]);

export const createRepositorySchema = z.strictObject({
  name: nameSchema,
  path: z.string().trim().min(1).max(4096),
});
// Repository roots are immutable: registering another root requires explicit registration.
export const editRepositorySchema = z.strictObject({ name: nameSchema });
export const repositorySchema = createRepositorySchema.extend({
  id: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createTaskSchema = z.strictObject({
  repositoryId: idSchema,
  title: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(20_000),
  provider: providerSchema.default('mock'),
  dependencyIds: dependencyIdsSchema.optional(),
});
export const editTaskSchema = z
  .strictObject({
    title: createTaskSchema.shape.title.optional(),
    objective: createTaskSchema.shape.objective.optional(),
    provider: providerSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    'Provide at least one editable field',
  );
export const taskSchema = createTaskSchema
  .omit({ dependencyIds: true })
  .extend({
    id: idSchema,
    revision: z.number().int().nonnegative().optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  });
export const runSchema = z.strictObject({
  id: idSchema,
  taskId: idSchema,
  provider: z.enum(['mock', 'codex']),
  status: runStatusSchema,
  worktreeId: idSchema.nullable().default(null),
  retryOf: idSchema.nullable().default(null),
  mode: z.enum(['MOCK', 'CODEX']).default('MOCK'),
  model: codexModelSchema.nullable().optional(),
  threadId: z.string().nullable().optional(),
  usage: usageSchema.nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const eventPayloadSchema = z.record(z.string(), z.json());
export const eventSchema = z.strictObject({
  id: idSchema,
  runId: idSchema,
  sequence: z.number().int().positive(),
  type: z.string().trim().min(1).max(120),
  payload: eventPayloadSchema,
  createdAt: timestampSchema,
});
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional(),
  }),
});

export type Repository = z.infer<typeof repositorySchema>;
export type CreateRepository = z.infer<typeof createRepositorySchema>;
export type EditRepository = z.infer<typeof editRepositorySchema>;
export type Task = z.infer<typeof taskSchema>;
export type CreateTask = z.infer<typeof createTaskSchema>;
export type EditTask = z.infer<typeof editTaskSchema>;
export type Run = z.infer<typeof runSchema>;
export type RunEvent = z.infer<typeof eventSchema>;
