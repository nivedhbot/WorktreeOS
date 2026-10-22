import * as Tabs from '@radix-ui/react-tabs';
import {
  Activity,
  Check,
  Clock3,
  FileCode2,
  GitBranch,
  Play,
  Radio,
  RotateCcw,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import {
  isActiveRun,
  type Run,
  type RunEvent,
  type Task,
  type Worktree,
} from '@worktreeos/shared';
import { Button } from './ui/button';
import { ErrorNotice, Loading } from './ui/feedback';
import { StatusBadge } from './status-badge';
import { useRunEvents } from '@/hooks/use-run-events';
import { ChangeViewer } from './change-viewer';
import { FinalReview } from './final-review';

interface Props {
  task: Task;
  tree: Worktree | undefined;
  inspectedTree: Worktree | undefined;
  runs: Run[];
  run: Run | undefined;
  selectRun: (id: string) => void;
  changed: (event?: RunEvent) => void;
  createTree: () => void;
  start: () => void;
  startCodex?: () => void;
  cancel: () => void;
  retry: () => void;
  remove: () => void;
  busy: string | null;
  error: string | null;
  readOnly: boolean;
  anyActive: boolean;
}
export function RunViewer({
  task,
  tree,
  inspectedTree,
  runs,
  run,
  selectRun,
  changed,
  createTree,
  start,
  startCodex,
  cancel,
  retry,
  remove,
  busy,
  error,
  readOnly,
  anyActive,
}: Props) {
  const stream = useRunEvents(run, changed);
  const active = !!run && isActiveRun(run.status);
  const progress = [...stream.events]
    .reverse()
    .find(
      (event) =>
        event.type === 'mock.progress' &&
        typeof event.payload.percent === 'number',
    );
  const percent =
    typeof progress?.payload.percent === 'number'
      ? progress.payload.percent
      : null;
  return (
    <section className="run-viewer panel" aria-labelledby="run-title">
      <div className="run-heading">
        <div className="run-heading-top">
          <span className="task-short-id">
            TSK-{task.id.slice(0, 4).toUpperCase()}
          </span>
          <span className="mock-badge">{run?.mode ?? 'MOCK'}</span>
          <StatusBadge status={run?.status ?? 'not_started'} />
        </div>
        <h2 id="run-title">{task.title}</h2>
        <p className="task-objective">{task.objective}</p>
        <div className="run-meta">
          <span>
            <GitBranch size={13} />
            {(run ? inspectedTree : tree)?.branch ??
              (run ? 'Worktree unavailable' : 'No worktree yet')}
          </span>
          {run && (
            <span>
              <Clock3 size={13} />
              <time dateTime={run.createdAt}>
                {new Date(run.createdAt).toLocaleString()}
              </time>
            </span>
          )}
        </div>
      </div>
      <div className="mock-disclosure">
        {run?.provider === 'codex' ? (
          <>
            <span className="mock-label">REAL CODEX</span>Read-only sandbox.
            Actual model usage. No automatic retries.
          </>
        ) : (
          <>
            <span className="mock-label">MOCK PROVIDER</span>Simulated events
            only. No model calls, commands, or file writes.
          </>
        )}
      </div>
      {run?.provider === 'codex' && (
        <div className="run-history">
          <code>
            {run.model} · {run.threadId ?? 'Thread pending'}
          </code>
          {run.usage && (
            <span>
              Actual tokens: {run.usage.input_tokens} input ·{' '}
              {run.usage.output_tokens} output · {run.usage.cached_input_tokens}{' '}
              cached input
            </span>
          )}
        </div>
      )}
      <div className="run-controls">
        {!tree && (
          <Button
            variant="outline"
            onClick={createTree}
            disabled={readOnly || !!busy}
          >
            <GitBranch />
            {busy === 'create-tree' ? 'Creating…' : 'Create worktree'}
          </Button>
        )}
        {active ? (
          <Button
            variant="outline"
            onClick={cancel}
            disabled={readOnly || !!busy}
          >
            <Square />
            {busy === 'cancel' ? 'Canceling…' : 'Cancel run'}
          </Button>
        ) : (
          <Button
            onClick={start}
            disabled={readOnly || !!busy || !tree || anyActive}
          >
            <Play />
            {busy === 'start' ? 'Starting…' : 'Start MOCK run'}
          </Button>
        )}
        {!active && startCodex && (
          <Button
            variant="outline"
            onClick={startCodex}
            disabled={readOnly || !!busy || !tree || anyActive}
          >
            Start Codex run…
          </Button>
        )}
        {run?.provider === 'mock' &&
          ['failed', 'canceled', 'interrupted'].includes(run.status) && (
            <Button
              variant="outline"
              onClick={retry}
              disabled={readOnly || !!busy || anyActive || !inspectedTree}
            >
              <RotateCcw />
              {busy === 'retry' ? 'Retrying…' : 'Retry MOCK run'}
            </Button>
          )}
        {tree && (
          <Button
            variant="ghost"
            size="icon"
            onClick={remove}
            disabled={readOnly || !!busy || anyActive}
            aria-label="Remove managed worktree"
          >
            <Trash2 />
          </Button>
        )}
        <span className="run-controls-note">
          {!tree
            ? 'Create an isolated branch before starting.'
            : anyActive && !active
              ? 'This task already has an active or queued run.'
              : 'You review every change.'}
        </span>
      </div>
      {error && (
        <div className="run-error">
          <ErrorNotice message={error} />
        </div>
      )}
      {!tree && !run && (
        <div className="setup-hint">
          <span>01</span>
          <div>
            <strong>A separate space for this task.</strong>
            <p>
              Create a worktree outside your original checkout. Then start a
              local MOCK simulation.
            </p>
          </div>
        </div>
      )}
      {!!runs.length && (
        <div className="run-history">
          <label htmlFor="run-history">Run history</label>
          <select
            id="run-history"
            value={run?.id ?? ''}
            onChange={(event) => selectRun(event.target.value)}
          >
            {[...runs].reverse().map((record, index) => (
              <option key={record.id} value={record.id}>
                {index === 0 ? 'Latest · ' : ''}
                {record.id.slice(0, 8)} · {record.status.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <span
            className={`stream-label stream-${stream.status}`}
            role="status"
          >
            <Radio size={12} />
            {run
              ? {
                  loading: 'Loading events',
                  connecting: 'Connecting',
                  live: 'Live events',
                  reconnecting: 'Reconnecting',
                  complete: 'Saved history',
                  error: 'Stream error',
                }[stream.status]
              : ''}
          </span>
        </div>
      )}
      <Tabs.Root defaultValue="timeline" className="run-tabs">
        <Tabs.List className="tab-list" aria-label="Run inspection">
          <Tabs.Trigger value="review">
            <Check size={14} />
            Final review
          </Tabs.Trigger>
          <Tabs.Trigger value="timeline">
            <Activity size={14} />
            Timeline
          </Tabs.Trigger>
          <Tabs.Trigger value="log">
            <Terminal size={14} />
            Event log<span>{stream.events.length}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="changes">
            <FileCode2 size={14} />
            Changes
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="review" className="tab-content">
          <FinalReview run={run} tree={run ? inspectedTree : tree} />
        </Tabs.Content>
        <Tabs.Content value="timeline" className="tab-content">
          {!run ? (
            <div className="viewer-empty">
              <Activity size={30} />
              <h3>Your task is ready for its first run.</h3>
              <p>
                Start a MOCK run to follow its progress here. It simulates a
                coding workflow without changing files.
              </p>
              <div className="empty-stages">
                <span>Prepare</span>
                <i />
                <span>Simulate</span>
                <i />
                <span>Review</span>
              </div>
            </div>
          ) : (
            <>
              {stream.error && (
                <ErrorNotice message={stream.error} retry={stream.reconnect} />
              )}
              {stream.status === 'loading' && (
                <Loading label="Loading run timeline…" />
              )}
              {percent !== null && (
                <div className="progress-summary">
                  <span>MOCK simulation</span>
                  <strong>{percent}%</strong>
                  <progress
                    aria-label="MOCK simulation progress"
                    max={100}
                    value={percent}
                  />
                </div>
              )}
              <ol className="event-timeline" aria-label="Run timeline">
                {stream.events.map((event) => (
                  <li key={event.id}>
                    <span
                      className={`timeline-node ${event.type === 'run.status' && event.payload.status === 'completed' ? 'done' : ''}`}
                    >
                      {event.type === 'run.status' &&
                      event.payload.status === 'completed' ? (
                        <Check size={13} />
                      ) : event.type === 'mock.file' ? (
                        <FileCode2 size={13} />
                      ) : (
                        <Terminal size={12} />
                      )}
                    </span>
                    <div>
                      <div className="event-heading">
                        <strong>
                          {event.type === 'run.status'
                            ? String(event.payload.status).replaceAll('_', ' ')
                            : event.type.replace('mock.', 'Simulated ')}
                        </strong>
                        <time dateTime={event.createdAt}>
                          {new Date(event.createdAt).toLocaleTimeString()}
                        </time>
                      </div>
                      <p>
                        {typeof event.payload.message === 'string'
                          ? event.payload.message
                          : 'MOCK event recorded'}
                      </p>
                      {event.type === 'mock.file' &&
                        typeof event.payload.path === 'string' && (
                          <code className="simulated-path">
                            {event.payload.path} · simulated, not written
                          </code>
                        )}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Tabs.Content>
        <Tabs.Content value="log" className="tab-content">
          {stream.error && (
            <ErrorNotice message={stream.error} retry={stream.reconnect} />
          )}
          {run && stream.status === 'loading' ? (
            <Loading label="Loading event log…" />
          ) : stream.events.length ? (
            <div
              className="event-log"
              tabIndex={0}
              role="region"
              aria-label="Persisted event log"
            >
              {stream.events.map((event) => (
                <article key={event.id}>
                  <header>
                    <span>
                      #{event.sequence} {event.type}
                    </span>
                    <time>
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </time>
                  </header>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </article>
              ))}
            </div>
          ) : (
            <div className="viewer-empty">
              <Terminal size={27} />
              <h3>No recorded events yet</h3>
              <p>Events appear after you explicitly start a MOCK run.</p>
            </div>
          )}
        </Tabs.Content>
        <Tabs.Content value="changes" className="tab-content">
          <ChangeViewer
            tree={run ? inspectedTree : tree}
            revision={`${run?.id ?? 'no-run'}:${run?.status ?? 'not-started'}`}
          />
        </Tabs.Content>
      </Tabs.Root>
      <div className="viewer-footer">
        <span className="status-dot" />
        Local execution · your original checkout stays separate.
      </div>
    </section>
  );
}
