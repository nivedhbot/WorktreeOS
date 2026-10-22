# Local operations and troubleshooting

## Start and stop

Use Node 24, npm and Git on PATH. `npm ci` installs from the lockfile; MOCK needs no key. `npm run demo` creates an isolated sample on dynamic loopback ports. `npm run dev` uses `.env`/shell configuration and persistent data (UI 5173 / API 3001 by default). Ctrl+C stops the runner. Never tunnel the API; its boundary assumes a single local user.

For compiled local operation, `npm run build`, then run `npm run start -w @worktreeos/api` and `npm run preview -w @worktreeos/web` in separate terminals. This is not a packaged desktop application or hosted deployment.

## Data and recovery

Default data is `~/.worktreeos/worktreeos.sqlite`, with WAL companions, `scheduler.lock` while running and managed `worktrees/`. Overrides must be absolute paths outside source. Startup applies seven transactional migrations and rejects incompatible future schema versions. Do not edit schema/version rows manually.

For backup, stop all API processes using that data, verify shutdown, then copy the **entire** data directory, including any WAL/SHM files, to a separate location. If worktrees are separate, back up those **and their original Git repositories/metadata**. The database does not contain source files. Keep backups private; objectives/events/paths may contain user content. Restore a matching complete snapshot with its original path relationships while the API is stopped, then revalidate repositories/worktrees. Changed paths can invalidate records/approvals. Never copy a live SQLite file alone or delete a lock to permit concurrent owners.

After crashes, active runs become interrupted; eligible queued MOCK runs may resume. Queued/active real runs require fresh approval. Retry is explicit and creates another record. Live PID ownership blocks a second scheduler; stale locks are validated/reclaimed on normal startup. Inspect worktrees before retrying. A completed simulation is not test evidence.

## Troubleshooting

| Symptom                            | Action                                                                                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PowerShell refuses npm.ps1         | Use `npm.cmd`, including `npm.cmd exec`; no execution-policy change is needed.                                                                                                                                                                  |
| node:sqlite unavailable            | Check Node version; use Node 24, reopen the terminal and run `npm ci`.                                                                                                                                                                          |
| API disconnected                   | Keep the API terminal running and inspect startup errors. In dev, `Invoke-RestMethod http://127.0.0.1:3001/api/health` should return status ok; demo uses its printed port. Align API_PORT/API_TARGET and restart both services.                |
| Port occupied                      | Stop only your own service or change API_PORT. Vite dev uses strict 5173; demo chooses free ports. Do not kill arbitrary Node processes.                                                                                                        |
| Data path rejected                 | Use a full absolute local path, not `./data` or a literal tilde. Keep data/worktrees outside source and registered repos.                                                                                                                       |
| Scheduler already owned            | Stop the other API using that data. Never delete an active lock. Investigate invalid locks; use a new isolated data directory for a demo.                                                                                                       |
| Repository rejected                | Use a committed non-bare local Git root with its own contained .git directory. URLs/UNC/traversal/symlink aliases/nested roots/external metadata are intentionally refused. `git -C "C:/path" rev-parse --show-toplevel` helps locate the root. |
| Worktree creation fails            | Check Git, initial commit, local branch/path and the reported error. Do not force/reset an existing branch.                                                                                                                                     |
| Removal refused                    | Finish/cancel queued writers and inspect tracked/untracked/ignored files and index flags. Preserve wanted files manually; there is no force removal, and branches are retained.                                                                 |
| Task blocked / approval stale      | Check provider-specific prerequisites. MOCK cannot satisfy Codex dependencies. Edits invalidate reviewed context; request/review a fresh approval.                                                                                              |
| Codex unavailable                  | Demo disables it intentionally. In development, resolve CLI authentication/model access outside the app, then reopen the dialog. No key form or automatic fallback exists.                                                                      |
| Codex command denied / usage error | Read the sanitized failure. Read-only with denied escalation limits remain enforced; unavailable interactive approvals fail closed. Resolve setup externally and approve a new run explicitly if appropriate.                                   |
| Browser executable missing         | `npm exec -- playwright install chromium`; Linux may need `--with-deps chromium`. Do not disable browser sandboxing to hide missing setup.                                                                                                      |
| npm lifecycle-script warning       | Review the named dependency's documented script and local npm configuration. Build/verification must pass; the project does not globally weaken install-script policies.                                                                        |

Some Node versions label SQLite experimental. Zod/Rollup annotation and test NO_COLOR/FORCE_COLOR warnings may appear; they are not hidden or treated as test success. See [QA](QA.md) and [SESSION_STATE](SESSION_STATE.md) for actual coverage.

## Failure evidence

Run `npm run verify`, retaining its exit code/output. Browser failures generate ignored reports/traces at printed paths; these may contain local paths and task content. Share minimal sanitized reproduction steps, versions, platform, failing command and response code. Never attach authentication files, .env, whole databases or private source. Redaction covers known patterns only; review evidence yourself.
