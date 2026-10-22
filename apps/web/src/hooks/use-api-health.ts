import { useCallback, useEffect, useState } from 'react';
import type { HealthResponse } from '@worktreeos/shared';
import { fetchHealth } from '@/lib/api';

export type Connection =
  | { status: 'checking' }
  | { status: 'connected'; health: HealthResponse }
  | { status: 'disconnected'; message: string };

export function useApiHealth() {
  const [connection, setConnection] = useState<Connection>({
    status: 'checking',
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    let active = true;
    void fetchHealth(controller.signal)
      .then(
        (health) => {
          if (active) setConnection({ status: 'connected', health });
        },
        () => {
          if (active)
            setConnection({
              status: 'disconnected',
              message:
                'Could not reach the local API. Check that the backend is running.',
            });
        },
      )
      .finally(() => window.clearTimeout(timeout));
    const poll = window.setTimeout(retry, 15000);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
      window.clearTimeout(poll);
    };
  }, [attempt, retry]);

  return { connection, retry };
}
