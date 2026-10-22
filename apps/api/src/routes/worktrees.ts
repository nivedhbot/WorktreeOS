import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createWorktreeSchema,
  idSchema,
  removeWorktreeSchema,
} from '@worktreeos/shared';
import { GitService } from '../git/service.js';

const params = z.strictObject({ id: idSchema });
export function registerWorktreeRoutes(app: FastifyInstance, git: GitService) {
  app.get('/api/worktrees', async (request) => {
    const query = z
      .strictObject({ repositoryId: idSchema.optional() })
      .parse(request.query);
    return { worktrees: git.list(query.repositoryId) };
  });
  app.post('/api/worktrees', async (request, reply) => {
    const tree = await git.create(createWorktreeSchema.parse(request.body));
    return reply
      .code(201)
      .header('Location', `/api/worktrees/${tree.id}`)
      .send(tree);
  });
  app.get('/api/worktrees/:id', async (request) =>
    git.validate(params.parse(request.params).id),
  );
  app.get('/api/worktrees/:id/status', async (request) =>
    git.status(params.parse(request.params).id),
  );
  app.get('/api/worktrees/:id/files', async (request) => ({
    files: await git.files(params.parse(request.params).id),
  }));
  app.get('/api/worktrees/:id/diff', async (request) =>
    git.diff(params.parse(request.params).id),
  );
  app.delete('/api/worktrees/:id', async (request) => {
    const { confirm } = removeWorktreeSchema.parse(request.body);
    return git.remove(params.parse(request.params).id, confirm);
  });
}
