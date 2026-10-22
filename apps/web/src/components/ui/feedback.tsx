import { AlertCircle, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';

export function ErrorNotice({
  message,
  retry,
  children,
}: {
  message: string;
  retry?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={16} />
      <div>
        {message}
        {children}
      </div>
      {retry && (
        <Button variant="ghost" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle size={18} className="spin" />
      {label}
    </div>
  );
}
