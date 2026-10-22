import { execFile } from 'node:child_process';
import { devNull } from 'node:os';
import { promisify } from 'node:util';
import { AppError } from '../errors.js';

const execute = promisify(execFile);
const fixedConfig = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'submodule.recurse=false',
];

export async function gitCommand(
  directory: string,
  args: readonly string[],
  acceptedCodes: readonly number[] = [0],
) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith('GIT_'),
    ),
  );
  const options = {
    shell: false as const,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...env,
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    },
  };
  const run = async (arguments_: string[], accepted: readonly number[]) => {
    try {
      return (await execute('git', arguments_, options)).stdout;
    } catch (error) {
      const failure = error as Error & {
        code?: number | string;
        stdout?: string;
      };
      if (typeof failure.code === 'number' && accepted.includes(failure.code))
        return failure.stdout ?? '';
      if (failure.code === 'ENOENT')
        throw new AppError(503, 'GIT_UNAVAILABLE', 'Git is not available');
      throw new AppError(
        409,
        'GIT_OPERATION_FAILED',
        'Git operation failed. Check repository state, branch conflicts, permissions, and output size.',
      );
    }
  };
  // A checkout or status may invoke repository-configured filters. Disable them as well as hooks.
  const keys = (
    await run(
      [
        ...fixedConfig,
        '-C',
        directory,
        'config',
        '--null',
        '--name-only',
        '--get-regexp',
        '^filter[.].*[.](clean|smudge|process|required)$',
      ],
      [0, 1],
    )
  )
    .split('\0')
    .filter(Boolean);
  const filters: string[] = [];
  for (const key of keys) {
    if (!/^filter\.[a-z0-9_.-]+\.(clean|smudge|process|required)$/i.test(key))
      throw new AppError(
        409,
        'UNSAFE_GIT_CONFIG',
        'Repository has unsupported filter configuration',
      );
    filters.push('-c', `${key}=${key.endsWith('.required') ? 'false' : ''}`);
  }
  return run(
    [...fixedConfig, ...filters, '-C', directory, ...args],
    acceptedCodes,
  );
}
