# Release checklist

Milestone 10 prepares local delivery; it does not claim a public release, hosted CI run or authenticated model test.

- [ ] Owner selects a license and supplies the correct copyright holder/year. **Suggestion: MIT**, a simple permissive portfolio license; review its terms/dependency notices before adoption. This suggestion makes no license grant; no LICENSE file is invented on the owner's behalf.
- [ ] Confirm repository root, remote, version and scope. This workspace has no Git history; do not advertise a remote clone URL or CI badge until they exist.
- [ ] From a fresh checkout, follow README: `npm ci`, `npm run demo`, create worktree and complete MOCK without keys. Stop cleanly. Run `npm run demo:smoke` to verify persisted run/events across API restart.
- [ ] Run `npm run verify` and `npm audit`; record actual versions/counts/failures in SESSION_STATE. Do not label unexecuted platforms/browsers as passed.
- [ ] Push the reviewed workflow to the intended hosted repository; inspect Windows and Ubuntu jobs. CI targets Node 24, uses read-only repository permissions, installs from the lockfile and requires no model secrets.
- [ ] Review dependencies/audit findings and preserve local Host/Origin guards, sandbox and consent settings. Do not enable a remote listener.
- [ ] Check empty/loading/error states, skip link, dialog focus/return, validation help, graph text alternative and read-only 320–760px views. Focused Chromium checks are included; comprehensive WCAG/screen-reader certification is not claimed.
- [ ] Review desktop/mobile PNGs and any recorded GIF/video. Inspect private paths/content, preserve MOCK disclosures and record provenance. Never publish a test-written patch as agent output.
- [ ] Confirm .env, SQLite/WAL, logs, authentication, traces, node_modules and builds are excluded. Review ignored artifacts separately before sharing.
- [ ] Review README/QA/CODEX/SESSION_STATE limits. Authenticated Codex smoke remains optional, separately consented and outside demo/CI.
- [ ] Check stop/restart/backups and lock behavior on target platforms. Archive a stopped data snapshot before upgrades; no downgrade migration promise is made.
- [ ] Review the final diff, then explicitly choose the commit/tag/release. No automatic merge, push, upload or publication is included.

## CI structure

[ci.yml](../.github/workflows/ci.yml) runs on push, pull request and manual dispatch. Ubuntu quality checks run lint/typecheck/format. Windows/Ubuntu integration jobs run Vitest, a full build through demo:smoke, durable MOCK acceptance, Chromium installation and E2E. Failure artifacts expire after seven days. It follows official [setup-node](https://github.com/actions/setup-node) and [Playwright CI](https://playwright.dev/docs/ci) guidance.

Local Windows verification is evidence for this checkout. Hosted workflow and Linux success remain pending actual execution; a workflow file alone is not a passing result.
