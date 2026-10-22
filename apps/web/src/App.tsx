import { lazy, Suspense, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  FolderGit2,
  GitBranch,
  Layers,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { isActiveRun, type Worktree, type Approval } from '@worktreeos/shared';
import { Button } from '@/components/ui/button';
import { ErrorNotice, Loading } from '@/components/ui/feedback';
import { Sidebar } from '@/components/sidebar';
import { ConnectionStatus } from '@/components/connection-status';
import { TaskBrowser } from '@/components/task-browser';
import { RunViewer } from '@/components/run-viewer';
import {
  RepositoryDialog,
  TaskDialog,
  RemoveWorktreeDialog,
} from '@/components/workspace-forms';
import { useApiHealth } from '@/hooks/use-api-health';
import { useWorkspace } from '@/hooks/use-workspace';
import { useReadOnlyViewport } from '@/hooks/use-read-only';
import { api, errorMessage } from '@/lib/api';
import { CodexLaunch } from '@/components/codex-launch';
import './workflow.css';

const WorkflowPanel = lazy(async () => {
  const module = await import('@/components/workflow-panel');
  return { default: module.WorkflowPanel };
});

export function App() {
  const health = useApiHealth();
  const workspace = useWorkspace();
  const readOnly = useReadOnlyViewport();
  const [dialog, setDialog] = useState<'repository' | 'task' | null>(null);
  const [removing, setRemoving] = useState<Worktree | null>(null);
  const [codexTree, setCodexTree] = useState<Worktree | null>(null);
  const [approvalReview, setApprovalReview] = useState<Approval | null>(null);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowVersion, setWorkflowVersion] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const repository = workspace.repositories?.find(
    (record) => record.id === workspace.repositoryId,
  );
  const tasks = workspace.snapshot?.tasks ?? [];
  const runs = workspace.snapshot?.runs ?? {};
  const allRuns = Object.values(runs).flat();
  const task = selectedTaskId
    ? tasks.find((record) => record.id === selectedTaskId)
    : tasks[0];
  const taskRuns = task ? (runs[task.id] ?? []) : [];
  const run =
    taskRuns.find((record) => record.id === selectedRunId) ?? taskRuns.at(-1);
  const tree = workspace.snapshot?.worktrees.find(
    (record) => record.taskId === task?.id,
  );
  const inspectedTree = workspace.snapshot?.worktrees.find(
    (record) => record.id === run?.worktreeId,
  );
  const anyActive = taskRuns.some((record) => isActiveRun(record.status));
  const connected = health.connection.status === 'connected';
  const loaded = !!workspace.snapshot;
  function selectTask(id: string) {
    setSelectedTaskId(id);
    setSelectedRunId(null);
    setActionError(null);
  }
  function selectRepository(id: string) {
    workspace.selectRepository(id);
    setSelectedTaskId(null);
    setSelectedRunId(null);
    setActionError(null);
  }
  async function perform(name: string, operation: () => Promise<void>) {
    if (busy || readOnly) return;
    setBusy(name);
    setActionError(null);
    try {
      await operation();
      workspace.reload();
    } catch (reason) {
      setActionError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  }
  const metrics = [
    {
      label: 'Tasks',
      value: tasks.length,
      detail: 'Ideas with a clear objective',
      icon: Layers,
    },
    {
      label: 'Active runs',
      value: allRuns.filter((record) => isActiveRun(record.status)).length,
      detail: 'Bounded queue · up to two running',
      icon: Activity,
    },
    {
      label: 'Worktrees',
      value: workspace.snapshot?.worktrees.length ?? 0,
      detail: 'Separate from your checkout',
      icon: GitBranch,
    },
    {
      label: 'Completed runs',
      value: allRuns.filter((record) => record.status === 'completed').length,
      detail: 'Ready for your inspection',
      icon: CheckCircle2,
    },
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar
        openWorkflow={() => setWorkflowOpen(true)}
        repository={repository}
        tasks={tasks}
        runs={runs}
        selectedTaskId={task?.id}
        selectTask={selectTask}
        register={() => setDialog('repository')}
        create={() => setDialog('task')}
        readOnly={readOnly}
      />
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <Workflow size={18} className="mobile-mark" />
            <span>Workspace</span>
            <i>/</i>
            <strong>Mission control</strong>
          </div>
          <div className="topbar-actions">
            <span
              className={`api-pill ${connected ? 'connected' : health.connection.status === 'disconnected' ? 'disconnected' : ''}`}
              role="status"
            >
              <span className="status-dot" />
              {connected
                ? 'API connected'
                : health.connection.status === 'checking'
                  ? 'Checking API…'
                  : 'API disconnected'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={health.retry}
              aria-label="Refresh API connection"
            >
              <RefreshCw size={14} />
            </Button>
            <span className="local-pill">
              <LockKeyhole size={12} />
              Local only
            </span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="little-line" />
                YOUR DEVELOPMENT COMMAND CENTER
              </div>
              <h1>
                A space to do great work<span>.</span>
              </h1>
              <p>
                Give every task its own branch. Follow the run. Review every
                change.
              </p>
            </div>
            <Button
              onClick={() => setDialog('task')}
              disabled={readOnly || !repository || !!busy}
            >
              <Plus />
              New task
            </Button>
          </div>
          {readOnly && (
            <div className="mobile-notice" role="note">
              <LockKeyhole size={14} />
              Read-only mobile view. Use a desktop to register repositories and
              control runs.
            </div>
          )}
          {health.connection.status === 'disconnected' && (
            <ErrorNotice
              message={health.connection.message}
              retry={health.retry}
            />
          )}
          {workspace.error && (
            <ErrorNotice message={workspace.error} retry={workspace.reload}>
              {workspace.snapshot && (
                <small>Showing the last successfully loaded workspace.</small>
              )}
            </ErrorNotice>
          )}
          <section
            className="repository-toolbar"
            aria-label="Repository selection"
          >
            <span className="repo-symbol">
              <FolderGit2 size={20} />
            </span>
            <div className="repository-picker">
              <label htmlFor="repository-picker">REPOSITORY</label>
              <select
                id="repository-picker"
                value={workspace.repositoryId ?? ''}
                disabled={!workspace.repositories?.length || !!busy}
                onChange={(event) => selectRepository(event.target.value)}
              >
                {!workspace.repositories?.length && (
                  <option value="">
                    {workspace.repositories === null
                      ? 'Loading repositories…'
                      : 'Select a local repository'}
                  </option>
                )}
                {workspace.repositories?.map((record) => (
                  <option value={record.id} key={record.id}>
                    {record.name}
                  </option>
                ))}
              </select>
            </div>
            <code className="repository-path" title={repository?.path}>
              {repository?.path ?? 'Your code stays on your machine.'}
            </code>
            <Button
              variant="outline"
              onClick={() => setDialog('repository')}
              disabled={readOnly || !!busy}
            >
              <Plus />
              Register repo
            </Button>
          </section>
          {repository && (
            <div className="workflow-toggle">
              <Button
                variant="outline"
                aria-expanded={workflowOpen}
                onClick={() => setWorkflowOpen((open) => !open)}
              >
                <Workflow size={15} />
                Dependencies & approvals
              </Button>
              <span>Sequence tasks. Review every real run.</span>
            </div>
          )}
          {repository && workflowOpen && (
            <Suspense fallback={<Loading label="Loading workflow view…" />}>
              <WorkflowPanel
                repositoryId={repository.id}
                revision={`${workflowVersion}:${allRuns.map((record) => `${record.id}:${record.status}`).join(',')}`}
                readOnly={readOnly}
                changed={() => {
                  workspace.reload();
                  setWorkflowVersion((value) => value + 1);
                }}
                selectTask={(id, repositoryId) => {
                  if (repositoryId !== repository.id)
                    selectRepository(repositoryId);
                  selectTask(id);
                }}
                review={setApprovalReview}
              />
            </Suspense>
          )}
          {workspace.repositories === null && !workspace.error ? (
            <Loading label="Loading your local workspace…" />
          ) : !workspace.repositories?.length ? (
            <div className="onboarding-grid">
              <section className="onboarding-panel">
                <span className="welcome-tag">
                  <ShieldCheck size={13} />
                  LOCAL-FIRST. REVIEW-DRIVEN.
                </span>
                <h2>
                  Great work starts
                  <br />
                  with a little space.
                </h2>
                <p>
                  Connect a local Git repository and give each idea an isolated
                  place to grow. Start with a safe, clearly labeled MOCK
                  simulation.
                </p>
                <Button
                  onClick={() => setDialog('repository')}
                  disabled={readOnly}
                >
                  <FolderGit2 />
                  Register your first repository
                  <ArrowRight />
                </Button>
                <div className="onboarding-steps">
                  <span>
                    <i>01</i>Connect a repository
                  </span>
                  <span>
                    <i>02</i>Define a task
                  </span>
                  <span>
                    <i>03</i>Run and review
                  </span>
                </div>
              </section>
              <ConnectionStatus
                connection={health.connection}
                retry={health.retry}
              />
            </div>
          ) : (
            <>
              <section
                className="metrics"
                aria-label="Selected repository totals"
              >
                {metrics.map(({ label, value, detail, icon: Icon }) => (
                  <article className="metric" key={label}>
                    <div className="metric-label">
                      {label}
                      <Icon size={16} />
                    </div>
                    <strong>{loaded ? value : '—'}</strong>
                    <p>{detail}</p>
                  </article>
                ))}
              </section>
              {!workspace.snapshot ? (
                workspace.error ? (
                  <div className="panel">
                    <Loading label="Workspace unavailable until a successful refresh." />
                  </div>
                ) : (
                  <Loading label="Loading tasks, worktrees, and run history…" />
                )
              ) : (
                <div className="control-grid">
                  <div id="task-browser">
                    <TaskBrowser
                      key={workspace.repositoryId}
                      tasks={tasks}
                      runs={runs}
                      selectedId={task?.id}
                      select={selectTask}
                      create={() => setDialog('task')}
                      readOnly={readOnly}
                    />
                  </div>
                  {task ? (
                    <RunViewer
                      key={task.id}
                      task={task}
                      tree={tree}
                      inspectedTree={inspectedTree}
                      runs={taskRuns}
                      run={run}
                      selectRun={setSelectedRunId}
                      changed={workspace.statusChanged}
                      createTree={() => {
                        void perform('create-tree', async () => {
                          const created = await api.createWorktree(task.id);
                          workspace.acceptWorktree(created);
                        });
                      }}
                      start={() => {
                        if (tree)
                          void perform('start', async () => {
                            const created = await api.startRun(
                              task.id,
                              tree.id,
                            );
                            workspace.upsertRun(created);
                            setSelectedRunId(created.id);
                          });
                      }}
                      startCodex={() => {
                        if (tree) setCodexTree(tree);
                      }}
                      cancel={() => {
                        if (run)
                          void perform('cancel', async () => {
                            workspace.upsertRun(await api.cancelRun(run.id));
                          });
                      }}
                      retry={() => {
                        if (run)
                          void perform('retry', async () => {
                            const created = await api.retryRun(run.id);
                            workspace.upsertRun(created);
                            setSelectedRunId(created.id);
                          });
                      }}
                      remove={() => {
                        if (tree) setRemoving(tree);
                      }}
                      busy={busy}
                      error={actionError}
                      readOnly={readOnly}
                      anyActive={anyActive}
                    />
                  ) : (
                    <section className="panel choose-task">
                      <div className="empty-art">
                        <GitBranch size={36} />
                      </div>
                      <span className="eyebrow">
                        MAKE SPACE FOR WHAT'S NEXT
                      </span>
                      <h2>
                        Every idea deserves
                        <br />a focused workspace.
                      </h2>
                      <p>
                        Create your first task to define an objective, prepare
                        an isolated branch, and watch a MOCK run unfold.
                      </p>
                      <Button
                        onClick={() => setDialog('task')}
                        disabled={readOnly}
                      >
                        <Plus />
                        Create a task
                      </Button>
                      <div className="empty-promise">
                        <ShieldCheck size={15} />
                        No model calls. No automatic merges.
                      </div>
                    </section>
                  )}
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />
              Your machine. Your branches. Your final call.
            </span>
            <span className="mock-label">MOCK DEFAULT · CODEX OPT-IN</span>
          </footer>
        </main>
        <div className="bottom-statusbar">
          <span>
            <GitBranch size={12} />
            {repository?.name ?? 'No repository selected'}
          </span>
          <span>
            {loaded
              ? `${allRuns.filter((record) => isActiveRun(record.status)).length} active runs`
              : 'Workspace loading'}
            <span className="statusbar-divider" />
            WorktreeOS · v0.1.0
          </span>
        </div>
      </div>
      {dialog === 'repository' && (
        <RepositoryDialog
          close={() => setDialog(null)}
          readOnly={readOnly}
          submit={async (input) => {
            const created = await api.registerRepository(input);
            workspace.acceptRepository(created);
            setSelectedTaskId(null);
            setSelectedRunId(null);
            workspace.reload();
          }}
        />
      )}
      {dialog === 'task' && repository && (
        <TaskDialog
          tasks={tasks}
          repositoryId={repository.id}
          repositoryName={repository.name}
          close={() => setDialog(null)}
          readOnly={readOnly}
          submit={async (input) => {
            const created = await api.createTask(input);
            workspace.acceptTask(created);
            setSelectedTaskId(created.id);
            setSelectedRunId(null);
            workspace.reload();
          }}
        />
      )}
      {removing && (
        <RemoveWorktreeDialog
          worktree={removing}
          close={() => setRemoving(null)}
          readOnly={readOnly}
          submit={async () => {
            await api.removeWorktree(removing.id);
            workspace.removeWorktree(removing.id);
            workspace.reload();
          }}
        />
      )}
      {codexTree && repository && (
        <CodexLaunch
          readOnly={readOnly}
          repository={repository}
          tree={codexTree}
          close={() => setCodexTree(null)}
          requested={() => {
            setWorkflowOpen(true);
            setWorkflowVersion((value) => value + 1);
          }}
          accepted={(created) => {
            workspace.upsertRun(created);
            setSelectedRunId(created.id);
            workspace.reload();
          }}
        />
      )}
      {approvalReview && (
        <CodexLaunch
          key={approvalReview.id}
          approval={approvalReview}
          repository={approvalReview.context.repository}
          tree={approvalReview.context.worktree}
          readOnly={readOnly}
          close={() => setApprovalReview(null)}
          accepted={(created) => {
            selectRepository(approvalReview.context.repository.id);
            setSelectedTaskId(created.taskId);
            setSelectedRunId(created.id);
            workspace.upsertRun(created);
            workspace.reload();
            setWorkflowVersion((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
