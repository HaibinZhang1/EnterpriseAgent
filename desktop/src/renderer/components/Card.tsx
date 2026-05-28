import type { ReactNode } from 'react';

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <article className={`card ${className}`} onClick={onClick}>
      {children}
    </article>
  );
}
