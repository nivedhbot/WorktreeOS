import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  idSchema,
  isActiveRun,
  startRunSchema,
  type RunEvent,
} from '@worktreeos/shared';
import { RunManager } from '../runs/manager.js';
import { Store } from '../storage/store.js';
import { AppError } from '../errors.js';

const params = z.strictObject({ id: idSchema });
const cursorQuery = z.strictObject({ since: idSchema.optional() });
const empty = z.strictObject({});

export function registerRunRoutes(
  app: FastifyInstance,
  manager: RunManager,
  store: Store,
  heartbeatMs = 15000,
) {
  app.get('/api/providers/codex', async () => manager.availability());
  const clients = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const close of clients) close();
    await manager.shutdown();
  });
  app.get('/api/tasks/:id/runs', async (request) => {
    const { id } = params.parse(request.params);
    if (!store.getTask(id))
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    return { runs: store.listRuns(id) };
  });
  app.post('/api/tasks/:id/runs', async (request, reply) => {
    const { id } = params.parse(request.params);
    const input = startRunSchema.parse(request.body);
    const run = await manager.start(id, input.worktreeId, null, input);
    return reply.code(202).header('Location', `/api/runs/${run.id}`).send(run);
  });
  app.get('/api/runs/:id', async (request) =>
    manager.get(params.parse(request.params).id),
  );
  app.post('/api/runs/:id/cancel', async (request) => {
    empty.parse(request.body ?? {});
    return manager.cancel(params.parse(request.params).id);
  });
  app.post('/api/runs/:id/retry', async (request, reply) => {
    empty.parse(request.body ?? {});
    const run = await manager.retry(params.parse(request.params).id);
    return reply.code(202).header('Location', `/api/runs/${run.id}`).send(run);
  });
  app.get('/api/runs/:id/events', async (request) => {
    const { id } = params.parse(request.params);
    const { since } = cursorQuery.parse(request.query);
    return {
      mode: manager.get(id).mode,
      events: manager.eventsSince(id, since),
    };
  });
  app.get('/api/runs/:id/stream', async (request, reply) => {
    const { id } = params.parse(request.params);
    const query = cursorQuery.parse(request.query);
    const header = request.headers['last-event-id'];
    // Native EventSource reconnects retain the initial URL but advance this
    // header. Prefer its latest cursor over the original query cursor.
    const since = header === undefined ? query.since : idSchema.parse(header);
    const replay = manager.eventsSince(id, since);
    if (clients.size >= 32)
      throw new AppError(
        503,
        'STREAM_CAPACITY',
        'Too many event streams; close an existing stream and retry',
      );
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders();
    let closed = false;
    const resources: {
      heartbeat?: ReturnType<typeof setInterval>;
      unsubscribe?: () => void;
    } = {};
    const close = () => {
      if (closed) return;
      closed = true;
      if (resources.heartbeat) clearInterval(resources.heartbeat);
      resources.unsubscribe?.();
      clients.delete(close);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    };
    const write = (frame: string) => {
      if (closed || reply.raw.destroyed) return;
      if (reply.raw.writableLength > 1024 * 1024) {
        close();
        return;
      }
      reply.raw.write(frame);
    };
    const send = (event: RunEvent) => {
      write(
        `id: ${event.id}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`,
      );
      if (event.type === 'run.status' && !isActiveRun(manager.get(id).status))
        close();
    };
    clients.add(close);
    reply.raw.on('close', close);
    write(`retry: 1500\n: ${manager.get(id).mode} event stream\n\n`);
    // No await between replay and subscription: persisted events are delivered once in sequence.
    for (const event of replay)
      write(
        `id: ${event.id}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`,
      );
    if (closed) return;
    if (!isActiveRun(manager.get(id).status)) {
      close();
      return;
    }
    resources.unsubscribe = manager.subscribe(id, send);
    resources.heartbeat = setInterval(
      () => write(`: heartbeat ${manager.get(id).mode}\n\n`),
      heartbeatMs,
    );
    resources.heartbeat.unref();
  });
}
