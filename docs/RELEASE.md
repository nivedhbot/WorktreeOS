# Production readiness and release checklist

WorktreeOS 0.1.0 targets single-user local use. Milestones 01–10 deliver the application and its verification tooling. GitHub synchronization is authorized for this development audit; a tagged release, license adoption and authenticated model smoke are separate owner choices.

## Implemented safeguards

- [x] Loopback API with socket/Host/Origin guards and sanitized request errors.
- [x] Canonical repository/worktree paths, fixed Git arguments, isolated branches and dirty-tree removal refusal.
- [x] Durable SQLite migrations, append-only events and atomic status transitions.
- [x] Bounded concurrency/queue, cancellation/timeouts, single scheduler ownership and restart recovery.
- [x] Default MOCK execution without model credentials; explicit expiring single-use real approval.
- [x] Official Codex SDK with read-only sandbox, denied escalation, disabled inherited integrations and recursion guards.
- [x] Accessible dialogs/validation, keyboard graph alternatives and responsive read-only mobile controls.
- [x] README onboarding, environment example, architecture, operations/backups and deterministic demo instructions.
- [x] GitHub Actions installs the lockfile and runs quality, Windows/Ubuntu tests, build, MOCK restart smoke and Chromium without model secrets.

## Verification and delivery gates

- [x] Confirm repository and branch: [nivedhbot/WorktreeOS](https://github.com/nivedhbot/WorktreeOS), `main`, version 0.1.0.
- [x] Inspect hosted Windows/Ubuntu success: [run 39896934560](https://github.com/nivedhbot/WorktreeOS/actions/runs/39896934560). Latest-head evidence is recorded in [SESSION_STATE](SESSION_STATE.md).
- [x] Review dependency audit: zero vulnerabilities reported on 2026-10-23; this is dated evidence, not a future guarantee.
- [x] Final local `npm run verify` passed 133 Vitest tests and seven Chromium E2E plus all quality/build checks; `npm run demo:smoke` preserved completed MOCK history through restart. Evidence is recorded in SESSION_STATE.
- [ ] Before a tagged release, inspect hosted jobs at the chosen release commit. Do not infer success from a workflow definition or an earlier commit. Development delivery checks the final pushed HEAD separately.
- [ ] Owner chooses a license and copyright holder/year. **Suggestion: MIT**; no license grant is invented. Review dependency notices before adoption.
- [ ] Review screenshots/recordings for private paths/content and preserve MOCK labels. Existing PNGs show a disposable Windows demo; no GIF/video is claimed.
- [ ] Validate a private stopped backup/restore with original repository/worktree paths on the intended machine. Database recovery tests are not a complete disaster-recovery exercise.
- [ ] Perform any required macOS, Firefox/WebKit and deeper screen-reader/WCAG review before claiming that support.
- [ ] Optional authenticated read-only Codex smoke requires a separate manual request/review/confirm action. Native authenticated cancellation and model availability/quota remain unverified.
- [ ] Choose a version tag/release or desktop packaging scope separately. No remote/multi-user deployment or writable agent mode is included.

## Reproduce locally

```powershell
npm.cmd ci
npm.cmd exec -- playwright install chromium
npm.cmd run verify
npm.cmd run demo:smoke
npm.cmd audit
```

For interactive acceptance, `npm.cmd run demo`, open its printed URL, create the managed worktree and complete MOCK. Inspect Timeline/Changes/Final review and reload history; Enter stops the demo. It uses fresh isolated data, no user repositories or account discovery.

Review `.gitignore` before publishing: local environment files, SQLite/WAL, logs, keys, builds, dependencies and browser reports are excluded. Ignoring a file does not remove it from existing Git history. Keep real user data private and review any deliberately added artifact.

## CI structure

[ci.yml](../.github/workflows/ci.yml) runs on push, pull request and manual dispatch with read-only repository permissions. Ubuntu quality runs lint/typecheck/format. Windows/Ubuntu integration jobs run Vitest, production build through demo smoke, durable MOCK acceptance and Chromium E2E. Failure artifacts expire after seven days. No automatic model calls, application merges or force pushes occur.
