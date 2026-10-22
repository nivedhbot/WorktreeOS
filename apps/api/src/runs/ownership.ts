import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// Exactly one scheduler owns an app data directory. PID checks work without shell commands on Windows.
export function claimScheduler(dataDir: string) {
  const path = join(dataDir, 'scheduler.lock');
  const acquire = () => openSync(path, 'wx');
  let fd: number;
  try {
    fd = acquire();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    )
      throw error;
    let pid: number;
    try {
      pid = Number(readFileSync(path, 'utf8'));
    } catch {
      throw new Error(
        'Unable to read scheduler.lock; another API may own this data directory',
      );
    }
    if (!Number.isSafeInteger(pid) || pid < 1)
      throw new Error(
        'Invalid scheduler.lock; verify no API is running before removing it',
      );
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
        alive = false;
    }
    if (alive)
      throw new Error(
        'Another WorktreeOS API owns this data directory; stop it before restarting',
      );
    unlinkSync(path);
    fd = acquire();
  }
  try {
    writeFileSync(fd, String(process.pid));
  } finally {
    closeSync(fd);
  }
  let released = false;
  return () => {
    if (!released) {
      released = true;
      if (readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path);
    }
  };
}
