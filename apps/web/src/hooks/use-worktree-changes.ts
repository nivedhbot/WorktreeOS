import { useEffect, useState } from 'react';
import type { z } from 'zod';
import {
  api,
  errorMessage,
  type worktreeDiffSchema,
  type worktreeStatusSchema,
} from '@/lib/api';

export interface Changes {
  id: string;
  status: z.infer<typeof worktreeStatusSchema>;
  patch: z.infer<typeof worktreeDiffSchema>;
}
export function useWorktreeChanges(
  id: string | undefined,
  revision: string | number,
) {
  const [data, setData] = useState<Changes | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void Promise.all([
      api.status(id, controller.signal),
      api.diff(id, controller.signal),
    ])
      .then(([status, patch]) => {
        if (!controller.signal.aborted) {
          setData({ id, status, patch });
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError({ id, message: errorMessage(reason) });
      });
    return () => controller.abort();
  }, [id, revision, attempt]);
  return {
    data: data && data.id === id ? data : null,
    error: error && error.id === id ? error.message : null,
    refresh: () => setAttempt((value) => value + 1),
  };
}
