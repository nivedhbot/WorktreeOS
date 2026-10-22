import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CodexLaunch } from './codex-launch';
import { api } from '@/lib/api';
import type { Approval, Repository, Worktree } from '@worktreeos/shared';

const timestamp = new Date().toISOString();
const repository: Repository = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Selected repository',
  path: 'E:\\repo',
  createdAt: timestamp,
  updatedAt: timestamp,
};
const tree: Worktree = {
  id: '22222222-2222-4222-8222-222222222222',
  taskId: '33333333-3333-4333-8333-333333333333',
  repositoryId: repository.id,
  path: 'E:\\managed\\task',
  branch: 'task/inspect',
  createdAt: timestamp,
  removedAt: null,
};
const approval: Approval = {
  id: '44444444-4444-4444-8444-444444444444',
  taskId: tree.taskId,
  worktreeId: tree.id,
  model: 'gpt-6-luna',
  status: 'pending',
  fingerprint: 'test',
  runId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  expiresAt: new Date(Date.now() + 900000).toISOString(),
  context: {
    repository,
    worktree: tree,
    model: 'gpt-6-luna',
    prerequisiteFingerprint: 'test',
    task: {
      id: tree.taskId,
      repositoryId: repository.id,
      title: 'Reviewed task',
      objective: 'Read README only',
      provider: 'mock',
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  },
};
afterEach(() => vi.restoreAllMocks());
it('queues a request without launching a model and offers only available supported models', async () => {
  vi.spyOn(api, 'codexAvailability').mockResolvedValue({
    models: ['gpt-6-luna'],
    error: null,
  });
  const request = vi.spyOn(api, 'requestApproval').mockResolvedValue(approval);
  const confirm = vi.spyOn(api, 'confirmApproval');
  const requested = vi.fn();
  render(
    <CodexLaunch
      repository={repository}
      tree={tree}
      requested={requested}
      accepted={vi.fn()}
      close={vi.fn()}
    />,
  );
  expect(screen.getByText(/does not launch an agent/i)).toBeInTheDocument();
  expect(screen.getByText(tree.path)).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByText(/Checking configured/)).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole('option', { name: 'gpt-6.1-sol' }),
  ).not.toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Add to approval queue' }),
  );
  await waitFor(() => expect(requested).toHaveBeenCalledWith(approval));
  expect(request).toHaveBeenCalledWith(tree.taskId, tree.id, 'gpt-6-luna');
  expect(confirm).not.toHaveBeenCalled();
});
it('shows the exact reviewed task/context/risk and requires fresh explicit single-run consent', async () => {
  vi.spyOn(api, 'codexAvailability').mockResolvedValue({
    models: ['gpt-6-luna'],
    error: null,
  });
  const confirm = vi
    .spyOn(api, 'confirmApproval')
    .mockRejectedValue(new Error('offline'));
  render(
    <CodexLaunch
      repository={repository}
      tree={tree}
      approval={approval}
      accepted={vi.fn()}
      close={vi.fn()}
    />,
  );
  expect(
    screen.getByText('Repository: Selected repository'),
  ).toBeInTheDocument();
  expect(screen.getByText('Read README only')).toBeInTheDocument();
  expect(screen.getByText(/usage limits and charges/i)).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByText(/Checking configured/)).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole('button', { name: 'Approve and start Codex' }),
  ).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Approve and start Codex' }),
  );
  expect(confirm).toHaveBeenCalledWith(approval.id);
});
