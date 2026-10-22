import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadEnvironment() {
  const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}
