import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, root, 'API_');
  const target = env.API_TARGET ?? `http://127.0.0.1:${env.API_PORT ?? 3001}`;
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5173, strictPort: true, proxy: { '/api': { target } } },
    preview: { proxy: { '/api': { target } } },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      restoreMocks: true,
    },
  };
});
