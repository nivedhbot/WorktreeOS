import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createRepositorySchema,
  editRepositorySchema,
  createTaskSchema,
  editTaskSchema,
  idSchema,
} from '@worktreeos/shared';
import { Store } from '../storage/store.js';
import { AppError } from '../errors.js';
import { validateRepositoryPath } from '../repositories/validate-path.js';

const paramsSchema = z.strictObject({ id: idSchema });
const taskQuerySchema = z.strictObject({ repositoryId: idSchema.optional() });
const emptyQuerySchema = z.strictObject({});

export function registerResourceRoutes(app: FastifyInstance, store: Store) {
  app.get('/api/repos', async (request) => {
    emptyQuerySchema.parse(request.query);
    return { repositories: store.listRepositories() };
  });
  app.post('/api/repos', async (request, reply) => {
    const input = createRepositorySchema.parse(request.body);
    const path = await validateRepositoryPath(input.path);
    const repository = store.createRepository({ ...input, path });
    return reply
      .code(201)
      .header('Location', `/api/repos/${repository.id}`)
      .send(repository);
  });
  app.get('/api/repos/:id', async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const repository = store.getRepository(id);
    if (!repository)
      throw new AppError(404, 'REPOSITORY_NOT_FOUND', 'Repository not found');
    return repository;
  });
  app.patch('/api/repos/:id', async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return store.editRepository(id, editRepositorySchema.parse(request.body));
  });

  app.get('/api/tasks', async (request) => {
    const { repositoryId } = taskQuerySchema.parse(request.query);
    if (repositoryId && !store.getRepository(repositoryId))
      throw new AppError(404, 'REPOSITORY_NOT_FOUND', 'Repository not found');
    return { tasks: store.listTasks(repositoryId) };
  });
  app.post('/api/tasks', async (request, reply) => {
    const task = store.createTask(createTaskSchema.parse(request.body));
    return reply
      .code(201)
      .header('Location', `/api/tasks/${task.id}`)
      .send(task);
  });
  app.get('/api/tasks/:id', async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const task = store.getTask(id);
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    return task;
  });
  app.patch('/api/tasks/:id', async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return store.editTask(id, editTaskSchema.parse(request.body));
  });
}
