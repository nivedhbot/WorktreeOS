# WorktreeOS Codex Starter Pack

This archive contains project instructions, a reusable local Codex skill and ten one-milestone prompts. It intentionally does not prebuild the application; Codex will create source files in milestone 01.

## Windows PowerShell setup
1. Extract the entire contents of this archive into a new folder, e.g. `$HOME\WorktreeOS`, including the `.agents` folder.
2. In PowerShell: `cd $HOME\WorktreeOS`; `git init`; `node --version`; `npm.cmd --version`; `codex.cmd --version`.
3. Start `codex.cmd -m gpt-6.1-sol` (if model unavailable, use `/model` to choose an available one).
4. Paste the complete text of `prompts/01-foundation.md` into Codex. The `$worktreeos-milestone` skill is available in the repository under `.agents/skills/`.
5. After each prompt, inspect `/diff`, run verified commands, and commit accepted work: `git add . && git commit -m "..."`.
6. Read `docs/SESSION_STATE.md`; proceed with the next numbered prompt only when acceptance tests pass.
7. Use Luna for small repairs/docs, Sol for main development, Astra only for hard reasoning or unsafe edge cases.
8. `/status` and `/usage` show usage; `/compact` is helpful after lengthy interactions. Do not repeatedly paste complete source files.

## Skill guidance
- Local `$worktreeos-milestone` is included and invoked by every prompt.
- Optional skill: `$playwright` for browser QA after milestone 05; install through `$skill-installer` if missing.
- Optional skill: `$gh-fix-ci` only for actual failing GitHub Action checks.
- `$openai-docs` only for up-to-date SDK/API behavior if the installed package documentation is insufficient.
- Skills focus scope and reuse instructions; they do not guarantee a reduction in billed credits.

## Read next
- `docs/PRODUCT.md`: product design and safeguards.
- `docs/ROADMAP.md`: milestones/acceptance.
- `AGENTS.md`: persistent engineering constraints.
- `prompts/01-foundation.md` through `prompts/10-polish.md`: executable tasks.

## Safety
Mock runs first. WorktreeOS itself may consume additional Codex account usage when you explicitly run real agents. Never choose `--yolo` or unsafe sandbox bypass to fix permission friction.
