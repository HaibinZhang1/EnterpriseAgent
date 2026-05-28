import type { ExecutionPlan, PlanStep } from './types';
import { FileSystemGuard } from './file-system-guard';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';

const FORBIDDEN = new Set(['exec-script', 'shell-command', 'download-and-run', 'arbitrary-write']);
const ALLOWED = new Set(['ensure-dir', 'write-file', 'copy-file', 'remove-managed', 'symlink', 'switch-pointer', 'record-state']);

export interface PlanValidationOptions {
  allowedRoots: string[];
  managedPaths?: string[];
}

export class PlanValidator {
  constructor(private readonly guard = new FileSystemGuard()) {}

  async validate(plan: ExecutionPlan, options: PlanValidationOptions): Promise<void> {
    if (!plan.planId || !plan.operation || !plan.idempotencyKey || !Array.isArray(plan.steps)) {
      throw new DesktopErrorException(makeDesktopError('invalid_execution_plan', 'ExecutionPlan is missing required fields', plan.requestId));
    }
    for (const precondition of plan.preconditions) {
      if (!precondition.satisfied) {
        throw new DesktopErrorException(makeDesktopError('invalid_execution_plan', precondition.description, plan.requestId, { preconditionErrorCode: precondition.errorCode }));
      }
    }
    for (const step of plan.steps) await this.validateStep(step, plan.requestId, options);
  }

  private async validateStep(step: PlanStep, requestID: string | undefined, options: PlanValidationOptions): Promise<void> {
    if (FORBIDDEN.has(step.action) || !ALLOWED.has(step.action)) {
      throw new DesktopErrorException(makeDesktopError('invalid_execution_plan', `Forbidden plan action: ${step.action}`, requestID));
    }
    if (step.action === 'remove-managed' && !step.managed) {
      throw new DesktopErrorException(makeDesktopError('invalid_execution_plan', 'Removal steps must be marked as managed', requestID));
    }
    if (!step.rollbackable && !step.riskLevel) {
      throw new DesktopErrorException(makeDesktopError('invalid_execution_plan', 'Non-rollbackable steps must declare a risk level', requestID));
    }
    if (step.targetPath) {
      await this.guard.assertSafePath(step.targetPath, {
        roots: options.allowedRoots,
        managedPaths: options.managedPaths,
        requireManaged: step.action === 'remove-managed',
        allowMissing: true
      }, requestID);
    }
    if (step.sourcePath && step.action !== 'copy-file' && step.action !== 'symlink') {
      throw new DesktopErrorException(makeDesktopError('invalid_execution_plan', 'Only copy and symlink steps can declare a source path', requestID));
    }
    if (step.sourcePath) {
      await this.guard.assertSafePath(step.sourcePath, { roots: options.allowedRoots, allowMissing: true }, requestID);
    }
  }
}
