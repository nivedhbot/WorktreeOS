import {
  Codex,
  type CodexOptions,
  type ThreadEvent,
  type ThreadOptions,
} from '@openai/codex-sdk';
import { usageSchema, type ProviderEvent } from '@worktreeos/shared';
import type { AgentContext, AgentProvider } from './provider.js';
import { AppError } from '../errors.js';
import { z } from 'zod';
import { codexClientOptions, isolatedCodexOverrides } from './codex-policy.js';

export interface CodexClient {
  startThread(options: ThreadOptions): {
    runStreamed(
      input: string,
      options: { signal: AbortSignal },
    ): Promise<{ events: AsyncIterable<ThreadEvent> }>;
  };
}

export class CodexProvider implements AgentProvider {
  readonly id = 'codex' as const;
  readonly mode = 'CODEX' as const;
  constructor(
    private readonly createClient: (
      options: CodexOptions,
      context: AgentContext,
    ) => CodexClient | Promise<CodexClient> = async (options, context) =>
      new Codex({
        ...options,
        configOverrides: await isolatedCodexOverrides(
          options.env!,
          context.worktree.path,
          context.signal,
        ),
      }),
  ) {}

  async *run(context: AgentContext): AsyncIterable<ProviderEvent> {
    context.signal.throwIfAborted();
    const options = codexClientOptions();
    if (!context.model)
      throw new AppError(
        400,
        'MODEL_REQUIRED',
        'Select an available Codex model',
      );
    let completed = false;
    try {
      const client = await this.createClient(options, context);
      context.signal.throwIfAborted();
      const thread = client.startThread({
        workingDirectory: context.worktree.path,
        model: context.model,
        sandboxMode: 'read-only',
        networkAccessEnabled: false,
        webSearchMode: 'disabled',
        skipGitRepoCheck: false,
      });
      const { events } = await thread.runStreamed(context.task.objective, {
        signal: context.signal,
      });
      for await (const event of events) {
        context.signal.throwIfAborted();
        switch (event.type) {
          case 'thread.started':
            yield {
              type: 'codex.thread',
              mode: 'CODEX',
              threadId: event.thread_id,
              message: 'Codex thread started',
            };
            break;
          case 'item.started':
          case 'item.updated':
          case 'item.completed':
            yield {
              type: 'codex.item',
              mode: 'CODEX',
              message:
                event.item.type === 'agent_message'
                  ? event.item.text
                  : `${event.type}: ${event.item.type}`,
              item: z.json().parse(JSON.parse(JSON.stringify(event.item))),
            };
            if (
              event.item.type === 'command_execution' &&
              event.item.status === 'failed'
            )
              throw new Error(
                'Command failed; interactive approval or sandbox access is unavailable',
              );
            break;
          case 'turn.completed':
            completed = true;
            yield {
              type: 'codex.usage',
              mode: 'CODEX',
              message: 'Actual usage reported by Codex',
              usage: usageSchema.parse(event.usage),
            };
            break;
          case 'turn.failed':
          case 'error':
            throw new Error(
              event.type === 'turn.failed'
                ? event.error.message
                : event.message,
            );
        }
      }
      if (!completed) throw new Error('Stream ended without turn completion');
    } catch (error) {
      if (context.signal.aborted) throw error;
      // Never persist raw CLI stderr, credentials, account details or stack traces.
      const text = error instanceof Error ? error.message : '';
      const message = /auth|login|unauthorized|401/i.test(text)
        ? 'Codex authentication unavailable. Sign in with the Codex CLI, then retry explicitly.'
        : /quota|usage|rate.limit|429|credit/i.test(text)
          ? 'Codex usage limit reached. Resolve the limit, then retry explicitly.'
          : /approv|sandbox|permission/i.test(text)
            ? 'Codex requires approval or sandbox access unavailable in this SDK. Run stopped; no approval was bypassed.'
            : 'Codex setup or execution failed. Check local Codex installation and authentication, then retry explicitly.';
      throw new AppError(422, 'CODEX_EXECUTION_FAILED', message);
    }
  }
}
