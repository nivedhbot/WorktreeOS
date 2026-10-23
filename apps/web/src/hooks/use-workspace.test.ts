import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from './use-workspace';
import {
  exampleRepository,
  exampleRun,
  exampleTask,
  exampleTree,
  jsonResponse,
  mockApi,
  statusEvent,
} from '@/test/api-fixture';

describe('workspace refresh consistency', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('retains history and loaded data when accepting task and repository edits', async () => {
    const repo = exampleRepository();
    const task = exampleTask(repo.id);
    const run = exampleRun(task, exampleTree(task), 'completed');
    vi.stubGlobal(
      'fetch',
      mockApi({ repositories: [repo], tasks: [task], runs: [run] }).fetch,
    );
    const { result } = renderHook(useWorkspace);
    await waitFor(() =>
      expect(result.current.snapshot?.runs[task.id]).toHaveLength(1),
    );
    act(() => result.current.acceptTask({ ...task, title: 'Edited task' }));
    act(() => result.current.acceptRepository({ ...repo, name: 'Renamed' }));
    expect(result.current.snapshot?.tasks[0]?.title).toBe('Edited task');
    expect(result.current.snapshot?.runs[task.id]).toEqual([run]);
  });
  it('keeps terminal state and insertion order when delayed run responses arrive', async () => {
    const repo = exampleRepository();
    const task = exampleTask(repo.id);
    const first = {
      ...exampleRun(task, exampleTree(task), 'completed'),
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    };
    const second = {
      ...exampleRun(task, exampleTree(task), 'completed'),
      id: '00000000-0000-4000-8000-000000000000',
    };
    vi.stubGlobal(
      'fetch',
      mockApi({ repositories: [repo], tasks: [task], runs: [first] }).fetch,
    );
    const { result } = renderHook(useWorkspace);
    await waitFor(() =>
      expect(result.current.snapshot?.runs[task.id]).toHaveLength(1),
    );
    act(() => result.current.upsertRun(second));
    act(() => result.current.upsertRun({ ...first, status: 'queued' }));
    expect(result.current.snapshot?.runs[task.id]).toEqual([first, second]);
    act(() =>
      result.current.statusChanged(
        statusEvent({ ...first, status: 'running' }, 1),
      ),
    );
    expect(result.current.snapshot?.runs[task.id]?.[0]?.status).toBe(
      'completed',
    );
  });
  it('keeps the loaded snapshot when the already selected repository is selected again', async () => {
    const repo = exampleRepository();
    const task = exampleTask(repo.id);
    const api = mockApi({ repositories: [repo], tasks: [task] });
    vi.stubGlobal('fetch', api.fetch);
    const { result } = renderHook(useWorkspace);
    await waitFor(() => expect(result.current.snapshot?.tasks).toEqual([task]));
    const snapshot = result.current.snapshot;
    act(() => result.current.selectRepository(repo.id));
    expect(result.current.snapshot).toBe(snapshot);
    expect(result.current.snapshot?.tasks).toEqual([task]);
  });
  it('does not regress a terminal SSE status when an older REST snapshot arrives', async () => {
    const repo = exampleRepository();
    const task = exampleTask(repo.id);
    const tree = exampleTree(task);
    const run = exampleRun(task, tree);
    const api = mockApi({
      repositories: [repo],
      tasks: [task],
      trees: [tree],
      runs: [run],
    });
    vi.stubGlobal('fetch', api.fetch);
    const { result } = renderHook(useWorkspace);
    await waitFor(() =>
      expect(result.current.snapshot?.runs[task.id]?.[0]?.status).toBe(
        'running',
      ),
    );
    const final = statusEvent({ ...run, status: 'completed' }, 9);
    act(() => result.current.statusChanged(final));
    expect(result.current.snapshot?.runs[task.id]?.[0]?.status).toBe(
      'completed',
    );
    await waitFor(() =>
      expect(
        api.fetch.mock.calls.filter(([url]) => String(url).endsWith('/runs')),
      ).toHaveLength(2),
    );
    expect(result.current.snapshot?.runs[task.id]?.[0]?.status).toBe(
      'completed',
    );
  });
  it('preserves task-load errors when a repository-list refresh succeeds and recovers on retry', async () => {
    const repo = exampleRepository();
    const api = mockApi({ repositories: [repo] });
    api.intercepts.set('GET /api/tasks', () =>
      jsonResponse(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Task storage unavailable',
          },
        },
        500,
      ),
    );
    vi.stubGlobal('fetch', api.fetch);
    const { result } = renderHook(useWorkspace);
    await waitFor(() =>
      expect(result.current.error).toBe('Task storage unavailable'),
    );
    act(() => result.current.reload());
    await waitFor(() =>
      expect(
        api.fetch.mock.calls.filter(([url]) => String(url) === '/api/repos'),
      ).toHaveLength(2),
    );
    expect(result.current.error).toBe('Task storage unavailable');
    api.intercepts.delete('GET /api/tasks');
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.snapshot?.tasks).toEqual([]));
    expect(result.current.error).toBeNull();
  });
});
