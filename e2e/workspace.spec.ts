import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Repository, Task, Worktree } from '@worktreeos/shared';
import { test, expect } from './fixtures.js';

async function register(page: Page, path: string, name: string) {
  await page.goto('/');
  await expect(
    page.getByRole('banner').getByText('API connected', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Register repo', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Repository name').fill(name);
  await dialog.getByLabel('Local Git repository path').fill(path);
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/repos') &&
      response.request().method() === 'POST',
  );
  await dialog
    .getByRole('button', { name: 'Register repository', exact: true })
    .click();
  const record = (await (await response).json()) as Repository;
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('REPOSITORY', { exact: true })).toHaveValue(
    record.id,
  );
  return record;
}
async function createTask(page: Page, title: string, prerequisite?: string) {
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task title', { exact: true }).fill(title);
  await dialog
    .getByLabel('Objective', { exact: true })
    .fill('Inspect README and preserve the original checkout.');
  if (prerequisite)
    await dialog
      .getByLabel('Prerequisites (optional)')
      .selectOption(prerequisite);
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/tasks') &&
      response.request().method() === 'POST',
  );
  await dialog
    .getByRole('button', { name: 'Create task', exact: true })
    .click();
  const record = (await (await response).json()) as Task;
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  return record;
}
async function createTree(page: Page) {
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/worktrees') &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Create worktree', exact: true })
    .click();
  const record = (await (await response).json()) as Worktree;
  await expect(
    page.getByRole('button', { name: 'Start MOCK run', exact: true }),
  ).toBeEnabled();
  return record;
}
const completed = (page: Page) =>
  expect(
    page.getByText('MOCK simulation completed; no real agent was executed', {
      exact: true,
    }),
  ).toBeVisible();

test('edits tasks and renames repositories while preserving history and invalidating old approval', async ({
  page,
  repo,
}) => {
  const repository = await register(page, repo.repoPath, 'Editable repository');
  const task = await createTask(page, 'Original task');
  const tree = await createTree(page);
  await page
    .getByRole('button', { name: 'Start MOCK run', exact: true })
    .click();
  await completed(page);
  const runId = await page.getByLabel('Run history').inputValue();
  const approvalResponse = await page.request.post(
    `/api/tasks/${task.id}/approvals`,
    { data: { worktreeId: tree.id, model: 'gpt-6-luna' } },
  );
  expect(approvalResponse.status()).toBe(201);
  const approval = (await approvalResponse.json()) as { id: string };
  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task title', { exact: true }).fill('Revised task');
  await dialog
    .getByLabel('Objective', { exact: true })
    .fill('Review the revised objective.');
  await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Revised task', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Run history')).toHaveValue(runId);
  expect(
    (await (await page.request.get(`/api/approvals/${approval.id}`)).json())
      .status,
  ).toBe('invalidated');
  await page
    .getByRole('button', { name: 'Rename repository', exact: true })
    .click();
  await expect(dialog.getByLabel('Local Git repository path')).toHaveAttribute(
    'readonly',
    '',
  );
  await dialog.getByLabel('Repository name').fill('Renamed repository');
  await dialog
    .getByRole('button', { name: 'Save repository', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('Run history')).toHaveValue(runId);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Revised task', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Revised task', exact: true })
      .getByText('Review the revised objective.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Run history')).toHaveValue(runId);
  const saved = (await (
    await page.request.get(`/api/repos/${repository.id}`)
  ).json()) as Repository;
  expect(saved.name).toBe('Renamed repository');
  expect(saved.path).toBe(repository.path);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('button', { name: 'Edit task', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Rename repository', exact: true }),
  ).toBeDisabled();
});

test('announces loading, supports keyboard dialog focus and fits narrow viewports', async ({
  page,
  repo,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/repos', async (route) => {
    if (route.request().method() === 'GET') await gate;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Loading your local workspace' }),
    ).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Skip to content' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  } finally {
    release();
  }
  await page.unrouteAll({ behavior: 'wait' });
  await register(page, repo.repoPath, 'Keyboard and responsive audit');
  const trigger = page.getByRole('button', { name: 'New task', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Create a task' });
  await expect(dialog).toBeVisible();
  const title = dialog.getByLabel('Task title', { exact: true });
  await expect(title).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog.getByRole('button', { name: 'Close dialog' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(title).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  for (const width of [320, 760, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    if (width <= 760) await expect(trigger).toBeDisabled();
    else await expect(trigger).toBeEnabled();
  }
});

test('registration, task creation, real SSE timeline, tracked/untracked diff and final review', async ({
  page,
  request,
  repo,
}, testInfo) => {
  const repository = await register(page, repo.repoPath, 'Browser workflow');
  const task = await createTask(page, 'Inspect browser fixture');
  expect(
    (await (await request.get(`/api/tasks/${task.id}/runs`)).json()).runs,
  ).toEqual([]);
  const tree = await createTree(page);
  const stream = page.waitForResponse(
    (response) =>
      response.url().includes('/stream') &&
      response.request().resourceType() === 'eventsource',
  );
  await page
    .getByRole('button', { name: 'Start MOCK run', exact: true })
    .click();
  expect((await stream).headers()['content-type']).toContain(
    'text/event-stream',
  );
  await expect(
    page.getByText('MOCK: simulated tool inspection; no command executed', {
      exact: true,
    }),
  ).toBeVisible();
  await completed(page);
  writeFileSync(
    join(tree.path, 'README.md'),
    'Initial content\nAdded by browser fixture <script>not executable</script>\n',
  );
  writeFileSync(join(tree.path, 'notes.txt'), 'Untracked review note\n');
  await page.getByRole('tab', { name: 'Changes', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Git diff', exact: true }),
  ).toContainText('Added by browser fixture <script>not executable</script>');
  const patch = page.getByRole('region', { name: 'Git diff', exact: true });
  const firstLine = await patch.locator('.diff-line').first().boundingBox();
  const addedLine = await patch
    .locator('.diff-add')
    .filter({ hasText: 'Added by browser fixture' })
    .boundingBox();
  expect(firstLine).not.toBeNull();
  expect(addedLine).not.toBeNull();
  expect(addedLine!.y).toBeGreaterThan(firstLine!.y);
  await expect(page.getByText('notes.txt', { exact: true })).toBeVisible();
  expect(readFileSync(join(repo.repoPath, 'README.md'), 'utf8')).toBe(
    'Initial content\n',
  );
  await page.getByRole('tab', { name: 'Final review', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review before merging' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'WorktreeOS does not merge, push, reset, or delete worktrees from this screen.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Git diff', exact: true }),
  ).toContainText('Added by browser fixture');
  expect(
    (
      await (
        await request.delete(`/api/worktrees/${tree.id}`, {
          data: { confirm: true },
        })
      ).json()
    ).error.code,
  ).toBe('DIRTY_WORKTREE');
  expect(
    (await (await request.get(`/api/repos/${repository.id}`)).json()).path,
  ).toBe(repo.repoPath);
  await page.screenshot({
    path: testInfo.outputPath('dashboard-review.png'),
    fullPage: true,
  });
});

test('cancels, explicitly retries, and reloads durable run and SSE history', async ({
  page,
  request,
  repo,
}) => {
  const repository = await register(
    page,
    repo.repoPath,
    'Browser cancellation',
  );
  const task = await createTask(page, 'Cancel and retry fixture');
  await createTree(page);
  await page
    .getByRole('button', { name: 'Start MOCK run', exact: true })
    .click();
  await expect(
    page.getByText('MOCK: planning a simulated task', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry MOCK run', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Retry MOCK run', exact: true })
    .click();
  await completed(page);
  const records = (
    await (await request.get(`/api/tasks/${task.id}/runs`)).json()
  ).runs;
  expect(records.map((run: { status: string }) => run.status)).toEqual([
    'canceled',
    'completed',
  ]);
  expect(records[1].retryOf).toBe(records[0].id);
  await page.reload();
  await page
    .getByLabel('REPOSITORY', { exact: true })
    .selectOption(repository.id);
  await expect(
    page.getByRole('heading', { name: task.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Run history').getByRole('option')).toHaveCount(
    2,
  );
  await completed(page);
});

test('builds a DAG with keyboard controls, rejects a cycle, and gates execution until prerequisites complete', async ({
  page,
  request,
  repo,
}, testInfo) => {
  await register(page, repo.repoPath, 'Browser dependency graph');
  const a = await createTask(page, 'Prerequisite task');
  const b = await createTask(page, 'Dependent task', a.id);
  await createTree(page);
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Dependencies & approvals', exact: true })
    .click();
  const readiness = page.getByRole('list', { name: 'Task readiness' });
  await expect(
    readiness.getByRole('listitem').filter({ hasText: b.title }),
  ).toContainText('MOCK blocked');
  await expect(
    page.locator('.dependency-canvas .react-flow__node'),
  ).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Start MOCK run', exact: true })
    .click();
  await expect(
    page.getByText(/MOCK prerequisites must complete/),
  ).toBeVisible();
  await page
    .getByRole('form', { name: 'Edit task prerequisites' })
    .getByRole('combobox', { name: 'Dependent task', exact: true })
    .selectOption(a.id);
  await page
    .getByRole('form', { name: 'Edit task prerequisites' })
    .getByRole('combobox', { name: 'Prerequisite task', exact: true })
    .selectOption(b.id);
  const add = page.getByRole('button', {
    name: 'Add prerequisite',
    exact: true,
  });
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('This prerequisite would create a dependency cycle'),
  ).toBeVisible();
  const graph = await (await request.get('/api/graph')).json();
  expect(graph.dependencies).toContainEqual({
    taskId: b.id,
    dependsOnId: a.id,
  });
  expect(graph.dependencies).not.toContainEqual({
    taskId: a.id,
    dependsOnId: b.id,
  });
  await readiness.getByRole('button', { name: a.title, exact: true }).click();
  await createTree(page);
  await page
    .getByRole('button', { name: 'Start MOCK run', exact: true })
    .click();
  await completed(page);
  await expect(
    readiness.getByRole('listitem').filter({ hasText: b.title }),
  ).toContainText('MOCK runnable');
  await readiness.getByRole('button', { name: b.title, exact: true }).click();
  await page
    .getByRole('button', { name: 'Start MOCK run', exact: true })
    .click();
  await completed(page);
  await page
    .getByLabel('Task dependency graph', { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.locator('.dependency-canvas .react-flow__node'),
  ).toHaveCount(2);
  for (const node of await page
    .locator('.dependency-canvas .react-flow__node')
    .all()) {
    await expect(node).toBeVisible();
    await expect(node).toBeInViewport();
  }
  await page.screenshot({
    path: testInfo.outputPath('dependency-graph.png'),
    fullPage: true,
  });
});

test('queues and explicitly approves exactly one Codex fake run, with no automatic start or fabricated usage', async ({
  page,
  request,
  repo,
}) => {
  await register(page, repo.repoPath, 'Browser approvals');
  const task = await createTask(page, 'Approve fake Codex task');
  await createTree(page);
  await page
    .getByRole('button', { name: 'Start Codex run…', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('option', { name: 'gpt-6.1-sol', exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Add to approval queue' }),
  ).toBeEnabled();
  const queued = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/tasks/${task.id}/approvals`) &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Add to approval queue' }).click();
  const approval = await (await queued).json();
  expect(
    (await (await request.get(`/api/tasks/${task.id}/runs`)).json()).runs,
  ).toEqual([]);
  await page
    .getByRole('button', { name: 'Review and approve', exact: true })
    .click();
  await expect(dialog.getByText(/Usage limits and charges/)).toBeVisible();
  await expect(
    dialog.getByRole('combobox', { name: 'Model', exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Approve and start Codex' }),
  ).toBeDisabled();
  await dialog.getByRole('checkbox').focus();
  await page.keyboard.press('Space');
  await dialog.getByRole('button', { name: 'Approve and start Codex' }).click();
  await expect(
    page.getByText('E2E fake Codex provider; no model called', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Codex read-only run completed', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Actual tokens:/)).toHaveCount(0);
  const duplicate = await request.post(
    `/api/approvals/${approval.id}/confirm`,
    { data: { acknowledgeRisk: true } },
  );
  expect(duplicate.status()).toBe(409);
  const runs = (await (await request.get(`/api/tasks/${task.id}/runs`)).json())
    .runs;
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({
    mode: 'CODEX',
    threadId: 'e2e-fake-thread',
    usage: null,
  });
  await expect(
    page.getByRole('button', { name: 'Start MOCK run', exact: true }),
  ).toBeEnabled();
});

test('shows a real request failure, recovers after reload, and enforces mobile read-only controls', async ({
  page,
  repo,
}, testInfo) => {
  const repository = await register(page, repo.repoPath, 'Browser resilience');
  const task = await createTask(page, 'Mobile inspection task');
  await page.route('**/api/tasks?**', (route) =>
    route.abort('connectionrefused'),
  );
  await page.reload();
  await expect(page.getByText(/Could not reach the local API/)).toBeVisible();
  await page.unroute('**/api/tasks?**');
  await page.reload();
  await page
    .getByLabel('REPOSITORY', { exact: true })
    .selectOption(repository.id);
  await expect(
    page.getByRole('heading', { name: task.title, exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText(/Read-only mobile view/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'New task', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Create worktree', exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath('mobile-read-only.png'),
    fullPage: true,
  });
});
