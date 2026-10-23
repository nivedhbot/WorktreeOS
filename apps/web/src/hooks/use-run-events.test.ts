import { randomUUID } from 'node:crypto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRunEvents } from './use-run-events';
import { api as httpApi } from '@/lib/api';
import {
  exampleRepository,
  exampleRun,
  exampleTask,
  exampleTree,
  FakeEventSource,
  mockApi,
  statusEvent,
} from '@/test/api-fixture';

describe('SSE connection lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it('reconnects from the last verified event ID and closes subscriptions on unmount', async () => {
    const repo = exampleRepository();
    const task = exampleTask(repo.id);
    const tree = exampleTree(task);
    const run = exampleRun(task, tree);
    const api = mockApi({ runs: [run], events: [statusEvent(run, 1)] });
    FakeEventSource.instances = [];
    vi.stubGlobal('fetch', api.fetch);
    vi.stubGlobal('EventSource', FakeEventSource);
    const changed = vi.fn();
    const hook = renderHook(() => useRunEvents(run, changed));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const first = FakeEventSource.instances[0]!;
    const progress = {
      id: randomUUID(),
      runId: run.id,
      sequence: 2,
      type: 'mock.progress',
      payload: { mode: 'MOCK', percent: 20, message: 'MOCK: progress' },
      createdAt: run.createdAt,
    };
    act(() => first.emit(progress));
    act(() => first.emit(progress));
    act(() => first.emit(statusEvent(run, 1)));
    expect(hook.result.current.events).toHaveLength(2);
    expect(changed).not.toHaveBeenCalled();
    vi.useFakeTimers();
    act(() => first.onerror?.());
    expect(hook.result.current.status).toBe('reconnecting');
    expect(first.closed).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]!.url).toContain(`since=${progress.id}`);
    hook.unmount();
    expect(FakeEventSource.instances[1]!.closed).toBe(true);
  });
  it('rejects wrong-run events instead of displaying untrusted cross-task output', async () => {
    const task = exampleTask(exampleRepository().id);
    const tree = exampleTree(task);
    const run = exampleRun(task, tree);
    const api = mockApi({ runs: [run] });
    FakeEventSource.instances = [];
    vi.stubGlobal('fetch', api.fetch);
    vi.stubGlobal('EventSource', FakeEventSource);
    const changed = vi.fn();
    const { result } = renderHook(() => useRunEvents(run, changed));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() =>
      FakeEventSource.instances[0]!.emit({
        ...statusEvent(run, 1),
        runId: randomUUID(),
      }),
    );
    expect(result.current.status).toBe('error');
    expect(result.current.events).toEqual([]);
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });
  it('rejects an invalid status before adding it to the timeline or notifying the workspace', async () => {
    const task = exampleTask(exampleRepository().id);
    const run = exampleRun(task, exampleTree(task));
    vi.spyOn(httpApi, 'events').mockResolvedValue({ mode: 'MOCK', events: [] });
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    const changed = vi.fn();
    const { result } = renderHook(() => useRunEvents(run, changed));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() =>
      FakeEventSource.instances[0]!.emit({
        ...statusEvent(run, 1),
        payload: { mode: 'MOCK', status: 'fabricated-success' },
      }),
    );
    expect(result.current.status).toBe('error');
    expect(result.current.events).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });
  it('accepts matching CODEX history and structured live events and closes on terminal status', async () => {
    const task = exampleTask(exampleRepository().id);
    const tree = exampleTree(task);
    const run = {
      ...exampleRun(task, tree),
      provider: 'codex' as const,
      mode: 'CODEX' as const,
      model: 'gpt-6-luna' as const,
    };
    vi.spyOn(httpApi, 'events').mockResolvedValue({
      mode: 'CODEX',
      events: [],
    });
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    const changed = vi.fn();
    const { result } = renderHook(() => useRunEvents(run, changed));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const event = {
      ...statusEvent(run, 1),
      type: 'codex.thread',
      payload: { mode: 'CODEX', message: 'Real thread', threadId: 'sdk-id' },
    };
    act(() => FakeEventSource.instances[0]!.emit(event));
    expect(result.current.events).toEqual([event]);
    act(() =>
      FakeEventSource.instances[0]!.emit({
        ...statusEvent(run, 2),
        payload: {
          mode: 'CODEX',
          status: 'completed',
          message: 'Codex complete',
        },
      }),
    );
    expect(result.current.status).toBe('complete');
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
  });
  it('rejects wrong-mode persisted history before opening a live connection', async () => {
    const task = exampleTask(exampleRepository().id);
    const run = {
      ...exampleRun(task, exampleTree(task)),
      provider: 'codex' as const,
      mode: 'CODEX' as const,
    };
    vi.spyOn(httpApi, 'events').mockResolvedValue({ mode: 'MOCK', events: [] });
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    const { result } = renderHook(() => useRunEvents(run, vi.fn()));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.events).toEqual([]);
  });
});
