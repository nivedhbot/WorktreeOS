import { randomUUID } from 'node:crypto';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import {
  exampleRepository,
  exampleRun,
  exampleTask,
  exampleTree,
  FakeEventSource,
  jsonResponse,
  mockApi,
  statusEvent,
} from './test/api-fixture';

function click(element: HTMLElement) {
  fireEvent.mouseDown(element, { button: 0, ctrlKey: false });
  fireEvent.click(element);
}
beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('dashboard workflow', () => {
  it('registers a repository and creates a validated task without starting a run automatically', async () => {
    const api = mockApi();
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    click(
      await screen.findByRole('button', {
        name: 'Register your first repository',
      }),
    );
    const registration = screen.getByRole('dialog', {
      name: 'Register a repository',
    });
    fireEvent.change(within(registration).getByLabelText('Repository name'), {
      target: { value: 'My project' },
    });
    fireEvent.change(
      within(registration).getByLabelText('Local Git repository path'),
      { target: { value: 'C:/Projects/my-project' } },
    );
    click(
      within(registration).getByRole('button', { name: 'Register repository' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('REPOSITORY')).toHaveValue(
      api.state.repositories[0]!.id,
    );
    click(screen.getByRole('button', { name: 'New task' }));
    const form = screen.getByRole('dialog', { name: 'Create a task' });
    click(within(form).getByRole('button', { name: 'Create task' }));
    expect(within(form).getByLabelText('Task title')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    fireEvent.change(within(form).getByLabelText('Task title'), {
      target: { value: '  Improve navigation  ' },
    });
    fireEvent.change(within(form).getByLabelText('Objective'), {
      target: { value: 'Make the workspace easier to explore.' },
    });
    click(within(form).getByRole('button', { name: 'Create task' }));
    expect(
      await screen.findByRole('heading', { name: 'Improve navigation' }),
    ).toBeInTheDocument();
    expect(api.state.tasks[0]).toMatchObject({
      title: 'Improve navigation',
      provider: 'mock',
    });
    expect(
      screen.getByRole('button', { name: 'Start MOCK run' }),
    ).toBeDisabled();
    expect(
      api.fetch.mock.calls.some(
        ([url, options]) =>
          String(url).endsWith('/runs') && options?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('surfaces repository rejection inside its dialog and keeps input for correction', async () => {
    const api = mockApi();
    api.intercepts.set('POST /api/repos', () =>
      jsonResponse(
        {
          error: {
            code: 'INVALID_REPOSITORY_PATH',
            message: 'Path must be an existing local Git root',
          },
        },
        400,
      ),
    );
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    click(
      await screen.findByRole('button', {
        name: 'Register your first repository',
      }),
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Repository name'), {
      target: { value: 'Invalid' },
    });
    fireEvent.change(
      within(dialog).getByLabelText('Local Git repository path'),
      { target: { value: 'C:/not-a-repo' } },
    );
    click(within(dialog).getByRole('button', { name: 'Register repository' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'existing local Git root',
    );
    expect(
      within(dialog).getByLabelText('Local Git repository path'),
    ).toHaveValue('C:/not-a-repo');
  });

  it('creates a worktree only on request, starts MOCK, and renders deduplicated live progress', async () => {
    const repository = exampleRepository();
    const task = exampleTask(repository.id);
    const api = mockApi({ repositories: [repository], tasks: [task] });
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    click(await screen.findByRole('button', { name: 'Create worktree' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Start MOCK run' }),
      ).toBeEnabled(),
    );
    click(screen.getByRole('button', { name: 'Start MOCK run' }));
    expect(
      await screen.findByRole('button', { name: 'Cancel run' }),
    ).toBeEnabled();
    await waitFor(() =>
      expect(FakeEventSource.instances.length).toBeGreaterThan(0),
    );
    const source = FakeEventSource.instances.at(-1)!;
    const run = api.state.runs[0]!;
    const progress = {
      id: randomUUID(),
      runId: run.id,
      sequence: 2,
      type: 'mock.progress',
      payload: {
        mode: 'MOCK',
        percent: 80,
        message: 'MOCK live progress from the API',
      },
      createdAt: run.createdAt,
    };
    act(() => {
      source.onopen?.();
      source.emit(progress);
      source.emit(progress);
    });
    expect(screen.getAllByText('MOCK live progress from the API')).toHaveLength(
      1,
    );
    expect(
      screen.getByRole('progressbar', { name: 'MOCK simulation progress' }),
    ).toHaveValue(80);
    api.state.events.push(progress);
    run.status = 'completed';
    const completed = statusEvent(run, 3);
    api.state.events.push(completed);
    act(() => source.emit(completed));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Cancel run' }),
      ).not.toBeInTheDocument(),
    );
    expect(source.closed).toBe(true);
    expect(await screen.findByText('MOCK run completed')).toBeInTheDocument();
  });

  it('cancels and retries with a distinct run, preserving old history', async () => {
    const repository = exampleRepository();
    const task = exampleTask(repository.id);
    const tree = exampleTree(task);
    const run = exampleRun(task, tree);
    const api = mockApi({
      repositories: [repository],
      tasks: [task],
      trees: [tree],
      runs: [run],
      events: [statusEvent(run, 1)],
    });
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    click(await screen.findByRole('button', { name: 'Cancel run' }));
    click(await screen.findByRole('button', { name: 'Retry MOCK run' }));
    await waitFor(() => expect(api.state.runs).toHaveLength(2));
    expect(api.state.runs[0]!.status).toBe('canceled');
    expect(api.state.runs[1]!.retryOf).toBe(run.id);
    expect(
      await screen.findByRole('button', { name: 'Cancel run' }),
    ).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Run history'), {
      target: { value: run.id },
    });
    expect(await screen.findByText('MOCK run canceled')).toBeInTheDocument();
  });

  it('shows changed files and escaped Git patches, then requires confirmation before removal', async () => {
    const repository = exampleRepository();
    const task = exampleTask(repository.id);
    const tree = exampleTree(task);
    const api = mockApi({
      repositories: [repository],
      tasks: [task],
      trees: [tree],
    });
    api.intercepts.set(`GET /api/worktrees/${tree.id}/status`, () =>
      jsonResponse({
        worktreeId: tree.id,
        clean: false,
        files: [
          { path: 'README.md', status: ' M' },
          { path: 'new.txt', status: '??' },
        ],
      }),
    );
    api.intercepts.set(`GET /api/worktrees/${tree.id}/diff`, () =>
      jsonResponse({
        worktreeId: tree.id,
        diff: 'diff --git a/README.md b/README.md\n-old\n+<script>alert(1)</script>\n',
        untrackedFiles: ['new.txt'],
      }),
    );
    api.intercepts.set(`DELETE /api/worktrees/${tree.id}`, () =>
      jsonResponse(
        {
          error: {
            code: 'DIRTY_WORKTREE',
            message: 'Worktree contains changes; removal would lose files',
          },
        },
        409,
      ),
    );
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    click(await screen.findByRole('tab', { name: 'Changes' }));
    expect(
      await screen.findByText('README.md', { selector: 'code' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Git diff' })).toHaveTextContent(
      '+<script>alert(1)</script>',
    );
    expect(document.querySelector('script')).toBeNull();
    expect(
      screen.getByText(/Untracked files are listed above/),
    ).toBeInTheDocument();
    click(screen.getByRole('button', { name: 'Remove managed worktree' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Remove this worktree?',
    });
    expect(
      within(dialog).getByRole('button', { name: 'Confirm removal' }),
    ).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    click(within(dialog).getByRole('button', { name: 'Confirm removal' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'removal would lose files',
    );
    const deletion = api.fetch.mock.calls.find(
      ([url, options]) =>
        String(url).includes(tree.id) && options?.method === 'DELETE',
    );
    expect(JSON.parse(String(deletion?.[1]?.body))).toEqual({ confirm: true });
  });

  it('switches repositories without leaking the prior tasks and filters list/board views', async () => {
    const first = exampleRepository();
    const second = { ...exampleRepository(), name: 'Second repository' };
    const ready = exampleTask(first.id, 'Ready idea');
    const done = exampleTask(first.id, 'Finished idea');
    const other = exampleTask(second.id, 'Another repository task');
    const tree = exampleTree(done);
    const run = exampleRun(done, tree, 'completed');
    const api = mockApi({
      repositories: [first, second],
      tasks: [ready, done, other],
      trees: [tree],
      runs: [run],
    });
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    const tasksPanel = await screen.findByRole('region', { name: /^Tasks/ });
    click(within(tasksPanel).getByRole('button', { name: 'Completed' }));
    expect(
      within(tasksPanel).queryByText('Ready idea'),
    ).not.toBeInTheDocument();
    expect(within(tasksPanel).getByText('Finished idea')).toBeInTheDocument();
    click(within(tasksPanel).getByRole('button', { name: 'Board view' }));
    expect(
      within(tasksPanel).getByRole('region', { name: 'Review tasks' }),
    ).toHaveTextContent('Finished idea');
    fireEvent.change(screen.getByLabelText('REPOSITORY'), {
      target: { value: second.id },
    });
    expect(
      await screen.findByRole('heading', { name: 'Another repository task' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Finished idea')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), {
      target: { value: 'no match' },
    });
    expect(screen.getByText('No matching tasks')).toBeInTheDocument();
  });

  it('keeps mobile mutation controls disabled while allowing read-only inspection', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const repository = exampleRepository();
    const task = exampleTask(repository.id);
    const tree = exampleTree(task);
    const api = mockApi({
      repositories: [repository],
      tasks: [task],
      trees: [tree],
    });
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    expect(
      await screen.findByRole('button', { name: 'Start MOCK run' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Register repo' }),
    ).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('Read-only mobile view');
    click(screen.getByRole('tab', { name: 'Changes' }));
    expect(
      await screen.findByText('No tracked or untracked changes.'),
    ).toBeInTheDocument();
  });

  it('rejects malformed responses without claiming a loaded workspace', async () => {
    const api = mockApi();
    api.intercepts.set('GET /api/repos', () =>
      jsonResponse({ unexpected: true }),
    );
    api.intercepts.set('GET /api/health', () => jsonResponse({ status: 'ok' }));
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    expect(
      await screen.findByText(/frontend and backend versions match/),
    ).toBeInTheDocument();
    expect(screen.getAllByText('API disconnected').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('region', { name: 'Selected repository totals' }),
    ).not.toBeInTheDocument();
  });

  it('recovers the API connection after a network error and explicit retry', async () => {
    const api = mockApi();
    api.intercepts.set('GET /api/health', () => {
      throw new Error('Network offline');
    });
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    expect(
      (await screen.findAllByText('API disconnected')).length,
    ).toBeGreaterThan(0);
    api.intercepts.delete('GET /api/health');
    click(
      within(screen.getByRole('banner')).getByRole('button', {
        name: 'Refresh API connection',
      }),
    );
    expect(
      (await screen.findAllByText('API connected')).length,
    ).toBeGreaterThan(0);
  });
});
