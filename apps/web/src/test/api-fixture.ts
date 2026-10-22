import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type {
  Repository,
  Run,
  RunEvent,
  Task,
  Worktree,
} from '@worktreeos/shared';

const now = '2026-10-22T12:00:00.000Z';
export const exampleRepository = (): Repository => ({
  id: randomUUID(),
  name: 'Example repository',
  path: 'C:\\Projects\\example',
  createdAt: now,
  updatedAt: now,
});
export const exampleTask = (
  repositoryId: string,
  title = 'Review a small feature',
): Task => ({
  id: randomUUID(),
  repositoryId,
  title,
  objective: 'Inspect the changes and keep the original checkout intact.',
  provider: 'mock',
  createdAt: now,
  updatedAt: now,
});
export const exampleTree = (task: Task): Worktree => ({
  id: randomUUID(),
  repositoryId: task.repositoryId,
  taskId: task.id,
  branch: 'worktreeos/feature',
  path: 'C:\\Users\\developer\\.worktreeos\\worktrees\\test',
  createdAt: now,
  removedAt: null,
});
export const exampleRun = (
  task: Task,
  tree: Worktree,
  status: Run['status'] = 'running',
): Run => ({
  id: randomUUID(),
  taskId: task.id,
  provider: 'mock',
  mode: 'MOCK',
  worktreeId: tree.id,
  retryOf: null,
  status,
  createdAt: now,
  updatedAt: now,
});
export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
export function statusEvent(run: Run, sequence: number): RunEvent {
  return {
    id: randomUUID(),
    runId: run.id,
    sequence,
    type: 'run.status',
    payload: {
      mode: 'MOCK',
      status: run.status,
      message: `MOCK run ${run.status}`,
    },
    createdAt: now,
  };
}

export function mockApi(
  initial: {
    repositories?: Repository[];
    tasks?: Task[];
    trees?: Worktree[];
    runs?: Run[];
    events?: RunEvent[];
  } = {},
) {
  const state = {
    repositories: initial.repositories ?? [],
    tasks: initial.tasks ?? [],
    trees: initial.trees ?? [],
    runs: initial.runs ?? [],
    events: initial.events ?? [],
  };
  const intercepts = new Map<
    string,
    (options: RequestInit | undefined) => Response | Promise<Response>
  >();
  const fetch = vi.fn(
    async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const method = options?.method ?? 'GET';
      const intercept = intercepts.get(`${method} ${url.pathname}`);
      if (intercept) return intercept(options);
      const body =
        typeof options?.body === 'string'
          ? (JSON.parse(options.body) as Record<string, string>)
          : {};
      if (url.pathname === '/api/health')
        return jsonResponse({
          status: 'ok',
          service: 'worktreeos-api',
          version: '0.1.0',
          timestamp: now,
        });
      if (url.pathname === '/api/repos') {
        if (method === 'POST') {
          const repo: Repository = {
            id: randomUUID(),
            name: body.name!,
            path: body.path!,
            createdAt: now,
            updatedAt: now,
          };
          state.repositories.push(repo);
          return jsonResponse(repo, 201);
        }
        return jsonResponse({ repositories: state.repositories });
      }
      if (url.pathname === '/api/tasks') {
        if (method === 'POST') {
          const task = {
            ...exampleTask(body.repositoryId!, body.title),
            objective: body.objective!,
          };
          state.tasks.push(task);
          return jsonResponse(task, 201);
        }
        return jsonResponse({
          tasks: state.tasks.filter(
            (task) =>
              task.repositoryId === url.searchParams.get('repositoryId'),
          ),
        });
      }
      if (url.pathname === '/api/worktrees') {
        if (method === 'POST') {
          const task = state.tasks.find((item) => item.id === body.taskId)!;
          const tree = exampleTree(task);
          state.trees.push(tree);
          return jsonResponse(tree, 201);
        }
        return jsonResponse({
          worktrees: state.trees.filter(
            (tree) =>
              tree.repositoryId === url.searchParams.get('repositoryId'),
          ),
        });
      }
      const taskRuns = /^\/api\/tasks\/([^/]+)\/runs$/.exec(url.pathname);
      if (taskRuns) {
        if (method === 'POST') {
          const task = state.tasks.find((item) => item.id === taskRuns[1])!;
          const tree = state.trees.find((item) => item.id === body.worktreeId)!;
          const run = exampleRun(task, tree, 'queued');
          state.runs.push(run);
          state.events.push(statusEvent(run, 1));
          return jsonResponse(run, 202);
        }
        return jsonResponse({
          runs: state.runs.filter((run) => run.taskId === taskRuns[1]),
        });
      }
      const runAction = /^\/api\/runs\/([^/]+)\/(events|cancel|retry)$/.exec(
        url.pathname,
      );
      if (runAction) {
        const run = state.runs.find((item) => item.id === runAction[1])!;
        if (runAction[2] === 'events')
          return jsonResponse({
            mode: 'MOCK',
            events: state.events.filter((event) => event.runId === run.id),
          });
        if (runAction[2] === 'cancel') {
          run.status = 'canceled';
          state.events.push(
            statusEvent(
              run,
              state.events.filter((event) => event.runId === run.id).length + 1,
            ),
          );
          return jsonResponse(run);
        }
        const task = state.tasks.find((item) => item.id === run.taskId)!;
        const tree = state.trees.find((item) => item.id === run.worktreeId)!;
        const next = { ...exampleRun(task, tree, 'queued'), retryOf: run.id };
        state.runs.push(next);
        state.events.push(statusEvent(next, 1));
        return jsonResponse(next, 202);
      }
      const treeAction = /^\/api\/worktrees\/([^/]+)(?:\/(status|diff))?$/.exec(
        url.pathname,
      );
      if (treeAction) {
        if (method === 'DELETE') {
          state.trees = state.trees.filter((tree) => tree.id !== treeAction[1]);
          return jsonResponse({ removed: true, branchRetained: true });
        }
        if (treeAction[2] === 'status')
          return jsonResponse({
            worktreeId: treeAction[1],
            clean: true,
            files: [],
          });
        if (treeAction[2] === 'diff')
          return jsonResponse({
            worktreeId: treeAction[1],
            diff: '',
            untrackedFiles: [],
          });
      }
      throw new Error(`Unmocked request: ${method} ${url.pathname}`);
    },
  );
  return { state, fetch, intercepts };
}

export class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(event: RunEvent) {
    this.dispatchEvent(
      new MessageEvent('run-event', { data: JSON.stringify(event) }),
    );
  }
}
