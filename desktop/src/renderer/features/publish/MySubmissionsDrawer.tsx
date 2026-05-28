import { Button } from '../../components/Button';
import { Drawer } from '../../components/Drawer';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { StatusBadge } from '../../components/StatusBadge';
import { asText, compactDate, riskTone, statusLabel } from '../../lib/formatting';
import type { LoadState, UiError } from '../../types/desktop';

export function MySubmissionsDrawer({
  state,
  items,
  error,
  onClose,
  onRefresh,
  onWithdraw
}: {
  state: LoadState;
  items: Array<Record<string, unknown>>;
  error?: UiError;
  onClose: () => void;
  onRefresh: () => void;
  onWithdraw: (submissionID: string) => void;
}) {
  return (
    <Drawer title="我的提交" onClose={onClose}>
      <Button onClick={onRefresh}>刷新</Button>
      {state === 'loading' ? <LoadingState label="正在加载提交" /> : null}
      {state === 'error' ? <ErrorState error={error} title="提交列表加载失败" /> : null}
      {state === 'ready' && items.length === 0 ? <EmptyState title="暂无提交" message="还没有发布申请。" /> : null}
      {state === 'ready' && items.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>提交</th>
              <th>类型</th>
              <th>状态</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const id = asText(item.submissionId ?? item.submissionID ?? item.id, String(index));
              return (
                <tr key={id}>
                  <td>{id}</td>
                  <td>{asText(item.extensionType ?? item.type)}</td>
                  <td><StatusBadge tone={riskTone(String(item.status ?? ''))}>{statusLabel(asText(item.status))}</StatusBadge></td>
                  <td>{compactDate(asText(item.createdAt ?? item.createdTime, ''))}</td>
                  <td><Button tone="danger" onClick={() => onWithdraw(id)}>撤回</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </Drawer>
  );
}
