import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { devNull } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../errors.js';

const execFileAsync = promisify(execFile);
const comparable = (path: string) =>
  process.platform === 'win32' ? path.toLowerCase() : path;
const invalid = (message: string) =>
  new AppError(400, 'INVALID_REPOSITORY_PATH', message);

export async function validateRepositoryPath(input: string) {
  const hasControlCharacters = Array.from(input).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
  if (
    !isAbsolute(input) ||
    hasControlCharacters ||
    /^(?:[\\/]{2}|[a-z][a-z0-9+.-]*:\/\/)/i.test(input)
  ) {
    throw invalid(
      'Select an absolute local directory path; URLs, network shares, and device paths are not allowed',
    );
  }
  if (input.split(/[\\/]/).includes('..'))
    throw invalid('Parent-directory traversal is not allowed');

  let canonical: string;
  try {
    canonical = await realpath(input);
    if (!(await stat(canonical)).isDirectory())
      throw invalid('Repository path must be a directory');
    if (
      /^[\\/]{2}/.test(canonical) ||
      comparable(canonical) !== comparable(resolve(input))
    ) {
      throw invalid(
        'Symbolic-link or junction aliases are not allowed; select the real repository directory',
      );
    }
    const gitPath = join(canonical, '.git');
    const gitCanonical = await realpath(gitPath);
    const gitRelative = relative(canonical, gitCanonical);
    if (
      !(await stat(gitCanonical)).isDirectory() ||
      gitRelative === '..' ||
      gitRelative.startsWith(`..${sep}`) ||
      isAbsolute(gitRelative)
    ) {
      throw invalid(
        'Select a repository root with local .git metadata inside that directory',
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalid(
      'Path must exist and be a readable Git repository root containing a .git directory',
    );
  }

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith('GIT_'),
    ),
  );
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['--no-optional-locks', '-C', canonical, 'rev-parse', '--show-toplevel'],
      {
        shell: false,
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 64 * 1024,
        env: {
          ...env,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : devNull,
          GIT_TERMINAL_PROMPT: '0',
        },
      },
    );
    const root = await realpath(stdout.trim());
    if (comparable(root) !== comparable(canonical))
      throw invalid('Select the Git repository root, not a nested directory');
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new AppError(
        503,
        'GIT_UNAVAILABLE',
        'Git is required for repository validation; install Git and restart the API',
      );
    throw invalid(
      'Directory is not a valid non-bare local Git repository root',
    );
  }
  return canonical;
}
