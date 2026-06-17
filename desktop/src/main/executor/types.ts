export type PlanStepAction =
  | 'ensure-dir'
  | 'write-file'
  | 'copy-file'
  | 'remove-managed'
  | 'symlink'
  | 'json-upsert'
  | 'json-remove'
  | 'verify-hash'
  | 'switch-pointer'
  | 'record-state';

export type ForbiddenPlanStepAction =
  | 'exec-script'
  | 'shell-command'
  | 'download-and-run'
  | 'arbitrary-write'
  | 'execute-cli'
  | 'trigger-hook'
  | 'start-mcp-stdio-server'
  | 'run-plugin-lifecycle-script';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type StepStatus = 'pending' | 'skipped' | 'success' | 'failed' | 'rolled_back';
export type PlanStatus = 'planned' | 'dry_run' | 'success' | 'failed' | 'partial_success' | 'rolled_back' | 'rollback_failed';

export interface PlanSummary {
  title: string;
  description: string;
  targetCount: number;
  warnings: string[];
}

export interface Precondition {
  id: string;
  description: string;
  satisfied: boolean;
  errorCode?: string;
}

export interface RollbackPolicy {
  strategy: 'best-effort' | 'none';
  reason?: string;
}

export interface PlanStep {
  stepId: string;
  action: PlanStepAction;
  description: string;
  targetPath?: string;
  sourcePath?: string;
  content?: string;
  expectedSha256?: string;
  managed?: boolean;
  rollbackable: boolean;
  riskLevel?: RiskLevel;
  metadata?: Record<string, unknown>;
}

export interface ExecutionPlan {
  planId: string;
  requestId?: string;
  operation: string;
  extensionId?: string;
  version?: string;
  createdAt: string;
  dryRun: boolean;
  riskLevel: RiskLevel;
  summary: PlanSummary;
  preconditions: Precondition[];
  steps: PlanStep[];
  rollbackPolicy: RollbackPolicy;
  idempotencyKey: string;
}

export interface StepResult {
  stepId: string;
  action: PlanStepAction;
  status: StepStatus;
  errorCode?: string;
  message?: string;
  rollbackStatus?: 'not_needed' | 'success' | 'failed';
}

export interface PlanResult {
  planId: string;
  executionId?: string;
  status: PlanStatus;
  dryRun: boolean;
  steps: StepResult[];
  failedStepId?: string;
  nextAction?: string;
}
