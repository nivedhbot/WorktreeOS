import type { Run } from '@worktreeos/shared';

export function StatusBadge({
  status,
}: {
  status: Run['status'] | 'not_started';
}) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" />
      {status.replaceAll('_', ' ')}
    </span>
  );
}
