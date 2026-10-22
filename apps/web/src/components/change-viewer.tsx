import { FileCode2, GitCompare, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { ErrorNotice, Loading } from './ui/feedback';
import { useWorktreeChanges } from '@/hooks/use-worktree-changes';
import type { Worktree } from '@worktreeos/shared';

export function ChangeViewer({
  tree,
  revision,
}: {
  tree: Worktree | undefined;
  revision: string;
}) {
  const changes = useWorktreeChanges(tree?.id, revision);
  if (!tree)
    return (
      <div className="viewer-empty">
        <GitCompare size={29} />
        <h3>No managed worktree available</h3>
        <p>
          Create a worktree to inspect its changes. Removed worktrees retain
          their run history.
        </p>
      </div>
    );
  return (
    <div className="change-viewer">
      <div className="changes-toolbar">
        <span>
          <GitCompare size={15} />
          Changes against HEAD
        </span>
        <Button
          variant="ghost"
          onClick={changes.refresh}
          aria-label="Refresh worktree changes"
        >
          <RefreshCw />
          Refresh
        </Button>
      </div>
      {changes.error && (
        <ErrorNotice message={changes.error} retry={changes.refresh} />
      )}
      {!changes.data && !changes.error && (
        <Loading label="Inspecting worktree changes…" />
      )}
      {changes.data && (
        <>
          <div className="changed-files">
            <h3>
              Changed files <span>{changes.data.status.files.length}</span>
            </h3>
            {changes.data.status.files.map((file) => (
              <div className="changed-file" key={file.path}>
                <FileCode2 size={15} />
                <code>{file.path}</code>
                {file.previousPath && <small>from {file.previousPath}</small>}
                <span className="file-status">
                  {file.status === '??' ? 'Untracked' : file.status.trim()}
                </span>
              </div>
            ))}
            {!changes.data.status.files.length && (
              <div className="clean-note">
                <ShieldCheck size={17} />
                No tracked or untracked changes.
              </div>
            )}
          </div>
          {changes.data.patch.diff ? (
            <div
              className="diff-scroll"
              tabIndex={0}
              role="region"
              aria-label="Git diff"
            >
              <pre>
                {changes.data.patch.diff.split('\n').map((line, index) => (
                  <span
                    key={index}
                    className={`diff-line ${line.startsWith('diff ') || line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---') ? 'diff-meta' : line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-delete' : ''}`}
                  >
                    <span className="diff-line-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    {line || ' '}
                    <br />
                  </span>
                ))}
              </pre>
            </div>
          ) : (
            <div className="no-patch">No tracked patch to display.</div>
          )}
          {!!changes.data.patch.untrackedFiles.length && (
            <p className="viewer-note">
              Untracked files are listed above. Their contents are not included
              in the tracked Git diff.
            </p>
          )}
        </>
      )}
    </div>
  );
}
