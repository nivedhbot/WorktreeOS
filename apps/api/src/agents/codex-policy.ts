import type { CodexOptions } from '@openai/codex-sdk';
import { AppError } from '../errors.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { codexBinary } from './codex-binary.js';

// The SDK's legacy ApprovalMode type still contains the retired "untrusted"
// value. Granular false denies requests; it never grants an escalation.
export const codexConfigOverrides = [
  'approval_policy={granular={sandbox_approval=false,rules=false,mcp_elicitations=false,request_permissions=false,skill_approval=false}}',
  'agents.enabled=false',
  'features.multi_agent=false',
  'features.apps=false',
  'features.plugins=false',
  'features.hooks=false',
  'features.skill_mcp_dependency_install=false',
  'features.shell_snapshot=false',
  'notify=[]',
  'shell_environment_policy.ignore_default_excludes=false',
  'shell_environment_policy.set.WORKTREEOS_AGENT_CHILD="1"',
];

export async function isolatedCodexOverrides(
  env: Record<string, string>,
  cwd?: string,
  signal?: AbortSignal,
) {
  try {
    // Empty MCP tables merge with inherited entries. Enumerate configuration
    // without starting servers, then explicitly disable every configured name.
    const { stdout } = await promisify(execFile)(
      codexBinary(),
      [
        ...codexConfigOverrides.flatMap((value) => ['-c', value]),
        'mcp',
        'list',
        '--json',
      ],
      {
        env,
        ...(cwd ? { cwd } : {}),
        ...(signal ? { signal } : {}),
        shell: false,
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      },
    );
    const servers = z
      .array(z.object({ name: z.string().min(1).max(512) }))
      .parse(JSON.parse(stdout));
    return [
      ...codexConfigOverrides,
      `mcp_servers={${servers.map(({ name }) => `${JSON.stringify(name)}={enabled=false}`).join(',')}}`,
    ];
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AppError(
      422,
      'CODEX_CONFIGURATION_FAILED',
      'Unable to verify isolated Codex configuration. Check the local CLI before retrying.',
    );
  }
}

export function assertAgentHost() {
  if (process.env.WORKTREEOS_AGENT_CHILD === '1')
    throw new AppError(
      403,
      'RECURSIVE_AGENT_BLOCKED',
      'WorktreeOS cannot start inside an agent execution. Open it from your own terminal.',
    );
}

export function codexClientOptions(): CodexOptions {
  assertAgentHost();
  return {
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      WORKTREEOS_AGENT_CHILD: '1',
    },
    configOverrides: [...codexConfigOverrides],
    config: {
      model_provider: 'openai',
      model_providers: {
        openai: { request_max_retries: 0, stream_max_retries: 0 },
      },
    },
  };
}
