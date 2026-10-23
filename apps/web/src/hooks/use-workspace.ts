import { useCallback, useEffect, useState } from 'react';
import {
  isActiveRun,
  runStatusSchema,
  type Repository,
  type Run,
  type RunEvent,
  type Task,
  type Worktree,
} from '@worktreeos/shared';
import { api, errorMessage } from '@/lib/api';

export interface Snapshot {
  repositoryId: string;
  tasks: Task[];
  worktrees: Worktree[];
  runs: Record<string, Run[]>;
}
export function useWorkspace() {
  const [repositories, setRepositories] = useState<Repository[] | null>(null);
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const selectRepository = useCallback(
    (id: string) => {
      if (id === repositoryId) return;
      setRepositoryId(id);
      setSnapshot(null);
      setSnapshotError(null);
    },
    [repositoryId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void api
      .repositories(controller.signal)
      .then(({ repositories: records }) => {
        if (controller.signal.aborted) return;
        setRepositories(records);
        setRepositoryId((current) =>
          records.some((record) => record.id === current)
            ? current
            : (records[0]?.id ?? null),
        );
        setRepositoryError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setRepositoryError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!repositoryId) return;
    const controller = new AbortController();
    void Promise.all([
      api.tasks(repositoryId, controller.signal),
      api.worktrees(repositoryId, controller.signal),
    ])
      .then(async ([taskData, treeData]) => {
        const histories = await Promise.all(
          taskData.tasks.map(
            async (task) =>
              [
                task.id,
                (await api.runs(task.id, controller.signal)).runs,
              ] as const,
          ),
        );
        if (!controller.signal.aborted) {
          setSnapshot((current) => {
            const terminal = new Map(
              Object.values(current?.runs ?? {})
                .flat()
                .filter((run) => !isActiveRun(run.status))
                .map((run) => [run.id, run]),
            );
            // A request begun before a terminal SSE event must never regress that immutable run to active.
            const runs = Object.fromEntries(
              histories.map(([taskId, records]) => [
                taskId,
                records.map((run) =>
                  isActiveRun(run.status) ? (terminal.get(run.id) ?? run) : run,
                ),
              ]),
            );
            return {
              repositoryId,
              tasks: taskData.tasks,
              worktrees: treeData.worktrees,
              runs,
            };
          });
          setSnapshotError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setSnapshotError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [repositoryId, revision]);

  useEffect(() => {
    const timer = window.setInterval(reload, 10000);
    return () => window.clearInterval(timer);
  }, [reload]);
  const upsertRun = useCallback((run: Run) => {
    setSnapshot((current) => {
      if (!current?.tasks.some((task) => task.id === run.taskId))
        return current;
      const records = current.runs[run.taskId] ?? [];
      const existing = records.find((record) => record.id === run.id);
      const accepted =
        existing && !isActiveRun(existing.status) && isActiveRun(run.status)
          ? existing
          : run;
      const updated = existing
        ? records.map((record) => (record.id === run.id ? accepted : record))
        : [...records, accepted];
      return {
        ...current,
        runs: {
          ...current.runs,
          [run.taskId]: updated.sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
          ),
        },
      };
    });
  }, []);
  const statusChanged = useCallback(
    (event?: RunEvent) => {
      const status =
        event?.type === 'run.status'
          ? runStatusSchema.safeParse(event.payload.status)
          : null;
      if (event && status?.success) {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                runs: Object.fromEntries(
                  Object.entries(current.runs).map(([taskId, records]) => [
                    taskId,
                    records.map((run) =>
                      run.id === event.runId && isActiveRun(run.status)
                        ? { ...run, status: status.data }
                        : run,
                    ),
                  ]),
                ),
              }
            : current,
        );
      }
      if (!event || (status?.success && !isActiveRun(status.data))) reload();
    },
    [reload],
  );
  const acceptRepository = useCallback((record: Repository) => {
    setRepositories((current) => [
      ...(current ?? []).filter((item) => item.id !== record.id),
      record,
    ]);
    setRepositoryId(record.id);
    setSnapshot((current) =>
      current?.repositoryId === record.id ? current : null,
    );
    setRepositoryError(null);
    setSnapshotError(null);
  }, []);
  const acceptTask = useCallback(
    (record: Task) =>
      setSnapshot((current) =>
        current?.repositoryId === record.repositoryId
          ? {
              ...current,
              tasks: [
                ...current.tasks.filter((task) => task.id !== record.id),
                record,
              ],
              runs: {
                ...current.runs,
                [record.id]: current.runs[record.id] ?? [],
              },
            }
          : current,
      ),
    [],
  );
  const acceptWorktree = useCallback(
    (record: Worktree) =>
      setSnapshot((current) =>
        current?.repositoryId === record.repositoryId
          ? {
              ...current,
              worktrees: [
                ...current.worktrees.filter((tree) => tree.id !== record.id),
                record,
              ],
            }
          : current,
      ),
    [],
  );
  const removeWorktree = useCallback(
    (id: string) =>
      setSnapshot((current) =>
        current
          ? {
              ...current,
              worktrees: current.worktrees.filter((tree) => tree.id !== id),
            }
          : current,
      ),
    [],
  );
  return {
    repositories,
    repositoryId,
    snapshot: snapshot?.repositoryId === repositoryId ? snapshot : null,
    error: repositoryError ?? snapshotError,
    reload,
    statusChanged,
    selectRepository,
    upsertRun,
    acceptRepository,
    acceptTask,
    acceptWorktree,
    removeWorktree,
  };
}
