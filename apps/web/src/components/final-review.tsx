import type { Run, Worktree } from '@worktreeos/shared';
import { ChangeViewer } from './change-viewer';

export function FinalReview({
  run,
  tree,
}: {
  run: Run | undefined;
  tree: Worktree | undefined;
}) {
  return (
    <section className="final-review" aria-label="Final review">
      <span className="eyebrow">YOUR FINAL CALL</span>
      <h3>Review before merging</h3>
      <p>
        {run
          ? `${run.mode} run ${run.id.slice(0, 8)} is ${run.status}.`
          : 'No run selected.'}{' '}
        {run?.provider === 'mock'
          ? 'MOCK output is simulated and does not prove that code or tests passed.'
          : 'Inspect the actual files and verify the task outcome.'}
      </p>
      {tree && (
        <p>
          Branch <code>{tree.branch}</code>
          <br />
          Worktree <code>{tree.path}</code>
        </p>
      )}
      <ol>
        <li>
          Read the changed files and tracked patch below; inspect untracked
          contents locally.
        </li>
        <li>
          Run the project’s tests in this worktree and review their results.
          This screen does not execute tests.
        </li>
        <li>
          Check the target branch and resolve conflicts in your Git client.
        </li>
        <li>
          When satisfied, merge the reviewed branch manually. Decide separately
          whether to push or clean up.
        </li>
      </ol>
      <p className="review-promise">
        WorktreeOS does not merge, push, reset, or delete worktrees from this
        screen.
      </p>
      <ChangeViewer
        tree={tree}
        revision={`${run?.id ?? 'none'}:${run?.status ?? 'none'}`}
      />
    </section>
  );
}
