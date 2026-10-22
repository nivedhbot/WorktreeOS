import { z } from 'zod';
import { idSchema } from './domain.js';

export const branchSchema = z
  .string()
  .regex(
    /^worktreeos\/[a-z0-9][a-z0-9-]{0,63}$/,
    'Use worktreeos/ followed by a lowercase slug (letters, digits, hyphens)',
  );
export const createWorktreeSchema = z.strictObject({
  taskId: idSchema,
  branch: branchSchema.optional(),
});
export const removeWorktreeSchema = z.strictObject({
  confirm: z.literal(true),
});
export const worktreeSchema = z.strictObject({
  id: idSchema,
  taskId: idSchema,
  repositoryId: idSchema,
  branch: branchSchema,
  path: z.string(),
  createdAt: z.iso.datetime(),
  removedAt: z.iso.datetime().nullable(),
});
export const changedFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  previousPath: z.string().optional(),
});
export type Worktree = z.infer<typeof worktreeSchema>;
export type ChangedFile = z.infer<typeof changedFileSchema>;
