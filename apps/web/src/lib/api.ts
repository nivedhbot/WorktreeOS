import { healthResponseSchema } from '@worktreeos/shared';
import { z } from 'zod';
import {
  apiErrorSchema,
  repositorySchema,
  taskSchema,
  worktreeSchema,
  runSchema,
  eventSchema,
  changedFileSchema,
  type CreateRepository,
  type CreateTask,
  type EditTask,
  type EditRepository,
  codexAvailabilitySchema,
  type StartRun,
  approvalSchema,
  graphSchema,
  type Approval,
} from '@worktreeos/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof z.ZodError)
    return 'The API returned an unexpected response. Refresh and check that the frontend and backend versions match.';
  return 'Could not reach the local API. Check the connection and try again.';
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    cache: 'no-store',
    signal: options.signal ?? null,
    ...(options.body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options.body),
        }),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new ApiError(
      parsed.success
        ? [
            parsed.data.error.message,
            ...(parsed.data.error.issues ?? []).map(
              (issue) => `${issue.path || 'Request'}: ${issue.message}`,
            ),
          ].join(' · ')
        : `Request failed (HTTP ${response.status})`,
      parsed.success ? parsed.data.error.code : 'HTTP_ERROR',
      response.status,
    );
  }
  return schema.parse(body);
}

export const worktreeStatusSchema = z.object({
  worktreeId: z.uuid(),
  clean: z.boolean(),
  files: z.array(changedFileSchema),
});
export const worktreeDiffSchema = z.object({
  worktreeId: z.uuid(),
  diff: z.string(),
  untrackedFiles: z.array(z.string()),
});
export const api = {
  graph: (signal?: AbortSignal) =>
    request('/graph', graphSchema, { ...(signal ? { signal } : {}) }),
  approvals: (signal?: AbortSignal) =>
    request('/approvals', z.object({ approvals: z.array(approvalSchema) }), {
      ...(signal ? { signal } : {}),
    }),
  editDependencies: (taskId: string, dependencyIds: string[]) =>
    request(
      `/tasks/${encodeURIComponent(taskId)}/dependencies`,
      z.object({ taskId: z.uuid(), dependencyIds: z.array(z.uuid()) }),
      { method: 'PATCH', body: { dependencyIds } },
    ),
  requestApproval: (
    taskId: string,
    worktreeId: string,
    model: Approval['model'],
  ) =>
    request(`/tasks/${encodeURIComponent(taskId)}/approvals`, approvalSchema, {
      method: 'POST',
      body: { worktreeId, model },
    }),
  confirmApproval: (id: string) =>
    request(`/approvals/${encodeURIComponent(id)}/confirm`, runSchema, {
      method: 'POST',
      body: { acknowledgeRisk: true },
    }),
  rejectApproval: (id: string) =>
    request(`/approvals/${encodeURIComponent(id)}/reject`, approvalSchema, {
      method: 'POST',
      body: {},
    }),
  codexAvailability: (signal?: AbortSignal) =>
    request('/providers/codex', codexAvailabilitySchema, {
      ...(signal ? { signal } : {}),
    }),
  startCodexRun: (taskId: string, input: StartRun) =>
    request(`/tasks/${encodeURIComponent(taskId)}/runs`, runSchema, {
      method: 'POST',
      body: input,
    }),
  repositories: (signal?: AbortSignal) =>
    request('/repos', z.object({ repositories: z.array(repositorySchema) }), {
      ...(signal ? { signal } : {}),
    }),
  registerRepository: (input: CreateRepository) =>
    request('/repos', repositorySchema, { method: 'POST', body: input }),
  editRepository: (id: string, input: EditRepository) =>
    request(`/repos/${encodeURIComponent(id)}`, repositorySchema, {
      method: 'PATCH',
      body: input,
    }),
  tasks: (repositoryId: string, signal?: AbortSignal) =>
    request(
      `/tasks?repositoryId=${encodeURIComponent(repositoryId)}`,
      z.object({ tasks: z.array(taskSchema) }),
      { ...(signal ? { signal } : {}) },
    ),
  createTask: (input: CreateTask) =>
    request('/tasks', taskSchema, { method: 'POST', body: input }),
  editTask: (id: string, input: EditTask) =>
    request(`/tasks/${encodeURIComponent(id)}`, taskSchema, {
      method: 'PATCH',
      body: input,
    }),
  worktrees: (repositoryId: string, signal?: AbortSignal) =>
    request(
      `/worktrees?repositoryId=${encodeURIComponent(repositoryId)}`,
      z.object({ worktrees: z.array(worktreeSchema) }),
      { ...(signal ? { signal } : {}) },
    ),
  createWorktree: (taskId: string) =>
    request('/worktrees', worktreeSchema, { method: 'POST', body: { taskId } }),
  removeWorktree: (id: string) =>
    request(
      `/worktrees/${encodeURIComponent(id)}`,
      z.object({ removed: z.literal(true), branchRetained: z.literal(true) }),
      { method: 'DELETE', body: { confirm: true } },
    ),
  runs: (taskId: string, signal?: AbortSignal) =>
    request(
      `/tasks/${encodeURIComponent(taskId)}/runs`,
      z.object({ runs: z.array(runSchema) }),
      { ...(signal ? { signal } : {}) },
    ),
  startRun: (taskId: string, worktreeId: string) =>
    request(`/tasks/${encodeURIComponent(taskId)}/runs`, runSchema, {
      method: 'POST',
      body: { worktreeId },
    }),
  cancelRun: (id: string) =>
    request(`/runs/${encodeURIComponent(id)}/cancel`, runSchema, {
      method: 'POST',
      body: {},
    }),
  retryRun: (id: string) =>
    request(`/runs/${encodeURIComponent(id)}/retry`, runSchema, {
      method: 'POST',
      body: {},
    }),
  events: (id: string, signal?: AbortSignal) =>
    request(
      `/runs/${encodeURIComponent(id)}/events`,
      z.object({
        mode: z.enum(['MOCK', 'CODEX']),
        events: z.array(eventSchema),
      }),
      { ...(signal ? { signal } : {}) },
    ),
  status: (id: string, signal?: AbortSignal) =>
    request(
      `/worktrees/${encodeURIComponent(id)}/status`,
      worktreeStatusSchema,
      { ...(signal ? { signal } : {}) },
    ),
  diff: (id: string, signal?: AbortSignal) =>
    request(`/worktrees/${encodeURIComponent(id)}/diff`, worktreeDiffSchema, {
      ...(signal ? { signal } : {}),
    }),
};

export async function fetchHealth(signal?: AbortSignal) {
  const response = await fetch('/api/health', {
    signal: signal ?? null,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
  return healthResponseSchema.parse(await response.json());
}
