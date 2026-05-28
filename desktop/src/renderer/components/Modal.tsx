import type { ReactNode } from 'react';
import { Button } from './Button';

export function Modal({ title, children, onClose, size = 'regular' }: { title: string; children: ReactNode; onClose: () => void; size?: 'regular' | 'small' }) {
  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <section className={`modal ${size === 'small' ? 'small' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <Button tone="ghost" onClick={onClose} aria-label="关闭">x</Button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </>
  );
}
