import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { healthResponseSchema } from '@worktreeos/shared';
import { z } from 'zod';
import { Store } from './storage/store.js';
import { AppError } from './errors.js';
import { registerResourceRoutes } from './routes/resources.js';
import { GitService } from './git/service.js';
import { registerWorktreeRoutes } from './routes/worktrees.js';
import { MockProvider } from './agents/mock-provider.js';
import type { AgentProvider } from './agents/provider.js';
import { RunManager } from './runs/manager.js';
import { registerRunRoutes } from './routes/runs.js';
import type { AvailabilityCheck } from './agents/codex-availability.js';
import type { SchedulerOptions } from './runs/config.js';
import { claimScheduler } from './runs/ownership.js';
import { registerWorkflowRoutes } from './routes/workflow.js';
import { redactText, registerLocalSecurity } from './security.js';
import { assertAgentHost } from './agents/codex-policy.js';

export function buildApp(
  options: FastifyServerOptions = {},
  storage: {
    dataDir?: string;
    worktreeDir?: string;
    provider?: AgentProvider;
    heartbeatMs?: number;
    codexProvider?: AgentProvider;
    codexAvailability?: AvailabilityCheck;
    scheduler?: SchedulerOptions;
  } = {},
) {
  assertAgentHost();
  const app = Fastify({
    ...options,
    logController: new LogController({ disableRequestLogging: true }),
  });
  registerLocalSecurity(app);
  const dataDir =
    storage.dataDir ??
    process.env.WORKTREEOS_DATA_DIR ??
    join(homedir(), '.worktreeos');
  if (!isAbsolute(dataDir))
    throw new Error('WORKTREEOS_DATA_DIR must be an absolute directory path');
  mkdirSync(dataDir, { recursive: true });
  const release = claimScheduler(dataDir);
  let store: Store | undefined;
  let git: GitService;
  let manager: RunManager;
  try {
    store = new Store(dataDir);
    git = new GitService(store, storage.worktreeDir);
    manager = new RunManager(
      store,
      git,
      storage.provider ?? new MockProvider(),
      storage.codexProvider,
      storage.codexAvailability,
      storage.scheduler,
    );
  } catch (error) {
    release();
    store?.close();
    throw error;
  }
  app.addHook('onClose', async () => {
    store!.close();
    release();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: redactText(error.message) },
      });
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid request encoding, size, or content type',
        },
      });
    }
    request.log.error(
      {
        event: 'request.failure',
        code: 'INTERNAL_ERROR',
        route: request.routeOptions.url ?? 'unmatched',
      },
      'Local API request failed',
    );
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected server error occurred',
      },
    });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({
      error: { code: 'ROUTE_NOT_FOUND', message: 'API route not found' },
    }),
  );
  registerResourceRoutes(app, store);
  registerWorktreeRoutes(app, git);
  registerRunRoutes(app, manager, store, storage.heartbeatMs);
  registerWorkflowRoutes(app, store, manager);

  app.get('/api/health', async () => {
    store.checkHealth();
    return healthResponseSchema.parse({
      status: 'ok',
      service: 'worktreeos-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
