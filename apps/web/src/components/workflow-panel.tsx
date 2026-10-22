import { useEffect, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type Approval, type Graph } from '@worktreeos/shared';
import { api, errorMessage } from '@/lib/api';
import { Button } from './ui/button';
import { ErrorNotice, Loading } from './ui/feedback';

export function WorkflowPanel({
  repositoryId,
  revision,
  readOnly,
  changed,
  selectTask,
  review,
}: {
  repositoryId: string;
  revision: string;
  readOnly: boolean;
  changed: () => void;
  selectTask: (id: string, repositoryId: string) => void;
  review: (approval: Approval) => void;
}) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [taskId, setTaskId] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.graph(controller.signal),
      api.approvals(controller.signal),
    ])
      .then(([data, queue]) => {
        if (!controller.signal.aborted) {
          setGraph(data);
          setApprovals(queue.approvals);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [repositoryId, revision, version]);
  async function mutate(operation: () => Promise<unknown>) {
    if (busy || readOnly) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
      setVersion((value) => value + 1);
      changed();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  if (!graph)
    return error ? (
      <ErrorNotice message={error} retry={() => setVersion((v) => v + 1)} />
    ) : (
      <Loading label="Loading dependencies and approvals…" />
    );
  const local = graph.tasks.filter(
    (task) => task.repositoryId === repositoryId,
  );
  const selectedId = local.some((task) => task.id === taskId)
    ? taskId
    : (local[0]?.id ?? '');
  const parents = graph.dependencies
    .filter((edge) => edge.taskId === selectedId)
    .map((edge) => edge.dependsOnId);
  const relevant = new Set(local.map((task) => task.id));
  for (const id of relevant)
    for (const edge of graph.dependencies)
      if (edge.taskId === id) relevant.add(edge.dependsOnId);
  const tasks = graph.tasks.filter((task) => relevant.has(task.id));
  const ranks = new Map<string, number>();
  for (let index = 0; index < tasks.length; index++)
    for (const task of tasks) {
      const dependencies = graph.dependencies
        .filter((edge) => edge.taskId === task.id)
        .map((edge) => edge.dependsOnId);
      if (dependencies.every((id) => ranks.has(id)))
        ranks.set(
          task.id,
          dependencies.length
            ? Math.max(...dependencies.map((id) => ranks.get(id)!)) + 1
            : 0,
        );
    }
  const lanes = new Map<number, number>();
  const readiness = (id: string) =>
    graph.readiness.find((item) => item.taskId === id);
  const nodes: Node[] = tasks.map((task) => {
    const rank = ranks.get(task.id) ?? 0;
    const row = lanes.get(rank) ?? 0;
    lanes.set(rank, row + 1);
    const status = readiness(task.id);
    const blocked = !!status?.mockBlockedBy.length;
    return {
      id: task.id,
      // Fixed, read-only summaries retain dimensions when a refreshed graph replaces node objects.
      initialWidth: 230,
      initialHeight: 90,
      style: { width: 230, height: 90 },
      position: { x: rank * 290, y: row * 125 },
      data: {
        label: (
          <>
            <strong>{task.title}</strong>
            <span>
              MOCK {blocked ? 'blocked' : 'runnable'} · CODEX{' '}
              {status?.codexBlockedBy.length ? 'blocked' : 'approval required'}
            </span>
          </>
        ),
      },
      ariaLabel: `${task.title}, MOCK ${blocked ? 'blocked' : 'runnable'}`,
      className: blocked
        ? 'dependency-node blocked'
        : 'dependency-node runnable',
    };
  });
  const edges: Edge[] = graph.dependencies
    .filter(
      (edge) => relevant.has(edge.taskId) && relevant.has(edge.dependsOnId),
    )
    .map((edge) => ({
      id: `${edge.dependsOnId}:${edge.taskId}`,
      source: edge.dependsOnId,
      target: edge.taskId,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#8daa70', strokeWidth: 1.5 },
    }));
  const pending = approvals.filter(
    (approval) =>
      approval.context.repository.id === repositoryId &&
      approval.status === 'pending',
  );
  return (
    <section
      className="workflow-panel panel"
      aria-label="Dependencies and approvals"
    >
      <div className="workflow-heading">
        <div>
          <span className="eyebrow">PLAN · APPROVE · REVIEW</span>
          <h2>Dependencies & approvals</h2>
          <p>
            Arrows point from prerequisite to dependent task. Completion is
            checked separately for MOCK and Codex.
          </p>
        </div>
        <Button variant="outline" onClick={() => setVersion((v) => v + 1)}>
          Refresh workflow
        </Button>
      </div>
      {error && <ErrorNotice message={error} />}
      {!!tasks.length && (
        <div className="dependency-canvas" aria-label="Task dependency graph">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            deleteKeyCode={null}
            colorMode="dark"
            onNodeClick={(_event, node) => {
              const task = graph.tasks.find((item) => item.id === node.id)!;
              selectTask(task.id, task.repositoryId);
            }}
          >
            <Background gap={22} color="#34424b" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}
      <ul className="dependency-statuses" aria-label="Task readiness">
        {local.map((task) => (
          <li key={task.id}>
            <button onClick={() => selectTask(task.id, task.repositoryId)}>
              {task.title}
            </button>
            <span
              className={
                readiness(task.id)?.mockBlockedBy.length
                  ? 'readiness-blocked'
                  : 'readiness-ready'
              }
            >
              MOCK{' '}
              {readiness(task.id)?.mockBlockedBy.length
                ? 'blocked'
                : 'runnable'}
            </span>
            <span>
              CODEX{' '}
              {readiness(task.id)?.codexBlockedBy.length
                ? 'blocked'
                : 'needs approval'}
            </span>
          </li>
        ))}
      </ul>
      {!!local.length && (
        <form
          className="dependency-editor"
          aria-label="Edit task prerequisites"
          onSubmit={(event) => {
            event.preventDefault();
            if (parentId)
              void mutate(() =>
                api.editDependencies(selectedId, [...parents, parentId]),
              );
          }}
        >
          <div>
            <label htmlFor="dependency-task">Dependent task</label>
            <select
              id="dependency-task"
              value={selectedId}
              onChange={(event) => {
                setTaskId(event.target.value);
                setParentId('');
              }}
            >
              {local.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dependency-parent">Prerequisite task</label>
            <select
              id="dependency-parent"
              value={parentId}
              disabled={readOnly || busy}
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">Choose prerequisite</option>
              {graph.tasks
                .filter(
                  (task) =>
                    task.id !== selectedId && !parents.includes(task.id),
                )
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                    {task.repositoryId !== repositoryId
                      ? ' (other repository)'
                      : ''}
                  </option>
                ))}
            </select>
          </div>
          <Button
            type="submit"
            disabled={
              readOnly || busy || !parentId || parents.includes(parentId)
            }
          >
            Add prerequisite
          </Button>
          <ul className="prerequisite-list">
            {parents.map((id) => (
              <li key={id}>
                <span>
                  {graph.tasks.find((task) => task.id === id)?.title ?? id}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={readOnly || busy}
                  aria-label={`Remove prerequisite ${graph.tasks.find((task) => task.id === id)?.title ?? id}`}
                  onClick={() => {
                    void mutate(() =>
                      api.editDependencies(
                        selectedId,
                        parents.filter((parent) => parent !== id),
                      ),
                    );
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </form>
      )}
      <div className="approval-heading">
        <h3>Real-run approval queue</h3>
        <span>{pending.length} pending</span>
      </div>
      {!pending.length && (
        <p className="workflow-muted">
          No pending approvals. Use “Start Codex run…” on a task to request
          review. Creating a request never launches an agent.
        </p>
      )}
      <ul className="approval-queue">
        {pending.map((approval) => (
          <li key={approval.id}>
            <div>
              <strong>{approval.context.task.title}</strong>
              <span>{approval.model} · awaiting approval</span>
              <code>{approval.context.worktree.path}</code>
              <small>
                Expires {new Date(approval.expiresAt).toLocaleTimeString()}
              </small>
            </div>
            <Button
              disabled={readOnly || busy}
              onClick={() => review(approval)}
            >
              Review and approve
            </Button>
            <Button
              variant="ghost"
              disabled={readOnly || busy}
              onClick={() => {
                void mutate(() => api.rejectApproval(approval.id));
              }}
            >
              Reject
            </Button>
          </li>
        ))}
      </ul>
      {!!approvals.filter(
        (approval) =>
          approval.context.repository.id === repositoryId &&
          approval.status !== 'pending',
      ).length && (
        <details>
          <summary>Approval history</summary>
          <ul className="approval-history">
            {approvals
              .filter(
                (approval) =>
                  approval.context.repository.id === repositoryId &&
                  approval.status !== 'pending',
              )
              .map((approval) => (
                <li key={approval.id}>
                  {approval.context.task.title} · {approval.status}
                  {approval.runId ? ` · run ${approval.runId.slice(0, 8)}` : ''}
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}
