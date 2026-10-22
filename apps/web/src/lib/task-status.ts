import type { Run, Task } from '@worktreeos/shared';
export function taskStatus(task: Task, runs: Record<string, Run[]>) {
  return runs[task.id]?.at(-1)?.status ?? 'not_started';
}
