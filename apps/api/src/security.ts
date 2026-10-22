import type { FastifyInstance } from 'fastify';
import { AppError } from './errors.js';

export const LOOPBACK_HOST = '127.0.0.1';
export function isLoopback(address: string) {
  return address === '::1' || /^(?:::ffff:)?127(?:\.\d{1,3}){3}$/.test(address);
}
const hosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
function localUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      hosts.has(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export function registerLocalSecurity(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    const address = request.raw.socket.remoteAddress ?? '';
    if (
      !isLoopback(address) ||
      !localUrl(`http://${request.headers.host ?? ''}`)
    )
      throw new AppError(
        403,
        'LOCAL_ONLY',
        'Only loopback connections with a local Host are allowed',
      );
    const origin = request.headers.origin;
    if (
      (origin !== undefined && !localUrl(origin)) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    )
      throw new AppError(
        403,
        'ORIGIN_FORBIDDEN',
        'Cross-site requests are not allowed',
      );
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store');
  });
  app.addHook('onResponse', async (request, reply) => {
    // Deliberately omit headers, body, raw URL/query, filesystem paths and exception text.
    request.log.info(
      {
        event: 'http.request',
        method: request.method,
        route: request.routeOptions.url ?? 'unmatched',
        statusCode: reply.statusCode,
      },
      'Local API request',
    );
  });
}
export function listenLoopback(app: FastifyInstance, port: number) {
  return app.listen({ host: LOOPBACK_HOST, port });
}

export function redactText(input: string) {
  return input
    .replace(/\bsk-[a-z0-9_-]{8,}/gi, '[REDACTED]')
    .replace(/\bBearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /(\b(?:api[_-]?key|openai_api_key|codex_api_key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    );
}
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 40) return '[TRUNCATED]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        /^(?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|openai_api_key|codex_api_key|access[_-]?token|refresh[_-]?token|password|secret)$/i.test(
          key,
        )
          ? '[REDACTED]'
          : redactValue(field, depth + 1),
      ]),
    );
  return value;
}
