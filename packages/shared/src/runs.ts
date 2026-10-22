import { z } from 'zod';
import {
  idSchema,
  runStatusSchema,
  codexModelSchema,
  usageSchema,
} from './domain.js';

export const startRunSchema = z.union([
  z.strictObject({
    worktreeId: idSchema,
    provider: z.literal('mock').optional(),
  }),
  z.strictObject({
    worktreeId: idSchema,
    provider: z.literal('codex'),
    model: codexModelSchema,
    confirmation: z.strictObject({
      repositoryId: idSchema,
      worktreePath: z.string().min(1),
      model: codexModelSchema,
      acknowledgeRisk: z.literal(true),
    }),
  }),
]);
export type StartRun = z.infer<typeof startRunSchema>;
export const codexAvailabilitySchema = z.object({
  models: z.array(codexModelSchema),
  error: z.string().nullable(),
});
const common = {
  mode: z.literal('MOCK'),
  message: z.string().min(1).max(4000),
};
export const providerEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('codex.thread'),
    mode: z.literal('CODEX'),
    message: z.string(),
    threadId: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal('codex.item'),
    mode: z.literal('CODEX'),
    message: z.string(),
    item: z.json(),
  }),
  z.strictObject({
    type: z.literal('codex.usage'),
    mode: z.literal('CODEX'),
    message: z.string(),
    usage: usageSchema,
  }),
  z.strictObject({ ...common, type: z.literal('mock.message') }),
  z.strictObject({
    ...common,
    type: z.literal('mock.progress'),
    percent: z.number().int().min(0).max(100),
  }),
  z.strictObject({
    ...common,
    type: z.literal('mock.tool'),
    tool: z.literal('simulated-inspection'),
  }),
  z.strictObject({
    ...common,
    type: z.literal('mock.file'),
    path: z.string(),
    simulated: z.literal(true),
  }),
]);
export type ProviderEvent = z.infer<typeof providerEventSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export const activeRunStatuses: readonly RunStatus[] = [
  'queued',
  'preparing',
  'running',
];
export function isActiveRun(status: RunStatus) {
  return activeRunStatuses.includes(status);
}
const transitions: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['preparing', 'canceled', 'interrupted', 'failed'],
  preparing: ['running', 'failed', 'canceled', 'interrupted'],
  running: ['completed', 'failed', 'canceled', 'interrupted'],
  completed: [],
  failed: [],
  canceled: [],
  awaiting_approval: [],
  interrupted: [],
};
export function canTransitionRun(from: RunStatus, to: RunStatus) {
  return transitions[from].includes(to);
}
