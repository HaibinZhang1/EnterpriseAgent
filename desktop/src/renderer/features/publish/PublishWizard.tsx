import { useState } from 'react';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import type { ExtensionKind, PublishResult, UiError } from '../../types/desktop';
import { inspectPublishPackage, type PackageInspection } from './packageInspection';

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
  packageInspection?: PackageInspection;
}

const steps = ['类型与包', '元数据', '授权与风险', '确认提交'];

export function PublishWizard({
  busy,
  error,
  result,
  onClose,
  onSubmit,
  onResetError,
  initialStep = 0
}: {
  busy: boolean;
  error?: UiError;
  result?: PublishResult;
  onClose: () => void;
  onSubmit: (draft: PublishDraft) => void;
  onResetError?: () => void;
  initialStep?: number;
}) {
  const [step, setStep] = useState(initialStep);
  const [localError, setLocalError] = useState<UiError | undefined>();
  const [inspectionBusy, setInspectionBusy] = useState(false);
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
  const activeError = localError ?? error;
  const validation = validationMessage(step, draft, inspectionBusy);
  const goToStep = (targetStep: number) => {
    const message = navigationValidationMessage(step, targetStep, draft, inspectionBusy);
    if (message) {
      setLocalError({ code: 'validation_failed', message });
      return;
    }
    setLocalError(undefined);
    setStep(targetStep);
  };
  const goNext = () => {
    if (validation) {
      setLocalError({ code: 'validation_failed', message: validation });
      return;
    }
    setLocalError(undefined);
    setStep((value) => Math.min(3, value + 1));
  };
  const submit = () => {
    const message = validationMessage(3, draft, inspectionBusy) ?? submitValidationMessage(draft);
    if (message) {
      setLocalError({ code: 'validation_failed', message });
      return;
    }
    setLocalError(undefined);
    onSubmit(draft);
  };
  const handleFileSelected = async (file: File | undefined) => {
    setLocalError(undefined);
    onResetError?.();
    update({ file, packageInspection: undefined });
    if (!file) return;
    setInspectionBusy(true);
    try {
      const inspection = await inspectPublishPackage(file, draft.extensionType);
      setDraft((current) => ({
        ...current,
        file,
        packageInspection: inspection,
        extensionId: current.extensionId || inspection.metadata.extensionId || '',
        version: current.version || inspection.metadata.version || '',
        name: current.name || inspection.metadata.name || '',
        summary: current.summary || inspection.metadata.description || ''
      }));
      const warning = inspection.warnings[0];
      if (warning) setLocalError({ code: 'validation_failed', message: warning });
    } catch (inspectionError) {
      setLocalError({ code: 'validation_failed', message: inspectionError instanceof Error ? inspectionError.message : '包结构检查失败' });
    } finally {
      setInspectionBusy(false);
    }
  };
  return (
    <Modal title="发布向导" onClose={onClose}>
      <div className="steps" aria-label="发布步骤">
        {steps.map((item, index) => {
          const blocked = Boolean(navigationValidationMessage(step, index, draft, inspectionBusy));
          return (
            <button
              key={item}
              type="button"
              className={`step ${index === step ? 'active' : ''}`}
              aria-current={index === step ? 'step' : undefined}
              aria-label={`打开步骤：${item}`}
              disabled={busy || blocked}
              onClick={() => goToStep(index)}
            >
              {item}
            </button>
          );
        })}
      </div>

      {step === 0 ? <TypeStep draft={draft} inspectionBusy={inspectionBusy} update={update} onFileSelected={handleFileSelected} /> : null}
      {step === 1 ? <MetadataStep draft={draft} update={update} /> : null}
      {step === 2 ? <PolicyStep draft={draft} update={update} /> : null}
      {step === 3 ? <ConfirmStep draft={draft} result={result} /> : null}
      {activeError ? <ErrorState error={activeError} title="提交失败" /> : null}

      <div className="card-action-row">
        <Button disabled={step === 0 || busy} onClick={() => setStep((value) => Math.max(0, value - 1))}>上一步</Button>
        {step < 3 ? <Button tone="primary" disabled={busy || inspectionBusy} onClick={goNext}>{inspectionBusy ? '检查中' : '下一步'}</Button> : null}
        {step === 3 ? <Button tone="primary" disabled={busy || inspectionBusy} onClick={submit}>{busy ? '提交中' : '提交发布申请'}</Button> : null}
      </div>
    </Modal>
  );
}

function TypeStep({
  draft,
  inspectionBusy,
  update,
  onFileSelected
}: {
  draft: PublishDraft;
  inspectionBusy: boolean;
  update: (patch: Partial<PublishDraft>) => void;
  onFileSelected: (file: File | undefined) => void;
}) {
  return (
    <section className="grid" aria-label="类型与包">
      <label className="field">
        <span>扩展类型</span>
        <select className="select" value={draft.extensionType} aria-label="扩展类型" onChange={(event) => update({ extensionType: event.target.value as ExtensionKind, packageInspection: undefined })}>
          <option value="skill">Skill 表单</option>
          <option value="mcp">MCP 表单</option>
          <option value="plugin">Plugin 表单</option>
        </select>
      </label>
      <label className="field">
        <span>上传包 / manifest</span>
        <input className="input" type="file" data-testid="publish-package-input" aria-label="上传包或 manifest" onChange={(event) => onFileSelected(event.target.files?.[0])} />
      </label>
      <p className="muted">请选择待提交的 Skill 包、MCP manifest 或 Plugin 包 / 清单；服务端会执行最终校验。</p>
      {draft.packageInspection ? <PackageInspectionSummary inspection={draft.packageInspection} busy={inspectionBusy} /> : null}
    </section>
  );
}

function MetadataStep({ draft, update }: { draft: PublishDraft; update: (patch: Partial<PublishDraft>) => void }) {
  return (
    <section className="grid" aria-label="元数据">
      <label className="field">
        <span>extensionId</span>
        <input className="input" value={draft.extensionId} aria-label="extensionId" onChange={(event) => update({ extensionId: event.target.value })} />
      </label>
      <label className="field">
        <span>版本</span>
        <input className="input" value={draft.version} aria-label="版本" onChange={(event) => update({ version: event.target.value })} />
      </label>
      <label className="field">
        <span>名称</span>
        <input className="input" value={draft.name} aria-label="名称" onChange={(event) => update({ name: event.target.value })} />
      </label>
      <label className="field">
        <span>简介</span>
        <textarea className="textarea" value={draft.summary} aria-label="简介" onChange={(event) => update({ summary: event.target.value })} />
      </label>
    </section>
  );
}

function PolicyStep({ draft, update }: { draft: PublishDraft; update: (patch: Partial<PublishDraft>) => void }) {
  return (
    <section className="grid" aria-label="授权与风险">
      <label className="field">
        <span>可见范围</span>
        <select className="select" value={draft.visibilityMode} aria-label="可见范围" onChange={(event) => update({ visibilityMode: event.target.value })}>
          <option value="AUTHORIZED_ONLY">仅授权范围可见</option>
          <option value="PUBLIC_TO_ALL_LOGGED_IN">所有登录用户可见</option>
        </select>
      </label>
      <label className="field">
        <span>授权范围</span>
        <select className="select" value={draft.authorizationScope} aria-label="授权范围" onChange={(event) => update({ authorizationScope: event.target.value })}>
          <option value="DEPARTMENT">本部门</option>
          <option value="DEPARTMENT_TREE">本部门及下级</option>
          <option value="SELECTED_DEPARTMENTS">指定部门</option>
          <option value="ALL_EMPLOYEES">全体员工</option>
        </select>
      </label>
      <label className="field">
        <span>风险说明</span>
        <textarea className="textarea" value={draft.riskStatement} aria-label="风险说明" onChange={(event) => update({ riskStatement: event.target.value })} />
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
        <dl className="key-value-list">
          <dt>extensionId</dt>
          <dd>{draft.extensionId || '-'}</dd>
          <dt>包名</dt>
          <dd>{draft.file?.name ?? '-'}</dd>
          <dt>包 SHA</dt>
          <dd>{draft.packageInspection?.sha256 ?? '-'}</dd>
          <dt>文件数</dt>
          <dd>{draft.packageInspection?.fileCount ?? '-'}</dd>
          <dt>风险声明</dt>
          <dd>{draft.riskStatement || '未填写'}</dd>
        </dl>
      </div>
      {draft.packageInspection ? <PackageInspectionSummary inspection={draft.packageInspection} /> : null}
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

function PackageInspectionSummary({ inspection, busy = false }: { inspection: PackageInspection; busy?: boolean }) {
  return (
    <div className="panel" data-testid="publish-package-inspection">
      <header className="section-header">
        <h2>包结构校验</h2>
        <StatusBadge tone={inspection.warnings.length > 0 ? 'warn' : busy ? 'info' : 'ok'}>{busy ? 'CHECKING' : inspection.warnings.length > 0 ? 'WARNING' : 'PASSED'}</StatusBadge>
      </header>
      <dl className="key-value-list">
        <dt>包名</dt>
        <dd>{inspection.fileName}</dd>
        <dt>顶层 SKILL.md</dt>
        <dd>{inspection.rootContainsSkillManifest === undefined ? '不适用' : inspection.rootContainsSkillManifest ? '已检测' : '未检测到'}</dd>
        <dt>文件清单</dt>
        <dd>{inspection.entries.slice(0, 6).join('、') || '-'}</dd>
      </dl>
      {inspection.wrappedSkillManifestPath ? <p className="muted">检测到包裹目录：{inspection.wrappedSkillManifestPath}</p> : null}
      {inspection.warnings.length > 0 ? <p className="muted">{inspection.warnings.join('；')}</p> : null}
    </div>
  );
}

function navigationValidationMessage(currentStep: number, targetStep: number, draft: PublishDraft, inspectionBusy: boolean): string | undefined {
  if (targetStep <= currentStep) return undefined;
  for (let index = currentStep; index < targetStep; index += 1) {
    const message = validationMessage(index, draft, inspectionBusy);
    if (message) return message;
  }
  return undefined;
}

function validationMessage(step: number, draft: PublishDraft, inspectionBusy: boolean): string | undefined {
  if (inspectionBusy) return '包结构仍在检查中，请稍后继续。';
  if (step === 0) {
    if (!draft.file) return '请选择要提交的包或 manifest 文件。';
    if (draft.extensionType === 'skill' && draft.packageInspection?.rootContainsSkillManifest === false) {
      return draft.packageInspection.wrappedSkillManifestPath
        ? `Skill 包顶层必须包含 SKILL.md，当前检测到 ${draft.packageInspection.wrappedSkillManifestPath}。`
        : 'Skill 包顶层必须包含 SKILL.md。';
    }
  }
  if (step === 1) {
    if (!draft.extensionId.trim()) return '请填写 extensionId，或上传带 frontmatter 的 SKILL.md 自动带出。';
    if (!draft.version.trim()) return '请填写版本号。';
    if (!draft.name.trim()) return '请填写名称，或从 SKILL.md 自动带出。';
    if (!draft.summary.trim()) return '请填写简介，或从 SKILL.md description 自动带出。';
  }
  return undefined;
}

export function submitValidationMessage(draft: PublishDraft): string | undefined {
  for (const step of [0, 1]) {
    const message = validationMessage(step, draft, false);
    if (message) return message;
  }
  return undefined;
}
