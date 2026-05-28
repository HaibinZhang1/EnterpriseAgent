import type { AppTab } from '../types/desktop';

const tabs: Array<{ id: AppTab; label: string }> = [
  { id: 'agent', label: 'Agent' },
  { id: 'community', label: '社区' },
  { id: 'local', label: '本地' }
];

export function NavTabs({ active, onChange }: { active: AppTab; onChange: (tab: AppTab) => void }) {
  return (
    <nav className="nav-tabs" aria-label="桌面客户端一级导航">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" className={`nav-tab ${active === tab.id ? 'active' : ''}`} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
