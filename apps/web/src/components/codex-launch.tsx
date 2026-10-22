import { useEffect, useState } from 'react';
import {
  codexAvailabilitySchema,
  type Approval,
  type Repository,
  type Run,
  type Worktree,
} from '@worktreeos/shared';
import { z } from 'zod';
import { api, errorMessage } from '@/lib/api';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { ErrorNotice } from './ui/feedback';

export function CodexLaunch({
  repository,
  tree,
  approval,
  requested,
  accepted,
  close,
  readOnly = false,
}: {
  repository: Repository;
  tree: Worktree;
  approval?: Approval;
  requested?: (approval: Approval) => void;
  accepted: (run: Run) => void;
  close: () => void;
  readOnly?: boolean;
}) {
  const [availability, setAvailability] = useState<z.infer<
    typeof codexAvailabilitySchema
  > | null>(null);
  const [model, setModel] = useState<Approval['model']>(
    approval?.model ?? 'gpt-6-luna',
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api
      .codexAvailability(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setAvailability(data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, []);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title={approval ? 'Approve this Codex run' : 'Request a Codex run'}
      description={
        approval
          ? 'This sends your task and repository context to Codex using your existing CLI authentication. Usage limits and charges may apply.'
          : 'Add a request to the approval queue. This action does not launch an agent. Review and confirm the queued request separately.'
      }
    >
      <form
        className="workspace-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            readOnly ||
            busy ||
            (approval && !acknowledged) ||
            !availability?.models.includes(model)
          )
            return;
          setBusy(true);
          setError(null);
          const operation = approval
            ? api.confirmApproval(approval.id).then(accepted)
            : api
                .requestApproval(tree.taskId, tree.id, model)
                .then((record) => requested?.(record));
          void operation.then(close).catch((reason: unknown) => {
            setError(errorMessage(reason));
            setBusy(false);
          });
        }}
      >
        <p>
          <strong>Repository: {repository.name}</strong>
          <br />
          <code>{repository.path}</code>
        </p>
        <p>
          Worktree
          <br />
          <code className="confirmation-path">{tree.path}</code>
        </p>
        {approval && (
          <>
            <p>
              <strong>Task: {approval.context.task.title}</strong>
              <br />
              Revision {approval.context.task.revision ?? 0}
            </p>
            <p className="approval-objective">
              {approval.context.task.objective}
            </p>
            <p>
              Approval expires {new Date(approval.expiresAt).toLocaleString()}
            </p>
          </>
        )}
        <label className="field-label" htmlFor="codex-model">
          Model
        </label>
        <select
          id="codex-model"
          value={model}
          disabled={busy || !!approval}
          onChange={(event) => {
            setModel(event.target.value as typeof model);
            setAcknowledged(false);
          }}
        >
          <option
            value="gpt-6-luna"
            disabled={!availability?.models.includes('gpt-6-luna')}
          >
            gpt-6-luna
            {availability?.models.includes('gpt-6-luna')
              ? ''
              : ' (unavailable)'}
          </option>
          {(availability?.models.includes('gpt-6.1-sol') ||
            approval?.model === 'gpt-6.1-sol') && (
            <option value="gpt-6.1-sol">gpt-6.1-sol</option>
          )}
        </select>
        {!availability && !error && (
          <p role="status">
            Checking configured Codex authentication and available models…
          </p>
        )}
        {availability?.error && <ErrorNotice message={availability.error} />}
        <p className="mock-disclosure">
          Read-only sandbox. Tool network and web search disabled. Commands
          requiring interactive approval stop the run. No automatic retries.
        </p>
        {approval && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy || readOnly}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I approve this single real run for the task, repository, worktree
            and model shown above.
          </label>
        )}
        {error && <ErrorNotice message={error} />}
        <div className="dialog-actions">
          <Button
            type="button"
            variant="outline"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              readOnly ||
              busy ||
              (!!approval && !acknowledged) ||
              !availability?.models.includes(model)
            }
          >
            {busy
              ? 'Submitting…'
              : approval
                ? 'Approve and start Codex'
                : 'Add to approval queue'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
