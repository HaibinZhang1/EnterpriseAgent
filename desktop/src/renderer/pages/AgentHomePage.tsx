import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { asText } from '../lib/formatting';
import type { AppTab, DeviceSummary, OfflineState, SessionUser, UpdateState } from '../types/desktop';

export function AgentHomePage({
  user,
  device,
  offline,
  updateState,
  onGo,
  onOpenSettings,
  onOpenUpdate
}: {
  user?: SessionUser;
  device?: DeviceSummary;
  offline?: OfflineState;
  updateState?: UpdateState;
  onGo: (tab: AppTab) => void;
  onOpenSettings: () => void;
  onOpenUpdate: () => void;
}) {
  return (
    <main className="page" aria-label="Agent 首页">
      <header className="page-header">
        <div className="page-title">
          <h1>Agent 工作台</h1>
          <span className="muted">{user ? `当前账号：${user.displayName ?? user.username ?? '已登录'}` : '请登录后使用企业扩展能力'}</span>
        </div>
        <div className="card-action-row">
          <Button onClick={() => onGo('community')} tone="primary">进入社区</Button>
          <Button onClick={() => onGo('local')}>查看本地</Button>
          <Button onClick={onOpenSettings}>设置</Button>
        </div>
      </header>

      <section className="grid cols-3">
        <Card>
          <div className="section-header">
            <h3>设备状态</h3>
            <StatusBadge tone={offline?.online === false ? 'warn' : 'ok'}>{offline?.online === false ? '离线' : '在线'}</StatusBadge>
          </div>
          <p className="muted">Device ID</p>
          <strong className="truncate">{asText(device?.deviceID)}</strong>
          <div className="card-action-row">
            <StatusBadge>{asText(device?.clientVersion, '未知版本')}</StatusBadge>
            <StatusBadge>{asText(device?.arch, '未知架构')}</StatusBadge>
          </div>
        </Card>

        <Card>
          <div className="section-header">
            <h3>本地管理</h3>
            <StatusBadge tone="info">本机</StatusBadge>
          </div>
          <p className="muted">查看本机已安装扩展、工具和项目配置。</p>
          <Button onClick={() => onGo('local')}>查看本地</Button>
        </Card>

        <Card>
          <div className="section-header">
            <h3>客户端更新</h3>
            <StatusBadge tone={updateState?.state === 'available' ? 'warn' : 'info'}>{updateState?.state ?? '未检查'}</StatusBadge>
          </div>
          <p className="muted">{updateState?.version ? `版本 ${updateState.version}` : '通过 Main 层更新服务完成下载、验签和安装确认。'}</p>
          <Button onClick={onOpenUpdate}>检查更新</Button>
        </Card>
      </section>
    </main>
  );
}
