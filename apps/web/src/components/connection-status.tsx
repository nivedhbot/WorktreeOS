import { Radio, RefreshCw, Server } from 'lucide-react';
import type { Connection } from '@/hooks/use-api-health';
import { Button } from '@/components/ui/button';

export function ConnectionStatus({
  connection,
  retry,
}: {
  connection: Connection;
  retry: () => void;
}) {
  const connected = connection.status === 'connected';
  const label = connected
    ? 'API connected'
    : connection.status === 'checking'
      ? 'Checking API…'
      : 'API disconnected';
  return (
    <section className="connection-panel" aria-label="Backend connectivity">
      <div className="section-heading">
        <span className="eyebrow">
          <Radio size={14} />
          SYSTEM STATUS
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={retry}
          aria-label="Refresh API connection"
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      <div className="connection-title" role="status">
        <span
          className={`status-dot ${connected ? 'online' : connection.status}`}
        />
        <strong>{label}</strong>
      </div>
      <p>
        {connected
          ? 'Your local backend is ready.'
          : connection.status === 'checking'
            ? 'Connecting to your local backend.'
            : connection.message}
      </p>
      <div className="system-detail">
        <Server size={15} />
        <span>Fastify API</span>
        <code>/api/health</code>
      </div>
      <div className="system-detail">
        <span className="detail-indent">Environment</span>
        <span>Local development</span>
      </div>
      <div className="system-detail">
        <span className="detail-indent">API version</span>
        <code>{connected ? connection.health.version : '—'}</code>
      </div>
      <div className="connection-foot">
        <span className="status-dot online" />
        Loopback only<span className="ml-auto">127.0.0.1</span>
      </div>
    </section>
  );
}
