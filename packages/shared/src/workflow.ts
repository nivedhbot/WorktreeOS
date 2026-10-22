import { z } from 'zod';
import {
  codexModelSchema,
  dependencyIdsSchema,
  idSchema,
  repositorySchema,
  taskSchema,
} from './domain.js';
import { worktreeSchema } from './worktrees.js';

export const editDependenciesSchema = z.strictObject({
  dependencyIds: dependencyIdsSchema,
});
export const dependencySchema = z.object({
  taskId: idSchema,
  dependsOnId: idSchema,
});
export const readinessSchema = z.object({
  taskId: idSchema,
  mockBlockedBy: z.array(idSchema),
  codexBlockedBy: z.array(idSchema),
});
export const graphSchema = z.object({
  tasks: z.array(taskSchema),
  dependencies: z.array(dependencySchema),
  readiness: z.array(readinessSchema),
});
export const requestApprovalSchema = z.strictObject({
  worktreeId: idSchema,
  model: codexModelSchema,
});
export const approvalContextSchema = z.object({
  repository: repositorySchema,
  task: taskSchema,
  worktree: worktreeSchema,
  model: codexModelSchema,
  prerequisiteFingerprint: z.string(),
});
export const approvalSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  worktreeId: idSchema,
  model: codexModelSchema,
  status: z.enum(['pending', 'rejected', 'consumed', 'invalidated']),
  context: approvalContextSchema,
  fingerprint: z.string(),
  runId: idSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export const confirmApprovalSchema = z.strictObject({
  acknowledgeRisk: z.literal(true),
});
export type Approval = z.infer<typeof approvalSchema>;
export type Graph = z.infer<typeof graphSchema>;

// Kahn's algorithm avoids recursion limits on long dependency chains.
export function isDag(
  ids: readonly string[],
  dependencies: readonly { taskId: string; dependsOnId: string }[],
) {
  const degrees = new Map(ids.map((id) => [id, 0]));
  const dependents = new Map<string, string[]>();
  for (const edge of dependencies) {
    if (!degrees.has(edge.taskId) || !degrees.has(edge.dependsOnId))
      return false;
    degrees.set(edge.taskId, degrees.get(edge.taskId)! + 1);
    const list = dependents.get(edge.dependsOnId) ?? [];
    list.push(edge.taskId);
    dependents.set(edge.dependsOnId, list);
  }
  const ready = ids.filter((id) => degrees.get(id) === 0);
  let seen = 0;
  for (let index = 0; index < ready.length; index++) {
    seen++;
    for (const id of dependents.get(ready[index]!) ?? []) {
      const degree = degrees.get(id)! - 1;
      degrees.set(id, degree);
      if (degree === 0) ready.push(id);
    }
  }
  return seen === ids.length;
}
