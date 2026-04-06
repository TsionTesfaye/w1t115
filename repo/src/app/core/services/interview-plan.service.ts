import { Injectable } from '@angular/core';
import { InterviewPlanRepository } from '../repositories';
import { InterviewPlan, InterviewPlanStage } from '../models';
import { UserRole } from '../enums';
import { AuthorizationError } from '../errors';
import { generateId, now } from '../utils/id';

@Injectable({ providedIn: 'root' })
export class InterviewPlanService {
  constructor(private readonly planRepo: InterviewPlanRepository) {}

  private canManage(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.Employer || r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  private canView(roles: UserRole[]): boolean {
    return roles.some(r =>
      r === UserRole.Employer || r === UserRole.HRCoordinator ||
      r === UserRole.Administrator || r === UserRole.Interviewer
    );
  }

  /** List all plans for the org. RBAC: Employer, HRCoordinator, Administrator, Interviewer. */
  async listPlans(actorRoles: UserRole[], actorOrgId: string): Promise<InterviewPlan[]> {
    if (!this.canView(actorRoles)) throw new AuthorizationError('Not authorized to view interview plans');
    return this.planRepo.getByOrganization(actorOrgId);
  }

  /** Create a new interview plan. RBAC: Employer, HRCoordinator, Administrator. */
  async createPlan(
    jobId: string,
    stages: InterviewPlanStage[],
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<InterviewPlan> {
    if (!this.canManage(actorRoles)) throw new AuthorizationError('Not authorized to manage interview plans');
    const plan: InterviewPlan = {
      id: generateId(),
      jobId,
      organizationId: actorOrgId,
      stages,
      createdBy: actorId,
      version: 1,
      createdAt: now(),
      updatedAt: now(),
    };
    await this.planRepo.add(plan);
    return plan;
  }

  /** Update the stages of an existing plan. RBAC: Employer, HRCoordinator, Administrator. */
  async updatePlan(
    planId: string,
    stages: InterviewPlanStage[],
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
    version: number,
  ): Promise<InterviewPlan> {
    if (!this.canManage(actorRoles)) throw new AuthorizationError('Not authorized to manage interview plans');
    const existing = await this.planRepo.getById(planId);
    if (!existing) throw new Error('Interview plan not found');
    if (existing.organizationId !== actorOrgId) throw new AuthorizationError('Not authorized to update this plan');
    const updated: InterviewPlan = {
      ...existing,
      stages,
      version: version + 1,
      updatedAt: now(),
    };
    await this.planRepo.put(updated);
    return updated;
  }

  /** Delete an interview plan. RBAC: Employer, HRCoordinator, Administrator. */
  async deletePlan(
    planId: string,
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<void> {
    if (!this.canManage(actorRoles)) throw new AuthorizationError('Not authorized to manage interview plans');
    const existing = await this.planRepo.getById(planId);
    if (!existing) throw new Error('Interview plan not found');
    if (existing.organizationId !== actorOrgId) throw new AuthorizationError('Not authorized to delete this plan');
    await this.planRepo.delete(planId);
  }

  /**
   * Get or create a default interview plan for a job.
   * If a plan already exists for this job in the org, returns the first one.
   * Otherwise, creates a default single-stage plan.
   */
  async ensurePlanForJob(
    jobId: string, actorRoles: UserRole[], actorOrgId: string, createdBy: string,
  ): Promise<InterviewPlan> {
    if (!this.canManage(actorRoles)) throw new AuthorizationError('Not authorized to manage interview plans');
    const existing = await this.planRepo.getByJob(jobId);
    const orgPlans = existing.filter(p => p.organizationId === actorOrgId);
    if (orgPlans.length > 0) return orgPlans[0];

    const plan: InterviewPlan = {
      id: generateId(),
      jobId,
      organizationId: actorOrgId,
      stages: [{ name: 'Interview', order: 1, durationMinutes: 60, interviewerRole: 'interviewer' }],
      createdBy,
      version: 1,
      createdAt: now(),
      updatedAt: now(),
    };
    await this.planRepo.add(plan);
    return plan;
  }
}
