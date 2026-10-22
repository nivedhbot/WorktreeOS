import { useState, type FormEvent } from 'react';
import { FolderGit2, GitBranch, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  createRepositorySchema,
  createTaskSchema,
  type CreateRepository,
  type CreateTask,
  type Worktree,
  type Task,
} from '@worktreeos/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/api';

type FieldErrors = Record<string, string>;
function fieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): FieldErrors {
  return Object.fromEntries(
    issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message]),
  );
}

export function RepositoryDialog({
  close,
  submit,
  readOnly,
}: {
  close: () => void;
  submit: (input: CreateRepository) => Promise<void>;
  readOnly: boolean;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || readOnly) return;
    const result = createRepositorySchema.safeParse({ name, path });
    if (!result.success) {
      setFields(fieldErrors(result.error.issues));
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await submit(result.data);
      close();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title="Register a repository"
      description="Connect an existing local Git repository. Your code stays on your machine."
    >
      <form
        onSubmit={(event) => {
          void save(event);
        }}
        noValidate
        aria-label="Register repository"
        aria-busy={busy}
      >
        <div className="form-symbol">
          <FolderGit2 size={23} />
        </div>
        {error && <ErrorNotice message={error} />}
        <label className="field-label" htmlFor="repository-name">
          Repository name
        </label>
        <input
          id="repository-name"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="my-project"
          maxLength={120}
          disabled={busy || readOnly}
          aria-invalid={!!fields.name}
          aria-describedby={fields.name ? 'repo-name-error' : undefined}
        />
        {fields.name && (
          <p role="alert" className="field-error" id="repo-name-error">
            {fields.name}
          </p>
        )}
        <label className="field-label" htmlFor="repository-path">
          Local Git repository path
        </label>
        <input
          id="repository-path"
          className="mono"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="C:/Projects/my-project"
          maxLength={4096}
          disabled={busy || readOnly}
          aria-invalid={!!fields.path}
          aria-describedby={
            fields.path ? 'repo-path-help repo-path-error' : 'repo-path-help'
          }
        />
        <p className="field-help" id="repo-path-help">
          Use the absolute path to the actual repository root. URLs and symlink
          aliases are not supported.
        </p>
        {fields.path && (
          <p role="alert" className="field-error" id="repo-path-error">
            {fields.path}
          </p>
        )}
        <div className="form-note">
          <ShieldCheck size={16} />
          Registration validates the local path. It does not clone, fetch, or
          modify your checkout.
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || readOnly}>
            <Plus />
            {busy ? 'Registering…' : 'Register repository'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function TaskDialog({
  repositoryId,
  repositoryName,
  close,
  submit,
  readOnly,
  tasks = [],
}: {
  repositoryId: string;
  repositoryName: string;
  close: () => void;
  submit: (input: CreateTask) => Promise<void>;
  readOnly: boolean;
  tasks?: Task[];
}) {
  const [dependencyIds, setDependencyIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || readOnly) return;
    const result = createTaskSchema.safeParse({
      repositoryId,
      title,
      objective,
      provider: 'mock',
      ...(dependencyIds.length ? { dependencyIds } : {}),
    });
    if (!result.success) {
      setFields(fieldErrors(result.error.issues));
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await submit(result.data);
      close();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title="Create a task"
      description={`Give your next idea a clear objective in ${repositoryName}.`}
    >
      <form
        onSubmit={(event) => {
          void save(event);
        }}
        noValidate
        aria-label="Create task"
      >
        {error && <ErrorNotice message={error} />}
        <div className="form-repository">
          <FolderGit2 size={16} />
          <span>{repositoryName}</span>
          <span className="mock-badge">MOCK</span>
        </div>
        <label className="field-label" htmlFor="task-title">
          Task title
        </label>
        <input
          id="task-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What would you like to work on?"
          maxLength={200}
          disabled={busy || readOnly}
          aria-invalid={!!fields.title}
          aria-describedby={fields.title ? 'task-title-error' : undefined}
        />
        {fields.title && (
          <p role="alert" className="field-error" id="task-title-error">
            {fields.title}
          </p>
        )}
        <label className="field-label" htmlFor="task-objective">
          Objective
        </label>
        <textarea
          id="task-objective"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="Describe the desired outcome and what needs to be reviewed…"
          rows={5}
          maxLength={20000}
          disabled={busy || readOnly}
          aria-invalid={!!fields.objective}
          aria-describedby={
            fields.objective ? 'task-objective-error' : undefined
          }
        />
        {fields.objective && (
          <p role="alert" className="field-error" id="task-objective-error">
            {fields.objective}
          </p>
        )}
        <label className="field-label" htmlFor="task-provider">
          Provider
        </label>
        <select id="task-provider" value="mock" disabled>
          <option value="mock">MOCK — deterministic local simulation</option>
        </select>
        {!!tasks.length && (
          <>
            <label className="field-label" htmlFor="task-prerequisites">
              Prerequisites (optional)
            </label>
            <select
              id="task-prerequisites"
              className="prerequisite-select"
              multiple
              value={dependencyIds}
              disabled={busy || readOnly}
              onChange={(event) =>
                setDependencyIds(
                  Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  ),
                )
              }
            >
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
            <p className="field-help">
              Select tasks that must complete first. You can also edit
              prerequisites in the dependency graph.
            </p>
          </>
        )}
        <p className="field-help">
          MOCK makes no model calls or file writes. Real Codex runs require a
          separate, single-use approval.
        </p>
        <div className="form-note">
          <GitBranch size={16} />
          Creating a task saves its objective. You will create its worktree and
          start its run separately.
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || readOnly}>
            <Plus />
            {busy ? 'Creating…' : 'Create task'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function RemoveWorktreeDialog({
  worktree,
  close,
  submit,
  readOnly,
}: {
  worktree: Worktree;
  close: () => void;
  submit: () => Promise<void>;
  readOnly: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || busy || readOnly) return;
    setBusy(true);
    try {
      await submit();
      close();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title="Remove this worktree?"
      description="Only a clean managed worktree can be removed. The branch and committed history are retained."
    >
      <form
        onSubmit={(event) => {
          void remove(event);
        }}
      >
        {error && <ErrorNotice message={error} />}
        <div className="remove-details">
          <strong>{worktree.branch}</strong>
          <code>{worktree.path}</code>
        </div>
        <p className="field-help">
          Removal is refused if tracked, untracked, ignored, or hidden-index
          changes could be lost. No force removal is available.
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={busy || readOnly}
          />
          I confirm removal of this clean worktree.
        </label>
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Keep worktree
          </Button>
          <Button
            type="submit"
            className="destructive-button"
            disabled={!confirmed || busy || readOnly}
          >
            <Trash2 />
            {busy ? 'Removing…' : 'Confirm removal'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
