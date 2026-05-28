import type { ReactNode } from 'react';

export function StatusBadge({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'info' }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}
