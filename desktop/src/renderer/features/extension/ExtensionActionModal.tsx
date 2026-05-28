import { useState } from 'react';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { primaryActionLabel } from './ExtensionDetailDrawer';
import type { ExtensionSummary, UiError } from '../../types/desktop';

export interface ActionResultView {
  status?: string;
  planTitle?: string;
  warnings: string[];
  steps: Array<{ stepId?: string; action?: string; status?: string; message?: string }>;
  manualInstructions?: string;
  manualInstructionsUrl?: string;
}

export function ExtensionActionModal({
  item,
  busy,
  error,
  result,
  onClose,
  onRun
}: {
  item: ExtensionSummary;
  busy: boolean;
  error?: UiError;
  result?: ActionResultView;
  onClose: () => void;
  onRun: (payload: { targetPath: string; variables: Record<string, string>; installMode?: string; dryRun: boolean }) => void;
}) {
  const [targetPath, setTargetPath] = useState('');
  const [variablesText, setVariablesText] = useState('');
  const [installMode, setInstallMode] = useState('MANUAL_DOWNLOAD');
  return (
    <Modal title={primaryActionLabel(item)} onClose={onClose}>
      <form className="grid" onSubmit={(event) => event.preventDefault()}>
        <p className="muted">Renderer 仅提交目标和参数，实际计划生成、校验、执行都在 Main / Desktop Backend 内完成。</p>
        <label className="field">
          <span>{item.type === 'mcp' ? 'MCP 配置文件路径' : '本地目标路径'}</span>
          <input className="input" value={targetPath} onChange={(event) => setTargetPath(event.target.value)} />
        </label>
        {item.type === 'mcp' ? (
          <label className="field">
            <span>变量，每行 key=value。敏感值只交给 Main 层安全存储。</span>
            <textarea className="textarea" value={variablesText} onChange={(event) => setVariablesText(event.target.value)} />
          </label>
        ) : null}
        {item.type === 'plugin' ? (
          <label className="field">
            <span>安装模式</span>
            <select className="select" value={installMode} onChange={(event) => setInstallMode(event.target.value)}>
              <option value="MANUAL_DOWNLOAD">手动下载记录</option>
              <option value="CONFIG_PLUGIN">写入配置插件</option>
              <option value="MANAGED_PACKAGE">托管包安装</option>
            </select>
          </label>
        ) : null}
        {error ? <ErrorState error={error} title="操作失败" /> : null}
        {result ? <ActionResult result={result} /> : null}
        <div className="card-action-row">
          <Button disabled={busy} onClick={() => onRun({ targetPath, variables: parseVariables(variablesText), installMode, dryRun: true })}>{busy ? '生成中' : 'Dry-run'}</Button>
          <Button
            type="button"
            tone="primary"
            disabled={busy}
            onClick={() => onRun({ targetPath, variables: parseVariables(variablesText), installMode, dryRun: false })}
          >
            执行
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ActionResult({ result }: { result: ActionResultView }) {
  return (
    <section className="panel">
      <header className="section-header">
        <h2>{result.planTitle ?? '执行计划'}</h2>
        <StatusBadge tone={result.status === 'success' ? 'ok' : result.status === 'dry_run' ? 'info' : 'warn'}>{result.status ?? 'planned'}</StatusBadge>
      </header>
      {result.warnings.length > 0 ? <p className="muted">{result.warnings.join('；')}</p> : null}
      {result.manualInstructions || result.manualInstructionsUrl ? (
        <div className="result-note">
          {result.manualInstructions ? <p>{result.manualInstructions}</p> : null}
          {result.manualInstructionsUrl ? <p className="muted">安装说明：{result.manualInstructionsUrl}</p> : null}
        </div>
      ) : null}
      <table className="table">
        <thead>
          <tr>
            <th>步骤</th>
            <th>动作</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {result.steps.map((step, index) => (
            <tr key={step.stepId ?? index}>
              <td>{step.stepId ?? '-'}</td>
              <td>{step.action ?? '-'}</td>
              <td>{step.status ?? step.message ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function parseVariables(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return result;
}
