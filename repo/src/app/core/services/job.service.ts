import { Injectable } from '@angular/core';
import { JobRepository, LineageLinkRepository, UserRepository } from '../repositories';
import { AuditService } from './audit.service';
import { Job } from '../models';
import { JobStatus, AuditAction, UserRole } from '../enums';
import { JOB_TRANSITIONS, assertTransition } from '../state-machines';
import { generateId, now } from '../utils/id';
import { AuthorizationError, NotFoundError, ValidationError, OptimisticLockError } from '../errors';

@Injectable({ providedIn: 'root' })
export class JobService {
  constructor(
    private readonly jobRepo: JobRepository,
    private readonly lineageRepo: LineageLinkRepository,
    private readonly audit: AuditService,
    private readonly userRepo: UserRepository,
  ) {}

  private canManage(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.Employer || r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  private hasFullOrgAccess(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  async createJob(
    title: string, description: string, tags: string[], topics: string[],
    actorId: string, actorRoles: UserRole[], organizationId: string,
  ): Promise<Job> {
    if (!this.canManage(actorRoles)) throw new AuthorizationError('Only Employers and HR Coordinators can create jobs');
    if (!title.trim()) throw new ValidationError('Job title is required');
    if (!description.trim()) throw new ValidationError('Job description is required');
    const job: Job = {
      id: generateId(), organizationId, ownerUserId: actorId,
      title: title.trim(), description: description.trim(), tags, topics,
      status: JobStatus.Draft, version: 1, createdAt: now(), updatedAt: now(),
    };
    await this.jobRepo.add(job);
    await this.audit.log(actorId, AuditAction.JobCreated, 'job', job.id, organizationId, { title });
    return job;
  }

  async getJob(jobId: string, actorOrgId: string): Promise<Job> {
    const job = await this.jobRepo.getById(jobId);
    if (!job) throw new NotFoundError('Job', jobId);
    if (job.organizationId !== actorOrgId) throw new AuthorizationError('Cannot access job from different organization');
    return job;
  }

  /**
   * List jobs in the caller's organization.
   * ABAC: org is always derived from actorOrgId (session), never from caller input.
   * RBAC: Candidates may only see Active jobs; management sees all statuses.
   *       When status is explicitly requested, it is clamped for candidates.
   */
  async listJobs(actorId: string, actorRoles: UserRole[], actorOrgId: string, status?: JobStatus): Promise<Job[]> {
    const isMgmt = this.canManage(actorRoles);

    if (status) {
      // Candidates requesting a non-Active status get nothing
      if (!isMgmt && status !== JobStatus.Active) return [];
      const byStatus = await this.jobRepo.getByOrgAndStatus(actorOrgId, status);
      // Employer sees only own jobs even with status filter
      if (isMgmt && !this.hasFullOrgAccess(actorRoles)) return byStatus.filter(j => j.ownerUserId === actorId);
      // Administrator: full visibility; HRCoordinator: department-scoped
      if (actorRoles.includes(UserRole.Administrator)) return byStatus;
      const actor = await this.userRepo.getById(actorId);
      const dept = actor?.departmentId;
      if (dept) return byStatus.filter(j => !j.departmentId || j.departmentId === dept);
      return byStatus;
    }

    const all = await this.jobRepo.getByOrganization(actorOrgId);
    if (!isMgmt) return all.filter(j => j.status === JobStatus.Active);
    // Employer sees only own jobs; HR/Admin see all org jobs (with department filter for HR)
    if (!this.hasFullOrgAccess(actorRoles)) return all.filter(j => j.ownerUserId === actorId);
    // Administrator: full org-wide visibility regardless of department
    if (actorRoles.includes(UserRole.Administrator)) return all;
    // HRCoordinator: scoped to their department when one is set
    const actor = await this.userRepo.getById(actorId);
    const actorDept = actor?.departmentId;
    if (actorDept) return all.filter(j => !j.departmentId || j.departmentId === actorDept);
    return all;
  }

  /**
   * List jobs owned by a specific user.
   * ABAC: org always derived from actorOrgId.
   * RBAC: Management can list any owner's jobs; non-management can only list their own.
   */
  async listJobsByOwner(ownerUserId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<Job[]> {
    if (!this.canManage(actorRoles) && ownerUserId !== actorId) {
      throw new AuthorizationError('Can only list your own jobs');
    }
    const jobs = await this.jobRepo.getByOwner(ownerUserId);
    return jobs.filter(j => j.organizationId === actorOrgId);
  }

  async updateJob(
    jobId: string,
    updates: { title?: string; description?: string; tags?: string[]; topics?: string[] },
    actorId: string, actorRoles: UserRole[], actorOrgId: string, expectedVersion: number,
  ): Promise<Job> {
    const pre = await this.jobRepo.getById(jobId);
    if (!pre) throw new NotFoundError('Job', jobId);
    if (pre.organizationId !== actorOrgId) throw new AuthorizationError('Cannot modify job from different organization');
    if (!this.canManage(actorRoles) && pre.ownerUserId !== actorId) throw new AuthorizationError('Not authorized to modify this job');

    const updated = await this.jobRepo.updateWithLock(jobId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('Job', jobId);
      if (current.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
      if (current.status !== JobStatus.Draft) throw new ValidationError('Only draft jobs can be edited');
      return {
        ...current,
        title: updates.title !== undefined ? updates.title.trim() : current.title,
        description: updates.description !== undefined ? updates.description.trim() : current.description,
        tags: updates.tags !== undefined ? updates.tags : current.tags,
        topics: updates.topics !== undefined ? updates.topics : current.topics,
        version: current.version + 1,
        updatedAt: now(),
      };
    });
    await this.audit.log(actorId, AuditAction.JobUpdated, 'job', jobId, actorOrgId);
    return updated;
  }

  async transitionJobStatus(
    jobId: string, newStatus: JobStatus,
    actorId: string, actorRoles: UserRole[], actorOrgId: string, expectedVersion: number,
  ): Promise<Job> {
    const pre = await this.jobRepo.getById(jobId);
    if (!pre) throw new NotFoundError('Job', jobId);
    if (pre.organizationId !== actorOrgId) throw new AuthorizationError('Cannot modify job from different organization');
    if (!this.canManage(actorRoles) && pre.ownerUserId !== actorId) throw new AuthorizationError('Not authorized');

    const oldStatus = pre.status;
    const updated = await this.jobRepo.updateWithLock(jobId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('Job', jobId);
      if (current.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
      assertTransition(JOB_TRANSITIONS, current.status as JobStatus, newStatus, 'Job');
      return { ...current, status: newStatus, version: current.version + 1, updatedAt: now() };
    });
    await this.audit.log(actorId, AuditAction.JobStatusChanged, 'job', jobId, actorOrgId, { oldStatus, newStatus });
    return updated;
  }
}
