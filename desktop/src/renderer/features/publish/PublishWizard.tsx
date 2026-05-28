import { useState } from 'react';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import type { ExtensionKind, PublishResult, UiError } from '../../types/desktop';

export interface PublishDraft {
  extensionType: ExtensionKind;
  extensionId: string;
  version: string;
  name: string;
  summary: string;
  visibilityMode: string;
  authorizationScope: string;
  riskStatement: string;
  file?: File;
}

const steps = ['类型与包', '元数据', '授权与风险', '确认提交'];

export function PublishWizard({
  busy,
  error,
  result,
  onClose,
  onSubmit,
  initialStep = 0
}: {
  busy: boolean;
  error?: UiError;
  result?: PublishResult;
  onClose: () => void;
  onSubmit: (draft: PublishDraft) => void;
  initialStep?: number;
}) {
  const [step, setStep] = useState(initialStep);
  const [draft, setDraft] = useState<PublishDraft>({
    extensionType: 'skill',
    extensionId: '',
    version: '',
    name: '',
    summary: '',
    visibilityMode: 'AUTHORIZED_ONLY',
    authorizationScope: 'DEPARTMENT',
    riskStatement: ''
  });
  const update = (patch: Partial<PublishDraft>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <Modal title="发布向导" onClose={onClose}>
      <div className="steps" aria-label="发布步骤">
        {steps.map((item, index) => <button key={item} type="button" className={`step ${index === step ? 'active' : ''}`} onClick={() => setStep(index)}>{item}</button>)}
      </div>

      {step === 0 ? <TypeStep draft={draft} update={update} /> : null}
      {step === 1 ? <MetadataStep draft={draft} update={update} /> : null}
      {step === 2 ? <PolicyStep draft={draft} update={update} /> : null}
      {step === 3 ? <ConfirmStep draft={draft} result={result} /> : null}
      {error ? <ErrorState error={error} title="提交失败" /> : null}

      <div className="card-action-row">
        <Button disabled={step === 0 || busy} onClick={() => setStep((value) => Math.max(0, value - 1))}>上一步</Button>
        {step < 3 ? <Button tone="primary" disabled={busy} onClick={() => setStep((value) => Math.min(3, value + 1))}>下一步</Button> : null}
        {step === 3 ? <Button tone="primary" disabled={busy} onClick={() => onSubmit(draft)}>{busy ? '提交中' : '提交发布申请'}</Button> : null}
      </div>
    </Modal>
  );
}

function TypeStep({ draft, update }: { draft: PublishDraft; update: (patch: Partial<PublishDraft>) => void }) {
  return (
    <section className="grid" aria-label="类型与包">
      <label className="field">
        <span>扩展类型</span>
        <select className="select" value={draft.extensionType} onChange={(event) => update({ extensionType: event.target.value as ExtensionKind })}>
          <option value="skill">Skill 表单</option>
          <option value="mcp">MCP 表单</option>
          <option value="plugin">Plugin 表单</option>
        </select>
      </label>
      <label className="field">
        <span>上传包 / manifest</span>
        <input className="input" type="file" onChange={(event) => update({ file: event.target.files?.[0] })} />
      </label>
      <p className="muted">Skill / MCP / Plugin 都会创建真实 submission；未选择文件时按服务端契约提交元数据和空上传引用。</p>
    </section>
  );
}

function MetadataStep({ draft, update }: { draft: PublishDraft; update: (patch: Partial<PublishDraft>) => void }) {
  return (
    <section className="grid" aria-label="元数据">
      <label className="field">
        <span>extensionId</span>
        <input className="input" value={draft.extensionId} onChange={(event) => update({ extensionId: event.target.value })} />
      </label>
      <label className="field">
        <span>版本</span>
        <input className="input" value={draft.version} onChange={(event) => update({ version: event.target.value })} />
      </label>
      <label className="field">
        <span>名称</span>
        <input className="input" value={draft.name} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <label className="field">
        <span>简介</span>
        <textarea className="textarea" value={draft.summary} onChange={(event) => update({ summary: event.target.value })} />
      </label>
    </section>
  );
}

function PolicyStep({ draft, update }: { draft: PublishDraft; update: (patch: Partial<PublishDraft>) => void }) {
  return (
    <section className="grid" aria-label="授权与风险">
      <label className="field">
        <span>可见范围</span>
        <select className="select" value={draft.visibilityMode} onChange={(event) => update({ visibilityMode: event.target.value })}>
          <option value="AUTHORIZED_ONLY">仅授权范围可见</option>
          <option value="PUBLIC_TO_ALL_LOGGED_IN">所有登录用户可见</option>
        </select>
      </label>
      <label className="field">
        <span>授权范围</span>
        <select className="select" value={draft.authorizationScope} onChange={(event) => update({ authorizationScope: event.target.value })}>
          <option value="DEPARTMENT">本部门</option>
          <option value="DEPARTMENT_TREE">本部门及下级</option>
          <option value="SELECTED_DEPARTMENTS">指定部门</option>
          <option value="ALL_EMPLOYEES">全体员工</option>
        </select>
      </label>
      <label className="field">
        <span>风险说明</span>
        <textarea className="textarea" value={draft.riskStatement} onChange={(event) => update({ riskStatement: event.target.value })} />
      </label>
    </section>
  );
}

function ConfirmStep({ draft, result }: { draft: PublishDraft; result?: PublishResult }) {
  return (
    <section className="grid" aria-label="确认提交">
      <div className="panel">
        <p><strong>{draft.name || draft.extensionId || '未命名扩展'}</strong></p>
        <p className="muted">{draft.extensionType} / {draft.version || '未填版本'} / {draft.visibilityMode}</p>
        <p className="muted">{draft.authorizationScope}</p>
      </div>
      {result ? (
        <div className="panel">
          <header className="section-header">
            <h2>提交成功</h2>
            <StatusBadge tone="ok">{result.status ?? 'SUBMITTED'}</StatusBadge>
          </header>
          <p>submissionId: {result.submissionId ?? '-'}</p>
          <p>revisionId: {result.revisionId ?? '-'}</p>
        </div>
      ) : null}
    </section>
  );
}
