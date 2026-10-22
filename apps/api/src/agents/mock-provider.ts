import { setTimeout as delay } from 'node:timers/promises';
import type { ProviderEvent } from '@worktreeos/shared';
import type { AgentContext, AgentProvider } from './provider.js';

const script: readonly ProviderEvent[] = [
  {
    type: 'mock.message',
    mode: 'MOCK',
    message:
      'MOCK simulation started. No AI model, shell command, or file write will run.',
  },
  {
    type: 'mock.progress',
    mode: 'MOCK',
    percent: 20,
    message: 'MOCK: planning a simulated task',
  },
  {
    type: 'mock.tool',
    mode: 'MOCK',
    tool: 'simulated-inspection',
    message: 'MOCK: simulated tool inspection; no command executed',
  },
  {
    type: 'mock.file',
    mode: 'MOCK',
    path: 'MOCK-preview.txt',
    simulated: true,
    message: 'MOCK: simulated file action; no file was created or changed',
  },
  {
    type: 'mock.progress',
    mode: 'MOCK',
    percent: 80,
    message: 'MOCK: simulated review of proposed changes',
  },
  {
    type: 'mock.progress',
    mode: 'MOCK',
    percent: 100,
    message:
      'MOCK simulation complete. Review events; no real agent output was generated.',
  },
];

export class MockProvider implements AgentProvider {
  readonly id = 'mock' as const;
  readonly mode = 'MOCK' as const;
  constructor(private readonly stepDelayMs = 200) {}
  async *run({ signal }: AgentContext): AsyncIterable<ProviderEvent> {
    for (const event of script) {
      await delay(this.stepDelayMs, undefined, { signal });
      signal.throwIfAborted();
      yield { ...event };
    }
  }
}
