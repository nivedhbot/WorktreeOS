import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { codexModelSchema, type Run } from '@worktreeos/shared';
import {
  assertAgentHost,
  codexClientOptions,
  isolatedCodexOverrides,
} from './codex-policy.js';
import { codexBinary } from './codex-binary.js';

export interface CodexAvailability {
  models: NonNullable<Run['model']>[];
  error: string | null;
}
export type AvailabilityCheck = () => Promise<CodexAvailability>;
interface ProbeProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
}
export { codexBinary } from './codex-binary.js';

// A short-lived read-only RPC connection: no login, thread/start, turn/start, or model calls.
export function createAvailabilityCheck(
  launch: () => ProbeProcess | Promise<ProbeProcess> = async () => {
    const env = codexClientOptions().env!;
    const overrides = await isolatedCodexOverrides(env);
    return spawn(
      codexBinary(),
      [
        'app-server',
        ...overrides.flatMap((value) => ['-c', value]),
        '-c',
        'web_search="disabled"',
      ],
      { env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  },
  timeoutMs = 10000,
): AvailabilityCheck {
  let pending: Promise<CodexAvailability> | undefined;
  const check: AvailabilityCheck = async () => {
    try {
      assertAgentHost();
      const child = await launch();
      return await new Promise<CodexAvailability>((resolve, reject) => {
        const lines = createInterface({ input: child.stdout });
        let result: CodexAvailability | undefined;
        let bytes = 0;
        let pages = 0;
        const models = new Set<NonNullable<Run['model']>>();
        const send = (
          method: string,
          id: number | undefined,
          params: unknown,
        ) =>
          child.stdin.write(
            `${JSON.stringify({ method, ...(id === undefined ? {} : { id }), params })}\n`,
          );
        const timer = setTimeout(() => {
          child.kill();
        }, timeoutMs);
        const finish = (value: CodexAvailability) => {
          result = value;
          child.stdin.end();
          child.kill();
        };
        child.on('error', reject);
        child.stdin.on('error', () => {});
        child.stderr.on('data', (data: Buffer) => {
          bytes += data.length;
          if (bytes > 1024 * 1024) child.kill();
        });
        lines.on('line', (line) => {
          bytes += Buffer.byteLength(line);
          if (bytes > 1024 * 1024) {
            child.kill();
            return;
          }
          try {
            const reply = z
              .object({
                id: z.number().optional(),
                result: z.unknown().optional(),
                error: z.unknown().optional(),
              })
              .parse(JSON.parse(line));
            if (reply.error) {
              finish({
                models: [],
                error:
                  'Codex setup unavailable. Check CLI authentication and configuration.',
              });
              return;
            }
            if (reply.id === 1) {
              send('initialized', undefined, {});
              send('account/read', 2, { refreshToken: false });
            }
            if (reply.id === 2) {
              const account = z
                .object({ account: z.unknown().nullable() })
                .parse(reply.result);
              if (!account.account)
                finish({
                  models: [],
                  error:
                    'Sign in with the Codex CLI, then check availability again.',
                });
              else send('model/list', 3, { limit: 100, includeHidden: false });
            }
            if (reply.id === 3) {
              if (++pages > 20) {
                child.kill();
                return;
              }
              const page = z
                .object({
                  data: z.array(
                    z.object({
                      model: z.string(),
                      hidden: z.boolean().optional(),
                    }),
                  ),
                  nextCursor: z.string().nullable().optional(),
                })
                .parse(reply.result);
              for (const model of page.data) {
                const parsed = codexModelSchema.safeParse(model.model);
                if (parsed.success && !model.hidden) models.add(parsed.data);
              }
              if (page.nextCursor)
                send('model/list', 3, {
                  limit: 100,
                  includeHidden: false,
                  cursor: page.nextCursor,
                });
              else
                finish({
                  models: [...models],
                  error: models.size
                    ? null
                    : 'Neither supported model is available to this Codex account.',
                });
            }
          } catch {
            child.kill();
          }
        });
        child.on('close', () => {
          clearTimeout(timer);
          lines.close();
          resolve(
            result ?? {
              models: [],
              error:
                'Codex setup check failed or timed out. Check CLI installation and authentication.',
            },
          );
        });
        send('initialize', 1, {
          clientInfo: {
            name: 'worktreeos',
            title: 'WorktreeOS',
            version: '0.1.0',
          },
        });
      });
    } catch {
      return {
        models: [],
        error:
          'Codex CLI is unavailable. Install optional SDK dependencies and sign in with Codex.',
      };
    }
  };
  return () => {
    pending ??= check().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
export const checkCodexAvailability = createAvailabilityCheck();
