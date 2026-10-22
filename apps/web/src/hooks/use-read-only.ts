import { useEffect, useState } from 'react';

export function useReadOnlyViewport() {
  const [readOnly, setReadOnly] = useState(
    () => window.matchMedia?.('(max-width: 760px)').matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 760px)');
    if (!query) return;
    const change = () => setReadOnly(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return readOnly;
}
