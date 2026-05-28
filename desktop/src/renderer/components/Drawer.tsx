import type { ReactNode } from 'react';
import { Button } from './Button';

export function Drawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-header">
          <h2>{title}</h2>
          <Button tone="ghost" onClick={onClose} aria-label="关闭">x</Button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
