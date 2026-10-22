import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

export function codexBinary() {
  const targets: Record<string, [string, string]> = {
    'win32-x64': ['win32-x64', 'x86_64-pc-windows-msvc'],
    'win32-arm64': ['win32-arm64', 'aarch64-pc-windows-msvc'],
    'linux-x64': ['linux-x64', 'x86_64-unknown-linux-musl'],
    'linux-arm64': ['linux-arm64', 'aarch64-unknown-linux-musl'],
    'darwin-x64': ['darwin-x64', 'x86_64-apple-darwin'],
    'darwin-arm64': ['darwin-arm64', 'aarch64-apple-darwin'],
  };
  const target = targets[`${process.platform}-${process.arch}`];
  if (!target) throw new Error('Unsupported platform');
  const require = createRequire(import.meta.url);
  const cliRequire = createRequire(
    require.resolve('@openai/codex/package.json'),
  );
  const root = join(
    dirname(cliRequire.resolve(`@openai/codex-${target[0]}/package.json`)),
    'vendor',
    target[1],
  );
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const modern = join(root, 'bin', name);
  return existsSync(modern) ? modern : join(root, 'codex', name);
}
