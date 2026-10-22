import {
  Blocks,
  FolderGit2,
  GitBranch,
  LayoutDashboard,
  ListTodo,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import type { Repository, Task, Run } from '@worktreeos/shared';
import { Button } from '@/components/ui/button';
import { taskStatus } from '@/lib/task-status';

interface Props {
  repository: Repository | undefined;
  tasks: Task[];
  runs: Record<string, Run[]>;
  selectedTaskId: string | undefined;
  selectTask: (id: string) => void;
  register: () => void;
  create: () => void;
  readOnly: boolean;
  openWorkflow?: () => void;
}
export function Sidebar({
  repository,
  tasks,
  runs,
  selectedTaskId,
  selectTask,
  register,
  create,
  readOnly,
  openWorkflow,
}: Props) {
  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <a className="brand" href="#main">
        <span className="brand-icon">
          <Workflow size={21} strokeWidth={2.5} />
        </span>
        <span>
          Worktree<span className="text-muted-foreground">OS</span>
        </span>
        <span className="version">LOCAL</span>
      </a>
      <div className="workspace-card">
        <span className="workspace-avatar">
          <FolderGit2 size={18} />
        </span>
        <div>
          <strong>{repository?.name ?? 'Local workspace'}</strong>
          <small>
            {repository ? 'Registered repository' : 'No repository selected'}
          </small>
        </div>
      </div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="nav-list">
        <a href="#main" aria-current="page" className="nav-item active">
          <LayoutDashboard size={17} />
          Mission control
          <span className="active-dot" />
        </a>
        <a href="#task-browser" className="nav-item">
          <ListTodo size={17} />
          Tasks<span className="nav-count">{tasks.length}</span>
        </a>
        <button className="nav-item" onClick={register} disabled={readOnly}>
          <FolderGit2 size={17} />
          Register repository
          <Plus size={13} className="ml-auto" />
        </button>
      </nav>
      <div className="sidebar-task-heading">
        <span className="nav-label">YOUR TASKS</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={create}
          disabled={!repository || readOnly}
          aria-label="New task from sidebar"
        >
          <Plus size={14} />
        </Button>
      </div>
      <nav className="sidebar-task-list" aria-label="Repository tasks">
        {tasks.map((task) => (
          <button
            key={task.id}
            className={`sidebar-task ${task.id === selectedTaskId ? 'selected' : ''}`}
            onClick={() => selectTask(task.id)}
            aria-current={task.id === selectedTaskId ? 'true' : undefined}
          >
            <span
              className={`task-state-dot task-state-${taskStatus(task, runs)}`}
            />
            <span>{task.title}</span>
          </button>
        ))}
        {!tasks.length && <p>No tasks in this workspace yet.</p>}
      </nav>
      <div className="sidebar-future">
        <button
          className="nav-item"
          disabled={!repository}
          onClick={openWorkflow}
          title="View task dependencies and pending approvals"
        >
          <Workflow size={16} />
          Dependencies & approvals
        </button>
        <button
          className="nav-item"
          disabled
          title="Select a task and use Start Codex run to review and confirm"
        >
          <Blocks size={16} />
          Codex provider<span className="nav-soon">Opt-in</span>
        </button>
      </div>
      <div className="sidebar-bottom">
        <div className="local-note">
          <ShieldCheck size={18} />
          <strong>Your code. Your control.</strong>
          <p>
            Isolated branches. Explicit actions.
            <br />
            Always review before you decide.
          </p>
          <span>
            <LockKeyhole size={12} />
            Local-first · MOCK default
          </span>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">L</span>
          <span>
            Local developer<small>Personal workspace</small>
          </span>
          <GitBranch size={15} className="ml-auto text-muted-foreground" />
        </div>
      </div>
    </aside>
  );
}
