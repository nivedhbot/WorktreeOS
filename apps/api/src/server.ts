import { buildApp } from './app.js';
import { loadEnvironment } from './config.js';
import { listenLoopback } from './security.js';

loadEnvironment();

const port = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('API_PORT must be an integer between 1 and 65535');
}

const app = buildApp({ logger: true });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

try {
  await listenLoopback(app, port);
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
