import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Real Git/process fixtures are CPU/IO intensive on Windows; cap workers rather than racing dozens of processes.
    maxWorkers: 4,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
