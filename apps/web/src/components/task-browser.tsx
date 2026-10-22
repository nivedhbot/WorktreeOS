import { useState } from 'react';
import { GitBranch, Kanban, List, ListTodo, Plus, Search } from 'lucide-react';
import { isActiveRun, type Run, type Task } from '@worktreeos/shared';
import { Button } from '@/components/ui/button';
import { StatusBadge } from './status-badge';
import { taskStatus } from '@/lib/task-status';

const filters = [
  'All',
  'Not started',
  'Active',
  'Completed',
  'Needs attention',
] as const;
type Filter = (typeof filters)[number];

export function TaskBrowser({
  tasks,
  runs,
  selectedId,
  select,
  create,
  readOnly,
}: {
  tasks: Task[];
  runs: Record<string, Run[]>;
  selectedId: string | undefined;
  select: (id: string) => void;
  create: () => void;
  readOnly: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'board'>('list');
  const visible = tasks.filter((task) => {
    const status = taskStatus(task, runs);
    return (
      `${task.title} ${task.objective}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === 'All' ||
        (filter === 'Not started' && status === 'not_started') ||
        (filter === 'Active' &&
          status !== 'not_started' &&
          isActiveRun(status)) ||
        (filter === 'Completed' && status === 'completed') ||
        (filter === 'Needs attention' &&
          ['failed', 'canceled', 'interrupted'].includes(status)))
    );
  });
  function card(task: Task) {
    return (
      <button
        key={task.id}
        className={`task-card ${selectedId === task.id ? 'selected' : ''}`}
        aria-pressed={selectedId === task.id}
        onClick={() => select(task.id)}
      >
        <div className="task-card-top">
          <span className="task-short-id">
            TSK-{task.id.slice(0, 4).toUpperCase()}
          </span>
          <StatusBadge status={taskStatus(task, runs)} />
        </div>
        <strong>{task.title}</strong>
        <p>{task.objective}</p>
        <div className="task-card-foot">
          <span className="mock-label">
            {runs[task.id]?.at(-1)?.mode ?? 'MOCK'}
          </span>
          <span>
            <GitBranch size={12} />
            {runs[task.id]?.length ?? 0} runs
          </span>
        </div>
      </button>
    );
  }
  return (
    <section className="task-browser panel" aria-labelledby="tasks-heading">
      <div className="panel-heading">
        <div>
          <h2 id="tasks-heading">
            <ListTodo size={17} />
            Tasks<span className="count-badge">{tasks.length}</span>
          </h2>
          <p>One objective. One focused workspace.</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Create a task"
          onClick={create}
          disabled={readOnly}
        >
          <Plus />
        </Button>
      </div>
      <div className="task-tools">
        <label className="search-field">
          <Search size={15} />
          <input
            aria-label="Search tasks"
            type="search"
            placeholder="Find a task…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="view-toggle" aria-label="Task view">
          <button
            aria-label="List view"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            <List size={16} />
          </button>
          <button
            aria-label="Board view"
            aria-pressed={view === 'board'}
            onClick={() => setView('board')}
          >
            <Kanban size={16} />
          </button>
        </div>
      </div>
      <div className="filter-row" aria-label="Filter tasks by status">
        {filters.map((name) => (
          <button
            key={name}
            aria-pressed={filter === name}
            onClick={() => setFilter(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {visible.length ? (
        view === 'list' ? (
          <div className="task-list">{visible.map(card)}</div>
        ) : (
          <div className="task-board">
            {[
              {
                name: 'Ready',
                match: (status: string) => status === 'not_started',
              },
              {
                name: 'Active',
                match: (status: string) =>
                  ['queued', 'preparing', 'running'].includes(status),
              },
              {
                name: 'Review',
                match: (status: string) =>
                  !['not_started', 'queued', 'preparing', 'running'].includes(
                    status,
                  ),
              },
            ].map((lane) => (
              <section key={lane.name} aria-label={`${lane.name} tasks`}>
                <h3>
                  {lane.name}
                  <span>
                    {
                      visible.filter((task) =>
                        lane.match(taskStatus(task, runs)),
                      ).length
                    }
                  </span>
                </h3>
                {visible
                  .filter((task) => lane.match(taskStatus(task, runs)))
                  .map(card)}
              </section>
            ))}
          </div>
        )
      ) : (
        <div className="task-empty">
          <ListTodo size={27} />
          <h3>
            {tasks.length
              ? 'No matching tasks'
              : 'Make room for your next idea.'}
          </h3>
          <p>
            {tasks.length
              ? 'Try a different status or search term.'
              : 'Create a task, give it an isolated worktree, and follow a MOCK run.'}
          </p>
          {!tasks.length && (
            <Button variant="outline" onClick={create} disabled={readOnly}>
              <Plus />
              Create your first task
            </Button>
          )}
        </div>
      )}
      <div className="task-browser-foot">
        {visible.length} of {tasks.length} tasks · local workspace
      </div>
    </section>
  );
}
