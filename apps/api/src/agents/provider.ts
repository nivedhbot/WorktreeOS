import type { ProviderEvent, Task, Worktree, Run } from '@worktreeos/shared';

export interface AgentContext {
  task: Task;
  worktree: Worktree;
  signal: AbortSignal;
  model?: Run['model'];
}
export interface AgentProvider {
  readonly id: 'mock' | 'codex';
  readonly mode: 'MOCK' | 'CODEX';
  run(context: AgentContext): AsyncIterable<ProviderEvent>;
}
