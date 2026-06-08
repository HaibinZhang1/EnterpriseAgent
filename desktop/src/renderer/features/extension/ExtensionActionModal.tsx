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
  artifactPath?: string;
  targetPath?: string;
  syncStatus?: string;
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
  onOpenLocal,
  onRun
}: {
  item: ExtensionSummary;
  busy: boolean;
  error?: UiError;
  result?: ActionResultView;
  onClose: () => void;
  onOpenLocal?: () => void;
  onRun: (payload: { targetPath: string; variables: Record<string, string>; installMode?: string; adapterId?: string; operation?: string; dryRun: boolean }) => void;
}) {
  const [adapterId, setAdapterId] = useState(item.type === 'skill' ? 'codex' : 'custom-directory');
  const [targetPath, setTargetPath] = useState(defaultTargetPath(item, item.type === 'skill' ? 'codex' : 'custom-directory'));
  const [variablesText, setVariablesText] = useState('');
  const [installMode, setInstallMode] = useState('MANUAL_DOWNLOAD');
  const [operation, setOperation] = useState('');
  const pathIssue = targetPathIssue(targetPath);
  const preview = targetPreview(item, targetPath);
  const setDefaultPath = (nextAdapterId = adapterId) => setTargetPath(defaultTargetPath(item, nextAdapterId));
  const chooseFolder = (file: File | undefined) => {
    const selected = folderPathFromFile(file);
    if (selected) setTargetPath(selected);
  };
  return (
    <Modal title={primaryActionLabel(item)} onClose={onClose}>
      <form className="grid" onSubmit={(event) => event.preventDefault()}>
        <p className="muted">Renderer 仅提交目标和参数，实际计划生成、校验、执行都在 Main / Desktop Backend 内完成。</p>
        <label className="field">
          <span>{item.type === 'mcp' ? 'MCP 配置文件路径' : '本地目标路径'}</span>
          <input className="input" data-testid="extension-target-path" aria-label="本地目标路径" value={targetPath} onChange={(event) => setTargetPath(event.target.value)} />
        </label>
        <div className="card-action-row">
          <Button type="button" onClick={() => setDefaultPath()}>{item.type === 'skill' ? 'Codex 默认目录' : '推荐路径'}</Button>
          <label className="button secondary" aria-label="选择目标文件夹">
            选择文件夹
            <input type="file" style={{ display: 'none' }} onChange={(event) => chooseFolder(event.target.files?.[0])} {...directoryPickerProps()} />
          </label>
        </div>
        {pathIssue ? <p className="muted">{pathIssue}</p> : null}
        <label className="field">
          <span>目标工具</span>
          <select className="select" value={adapterId} aria-label="目标工具" onChange={(event) => {
            setAdapterId(event.target.value);
            if (!targetPath.trim()) setDefaultPath(event.target.value);
          }}>
            <option value="custom-directory">自定义目录</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
            <option value="cursor">Cursor</option>
            <option value="windsurf">Windsurf</option>
            <option value="opencode">opencode</option>
          </select>
        </label>
        {item.type === 'mcp' ? (
          <label className="field">
            <span>变量，每行 key=value。敏感值只交给 Main 层安全存储。</span>
            <textarea className="textarea" value={variablesText} onChange={(event) => setVariablesText(event.target.value)} />
          </label>
        ) : null}
        {item.type === 'plugin' ? (
          <>
            <label className="field">
              <span>安装模式</span>
              <select className="select" value={installMode} aria-label="安装模式" onChange={(event) => setInstallMode(event.target.value)}>
                <option value="MANUAL_DOWNLOAD">受控手动下载</option>
                <option value="CONFIG_PLUGIN">写入配置插件</option>
                <option value="MANAGED_PACKAGE">托管包安装</option>
              </select>
            </label>
            <label className="field">
              <span>Plugin 操作</span>
              <select className="select" value={operation} aria-label="Plugin 操作" onChange={(event) => setOperation(event.target.value)}>
                <option value="">默认安装/下载</option>
                <option value="update">更新</option>
                <option value="uninstall">卸载</option>
                <option value="mark-installed">标记已安装</option>
                <option value="mark-uninstalled">标记未安装</option>
              </select>
            </label>
          </>
        ) : null}
        {preview ? <TargetPreview preview={preview} /> : null}
        {error ? <ErrorState error={error} title="操作失败" /> : null}
        {result ? <ActionResult result={result} onOpenLocal={onOpenLocal} /> : null}
        <div className="card-action-row">
          <Button disabled={busy || Boolean(pathIssue)} onClick={() => onRun({ targetPath, variables: parseVariables(variablesText), installMode, adapterId, operation: operation || undefined, dryRun: true })}>{busy ? '生成中' : 'Dry-run'}</Button>
          <Button
            type="button"
            tone="primary"
            disabled={busy || Boolean(pathIssue)}
            onClick={() => onRun({ targetPath, variables: parseVariables(variablesText), installMode, adapterId, operation: operation || undefined, dryRun: false })}
          >
            执行
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ActionResult({ result, onOpenLocal }: { result: ActionResultView; onOpenLocal?: () => void }) {
  return (
    <section className="panel">
      <header className="section-header">
        <h2>{result.planTitle ?? '执行计划'}</h2>
        <StatusBadge tone={result.status === 'success' ? 'ok' : result.status === 'dry_run' ? 'info' : 'warn'}>{result.status ?? 'planned'}</StatusBadge>
      </header>
      {result.warnings.length > 0 ? <p className="muted">{result.warnings.join('；')}</p> : null}
      {(result.artifactPath || result.targetPath || result.syncStatus) ? (
        <dl className="key-value-list">
          {result.artifactPath ? <><dt>artifact</dt><dd>{result.artifactPath}</dd></> : null}
          {result.targetPath ? <><dt>目标路径</dt><dd>{result.targetPath}</dd></> : null}
          {result.syncStatus ? <><dt>同步状态</dt><dd>{result.syncStatus}</dd></> : null}
        </dl>
      ) : null}
      {(result.artifactPath || result.targetPath || onOpenLocal) ? (
        <div className="card-action-row">
          {result.targetPath ? <Button type="button" onClick={() => copyText(result.targetPath)}>复制目标路径</Button> : null}
          {result.artifactPath ? <Button type="button" onClick={() => copyText(result.artifactPath)}>复制 artifact 路径</Button> : null}
          {onOpenLocal ? <Button type="button" onClick={onOpenLocal}>查看本地</Button> : null}
        </div>
      ) : null}
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

function TargetPreview({ preview }: { preview: { writePath: string; sourceHint?: string; modeHint?: string } }) {
  return (
    <section className="panel" data-testid="target-preview">
      <header className="section-header">
        <h2>目标预览</h2>
        <StatusBadge tone="info">READY</StatusBadge>
      </header>
      <dl className="key-value-list">
        <dt>将写入</dt>
        <dd>{preview.writePath}</dd>
        {preview.sourceHint ? <><dt>来源</dt><dd>{preview.sourceHint}</dd></> : null}
        {preview.modeHint ? <><dt>模式</dt><dd>{preview.modeHint}</dd></> : null}
      </dl>
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

function defaultTargetPath(item: ExtensionSummary, adapterId: string): string {
  if (item.type === 'skill' && adapterId === 'codex') return '~/.codex/skills';
  if (item.type === 'mcp' && adapterId === 'codex') return '~/.codex/config.toml';
  return '~/EnterpriseAgentHub/targets';
}

function targetPathIssue(targetPath: string): string | undefined {
  const value = targetPath.trim();
  if (!value) return '请填写或选择本地目标路径。';
  if (/^(~\/|\/|[A-Za-z]:[\\/])/.test(value)) return undefined;
  return '目标路径建议使用绝对路径、~/ 开头路径或 Windows 盘符路径。';
}

function targetPreview(item: ExtensionSummary, targetPath: string): { writePath: string; sourceHint?: string; modeHint?: string } | undefined {
  if (targetPathIssue(targetPath)) return undefined;
  const target = `${targetPath.replace(/[\\/]+$/, '')}/${item.id}`;
  if (item.type !== 'skill') return { writePath: target };
  return {
    writePath: target,
    sourceHint: `central-store/${item.id}/${item.version ?? '1.0.0'}`,
    modeHint: '当前模式会链接中心仓库版本目录；目录中的 package 字段保留原始 zip 包，current.json 负责指向当前版本。'
  };
}

function folderPathFromFile(file: File | undefined): string | undefined {
  if (!file) return undefined;
  const path = (file as File & { path?: string }).path;
  if (!path) return undefined;
  const relativePath = file.webkitRelativePath;
  if (relativePath && path.endsWith(relativePath)) {
    return path.slice(0, path.length - relativePath.length).replace(/[\\/]+$/, '');
  }
  return path.replace(/[\\/][^\\/]*$/, '');
}

function directoryPickerProps(): Record<string, string> {
  return { webkitdirectory: '', directory: '' };
}

function copyText(value: string | undefined) {
  if (!value || typeof navigator === 'undefined') return;
  void navigator.clipboard?.writeText(value);
}
