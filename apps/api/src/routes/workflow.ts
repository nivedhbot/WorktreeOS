import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  confirmApprovalSchema,
  editDependenciesSchema,
  idSchema,
  requestApprovalSchema,
} from '@worktreeos/shared';
import type { Store } from '../storage/store.js';
import type { RunManager } from '../runs/manager.js';
import { AppError } from '../errors.js';

const params = z.strictObject({ id: idSchema });
export function registerWorkflowRoutes(
  app: FastifyInstance,
  store: Store,
  manager: RunManager,
) {
  app.get('/api/graph', async (request) => {
    z.strictObject({}).parse(request.query);
    return store.workflow.graph();
  });
  app.patch('/api/tasks/:id/dependencies', async (request) => {
    const { id } = params.parse(request.params);
    const { dependencyIds } = editDependenciesSchema.parse(request.body);
    return store.workflow.editDependencies(id, dependencyIds);
  });
  app.get('/api/tasks/:id/dependencies', async (request) => {
    const { id } = params.parse(request.params);
    if (!store.getTask(id))
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    return { taskId: id, dependencyIds: store.workflow.dependencyIds(id) };
  });
  app.get('/api/approvals', async () => ({
    approvals: store.workflow.listApprovals(),
  }));
  app.post('/api/tasks/:id/approvals', async (request, reply) => {
    const { id } = params.parse(request.params);
    const input = requestApprovalSchema.parse(request.body);
    const approval = await manager.requestApproval(
      id,
      input.worktreeId,
      input.model,
    );
    return reply
      .code(201)
      .header('Location', `/api/approvals/${approval.id}`)
      .send(approval);
  });
  app.get('/api/approvals/:id', async (request) =>
    store.workflow.getApproval(params.parse(request.params).id),
  );
  app.post('/api/approvals/:id/confirm', async (request, reply) => {
    confirmApprovalSchema.parse(request.body);
    const run = await manager.confirmApproval(params.parse(request.params).id);
    return reply.code(202).header('Location', `/api/runs/${run.id}`).send(run);
  });
  app.post('/api/approvals/:id/reject', async (request) => {
    z.strictObject({}).parse(request.body ?? {});
    return store.workflow.rejectApproval(params.parse(request.params).id);
  });
}
