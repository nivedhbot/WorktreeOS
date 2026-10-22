$worktreeos-milestone Execute milestone 01 - Foundation. This is a fresh Git repository with only the starter documents. Implement, do not just plan.

Create npm workspaces: apps/web (Vite React TypeScript), apps/api (Fastify TypeScript), packages/shared (Zod schemas). Set strict TS, linting, formatting, Vitest, .gitignore, .env.example, root npm scripts for dev/test/lint/typecheck/build. Frontend must render a polished dark shell and fetch /api/health from the backend. Backend must bind to 127.0.0.1 by default. Configure frontend API proxy for local development. Use npm.cmd where Windows PowerShell needs it.

Acceptance: npm install, npm run typecheck, npm test, npm run build succeed; npm run dev starts web and API; landing screen displays API connectivity. Add minimal tests. Keep placeholder features visually labeled as not yet available. Update roadmap and SESSION_STATE. Do not implement persistence or agent execution yet.
