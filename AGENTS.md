# WorktreeOS contributor guidance

## Product
WorktreeOS is a local-first desktop-browser dashboard for coordinating AI coding tasks in isolated Git worktrees. It must add Git-worktree task orchestration, inspection and evidence instead of recreating a general-purpose chat app.

## Stack (do not change without a concrete blocker)
- npm workspaces and TypeScript strict mode.
- apps/web: React + Vite, Tailwind CSS, shadcn/ui, React Flow.
- apps/api: Fastify, SQLite, Zod validation, Server-Sent Events.
- packages/shared: shared schemas and discriminated types.
- Real-agent adapter: official @openai/codex-sdk, introduced only at milestone 06.
- Testing: Vitest/unit and integration; Playwright end-to-end at milestone 09.

## Project standards
- Work from the repository root containing this file. Read docs/PRODUCT.md, docs/ROADMAP.md and docs/SESSION_STATE.md, then inspect files relevant to the requested task.
- Follow the user's requested scope, whether it is a numbered milestone or repository maintenance. No surprise features, migrations, framework changes, or broad speculative refactors.
- Prioritize a working vertical slice over abstractions and placeholders. Mocked runs must be visibly labeled MOCK; never display fake real-agent output.
- Use safe cross-platform Node process APIs. Never compose Git or Codex commands from untrusted input in a shell string.
- Git operations require an explicit allowed repository root. Canonicalize paths and prohibit traversal/escaping through symlinks.
- Never force-delete worktrees, merge branches, reset user files, change permissions, or run real agent tasks without an explicit user action.
- Default to offline mock execution; actual model calls must be opt-in and not part of CI.
- Bind services to 127.0.0.1 by default; do not expose a remote process-execution API or tokens.
- Follow the user's configured YOLO workflow for your own assigned coding tasks and work autonomously without repeated approval prompts for already-authorized actions. This does not authorize weakening WorktreeOS's real Codex approval or sandbox controls. SDK runs may not expose per-command interactive approvals: use restrictive sandboxing and fail closed if an action needs escalation.
- Never delete, overwrite, or clean up unrelated user files or work. Preserve unrelated changes and artifacts.
- Dependencies should be few, well-supported and compatible with Windows PowerShell.

## Workflow
- Reuse existing code and avoid duplicate utilities.
- Install with `npm ci`; use the root npm workspace scripts. Keep dependencies declared by the package that imports them.
- Work autonomously on assigned tasks, using the existing project instructions and reasonable implementation judgment. Ask only when a material decision or authorization is genuinely missing; do not repeat approval requests for actions already authorized.
- Add or update targeted tests for behavior changes. Run targeted tests first; run lint, typecheck and build for the affected workspace.
- If checks fail, diagnose and repair in the same milestone. Do not endlessly rerun failing commands without changing anything.
- Run the relevant tests and checks, fix errors introduced by the change, and verify the result before creating commits. If a check cannot run, report the blocker accurately instead of claiming it passed.
- For substantial development, organize related work into five or six meaningful commits when the change naturally supports that many batches. Use fewer commits for smaller changes; never create empty, fake, or unnecessary commits to meet a target.
- Keep each commit focused on related changes and give it a short, descriptive message. Never use a colon in a commit message.
- Use only the user's configured Git identity. Do not change Git identity settings or add `Co-authored-by`, collaborator, AI attribution, or other author trailers.
- Push completed, verified commits to the user's GitHub repository only when explicitly requested. Never force-push or overwrite remote history.
- At the end of each milestone update docs/SESSION_STATE.md: changed files, verification commands/results, blockers, and next milestone.
- Response summary: changed, tests, known limits, next step. Maximum 150 words. Do not paste entire files into the response.
