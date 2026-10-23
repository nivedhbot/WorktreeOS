import { useEffect, useState } from 'react';
import {
  eventSchema,
  isActiveRun,
  runStatusSchema,
  type Run,
  type RunEvent,
} from '@worktreeos/shared';
import { api, errorMessage } from '@/lib/api';

type StreamStatus =
  'loading' | 'connecting' | 'live' | 'reconnecting' | 'complete' | 'error';
interface EventState {
  runId: string;
  events: RunEvent[];
  status: StreamStatus;
  error: string | null;
}

export function useRunEvents(
  run: Run | undefined,
  onStatusChange: (event?: RunEvent) => void,
) {
  const id = run?.id;
  const mode = run?.mode;
  const active = run ? isActiveRun(run.status) : false;
  const [state, setState] = useState<EventState | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let source: EventSource | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let cursor: string | undefined;
    let sequence = 0;
    let terminal = false;
    const update = (status: StreamStatus, error: string | null = null) =>
      setState((current) => ({
        runId: id,
        events: current?.runId === id ? current.events : [],
        status,
        error,
      }));
    const connect = () => {
      if (controller.signal.aborted || terminal) return;
      source = new EventSource(
        `/api/runs/${encodeURIComponent(id)}/stream${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`,
      );
      source.onopen = () => {
        if (!controller.signal.aborted) update('live');
      };
      source.addEventListener('run-event', (message: MessageEvent<string>) => {
        if (controller.signal.aborted) return;
        try {
          const event = eventSchema.parse(JSON.parse(message.data) as unknown);
          if (event.runId !== id || event.payload.mode !== mode)
            throw new Error('Invalid run event');
          const status =
            event.type === 'run.status'
              ? runStatusSchema.parse(event.payload.status)
              : null;
          if (event.sequence <= sequence) return;
          sequence = event.sequence;
          cursor = event.id;
          setState((current) => {
            const previous = current?.runId === id ? current.events : [];
            const events = [...previous, event];
            return { runId: id, events, status: 'live', error: null };
          });
          if (status) {
            if (!isActiveRun(status)) {
              terminal = true;
              source?.close();
              update('complete');
            }
            onStatusChange(event);
          }
        } catch {
          source?.close();
          update(
            'error',
            'The event stream returned an invalid event. Reconnect to reload verified history.',
          );
        }
      });
      source.onerror = () => {
        source?.close();
        if (!controller.signal.aborted && !terminal) {
          update(
            'reconnecting',
            'Connection interrupted. Reconnecting from the last event…',
          );
          reconnect = setTimeout(connect, 1500);
        }
      };
    };
    void api
      .events(id, controller.signal)
      .then(({ events, mode: responseMode }) => {
        if (controller.signal.aborted) return;
        if (
          responseMode !== mode ||
          events.some(
            (event) => event.runId !== id || event.payload.mode !== mode,
          )
        )
          throw new Error('Invalid run history');
        cursor = events.at(-1)?.id;
        sequence = events.at(-1)?.sequence ?? 0;
        const lastStatus = [...events]
          .reverse()
          .find((event) => event.type === 'run.status');
        const persistedStatus = lastStatus
          ? runStatusSchema.safeParse(lastStatus.payload.status)
          : null;
        terminal = persistedStatus?.success
          ? !isActiveRun(persistedStatus.data)
          : !active;
        setState({
          runId: id,
          events,
          status: terminal ? 'complete' : 'connecting',
          error: null,
        });
        if (!terminal && active) connect();
        else if (active) onStatusChange(lastStatus);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) update('error', errorMessage(reason));
      });
    return () => {
      controller.abort();
      source?.close();
      if (reconnect) clearTimeout(reconnect);
    };
  }, [id, mode, active, attempt, onStatusChange]);
  return {
    events: state && state.runId === id ? state.events : [],
    status:
      state && state.runId === id ? state.status : ('loading' as StreamStatus),
    error: state && state.runId === id ? state.error : null,
    reconnect: () => setAttempt((value) => value + 1),
  };
}
