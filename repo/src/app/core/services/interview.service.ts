import { Injectable } from '@angular/core';
import { InterviewRepository, InterviewPlanRepository, ApplicationRepository, JobRepository, LineageLinkRepository, UserRepository } from '../repositories';
import { AuditService } from './audit.service';
import { NotificationService } from './notification.service';
import { Interview } from '../models';
import { InterviewStatus, ApplicationStatus, AuditAction, UserRole, NotificationEventType } from '../enums';
import { INTERVIEW_TRANSITIONS, assertTransition } from '../state-machines';
import { generateId, now } from '../utils/id';
import { AuthorizationError, NotFoundError, ValidationError, OptimisticLockError } from '../errors';

@Injectable({ providedIn: 'root' })
export class InterviewService {
  constructor(
    private readonly interviewRepo: InterviewRepository,
    private readonly planRepo: InterviewPlanRepository,
    private readonly appRepo: ApplicationRepository,
    private readonly jobRepo: JobRepository,
    private readonly lineageRepo: LineageLinkRepository,
    private readonly audit: AuditService,
    private readonly notifService: NotificationService,
    private readonly userRepo: UserRepository,
  ) {}

  private canManage(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.Employer || r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  private hasFullOrgAccess(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  /**
   * Schedule a new interview.
   *
   * Concurrency guarantee: conflict detection and the insert both execute inside a
   * single IDB readwrite transaction (via InterviewRepository.scheduleAtomically).
   * IDB serializes readwrite transactions on the same store, so two concurrent
   * scheduleInterview calls for the same interviewer/candidate cannot both pass the
   * conflict check — the second transaction blocks until the first commits, then
   * reads the newly written record and correctly detects the overlap.
   */
  async scheduleInterview(
    applicationId: string, interviewPlanId: string, interviewerId: string, candidateId: string,
    startTime: string, endTime: string, actorId: string, actorRoles: UserRole[], actorOrgId: string,
  ): Promise<Interview> {
    if (!this.canManage(actorRoles)) throw new AuthorizationError('Not authorized to schedule interviews');
    const app = await this.appRepo.getById(applicationId); if (!app) throw new NotFoundError('Application', applicationId);
    if (app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (app.status !== ApplicationStatus.Active) throw new ValidationError('Application must be active');
    const plan = await this.planRepo.getById(interviewPlanId); if (!plan) throw new NotFoundError('InterviewPlan', interviewPlanId);
    if (plan.organizationId !== actorOrgId) throw new AuthorizationError('Interview plan belongs to a different organization');
    const start = new Date(startTime); const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new ValidationError('Invalid time');
    if (end <= start) throw new ValidationError('End time must be after start time');

    const interview: Interview = {
      id: generateId(), applicationId, interviewPlanId, organizationId: actorOrgId,
      interviewerId, candidateId, startTime, endTime,
      status: InterviewStatus.Scheduled, rescheduledAt: null, rescheduledBy: null,
      version: 1, createdAt: now(), updatedAt: now(),
    };

    // Atomic: conflict check + add in one IDB readwrite transaction — no TOCTOU gap
    await this.interviewRepo.scheduleAtomically(interview);

    await this.lineageRepo.add({ id: generateId(), fromEntityType: 'application', fromEntityId: applicationId, toEntityType: 'interview', toEntityId: interview.id });
    await this.audit.log(actorId, AuditAction.InterviewScheduled, 'interview', interview.id, actorOrgId, { applicationId, interviewerId, candidateId, startTime, endTime });

    // Notify candidate that their interview has been confirmed
    this.notifService.createNotification(
      candidateId,
      actorOrgId,
      NotificationEventType.InterviewConfirmed,
      'interview',
      interview.id,
      `interview_confirmed_${interview.id}`,
      `Your interview has been scheduled for ${startTime}`,
    ).catch(() => {});

    return interview;
  }

  /**
   * Reschedule a Scheduled interview to new times.
   *
   * Concurrency guarantee: conflict detection, the version/status check, and the
   * write all execute inside a single IDB readwrite transaction
   * (via InterviewRepository.rescheduleAtomically).  This closes the TOCTOU gap
   * between a pre-flight conflict check and the subsequent write.
   */
  async reschedule(
    interviewId: string, newStartTime: string, newEndTime: string,
    actorId: string, actorRoles: UserRole[], actorOrgId: string, expectedVersion: number,
  ): Promise<Interview> {
    if (!this.canManage(actorRoles)) throw new AuthorizationError('Not authorized');
    // Pre-flight existence check — fast rejection before acquiring the write lock
    const preCheck = await this.interviewRepo.getById(interviewId);
    if (!preCheck) throw new NotFoundError('Interview', interviewId);
    const start = new Date(newStartTime); const end = new Date(newEndTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new ValidationError('Invalid time');
    if (end <= start) throw new ValidationError('End must be after start');

    // Atomic: conflict check + version/status/org validation + write in one IDB readwrite transaction
    const updated = await this.interviewRepo.rescheduleAtomically(
      interviewId, newStartTime, newEndTime,
      (current) => {
        if (current.version !== expectedVersion) throw new OptimisticLockError('Interview', interviewId);
        if (current.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
        if (current.status !== InterviewStatus.Scheduled) {
          throw new ValidationError('Can only reschedule a Scheduled interview');
        }
        return {
          ...current,
          startTime: newStartTime, endTime: newEndTime,
          rescheduledAt: now(), rescheduledBy: actorId,
          version: current.version + 1, updatedAt: now(),
        };
      },
    );
    await this.audit.log(actorId, AuditAction.InterviewRescheduled, 'interview', interviewId, actorOrgId, { newStartTime, newEndTime });

    // Notify candidate that their interview schedule has changed
    this.notifService.createNotification(
      updated.candidateId,
      actorOrgId,
      NotificationEventType.ScheduleChanged,
      'interview',
      interviewId,
      `schedule_changed_${interviewId}_${now()}`,
      `Your interview has been rescheduled to ${newStartTime}`,
    ).catch(() => {});

    return updated;
  }

  /**
   * Mark a Scheduled interview as Completed.
   * State machine: Scheduled → Completed (enforced by assertTransition inside updateWithLock).
   * Version check and transition assertion are atomic — no TOCTOU.
   */
  async completeInterview(
    interviewId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string, expectedVersion: number,
  ): Promise<Interview> {
    const canComplete = this.canManage(actorRoles) || actorRoles.includes(UserRole.Interviewer);
    if (!canComplete) throw new AuthorizationError('Not authorized');
    const interview = await this.interviewRepo.getById(interviewId);
    if (!interview) throw new NotFoundError('Interview', interviewId);
    if (interview.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    // Interviewer can only complete their own assigned interview
    if (!this.canManage(actorRoles) && interview.interviewerId !== actorId) {
      throw new AuthorizationError('Interviewers can only complete their own assigned interviews');
    }

    const updated = await this.interviewRepo.updateWithLock(interviewId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('Interview', interviewId);
      if (current.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
      // assertTransition enforces Scheduled → Completed; Completed/Canceled are terminal
      assertTransition(INTERVIEW_TRANSITIONS, current.status as InterviewStatus, InterviewStatus.Completed, 'Interview');
      return { ...current, status: InterviewStatus.Completed, version: current.version + 1, updatedAt: now() };
    });
    await this.audit.log(actorId, AuditAction.InterviewCompleted, 'interview', interviewId, actorOrgId);
    return updated;
  }

  /**
   * Cancel a Scheduled interview.
   * State machine: Scheduled → Canceled (enforced by assertTransition inside updateWithLock).
   * Version check and transition assertion are atomic — no TOCTOU.
   */
  async cancelInterview(
    interviewId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string, expectedVersion: number,
  ): Promise<Interview> {
    if (!this.canManage(actorRoles)) throw new AuthorizationError('Not authorized');
    const interview = await this.interviewRepo.getById(interviewId);
    if (!interview) throw new NotFoundError('Interview', interviewId);
    if (interview.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');

    const updated = await this.interviewRepo.updateWithLock(interviewId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('Interview', interviewId);
      if (current.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
      // assertTransition enforces Scheduled → Canceled; Completed/Canceled are terminal
      assertTransition(INTERVIEW_TRANSITIONS, current.status as InterviewStatus, InterviewStatus.Canceled, 'Interview');
      return { ...current, status: InterviewStatus.Canceled, version: current.version + 1, updatedAt: now() };
    });
    await this.audit.log(actorId, AuditAction.InterviewCanceled, 'interview', interviewId, actorOrgId);
    return updated;
  }

  async getByInterviewer(interviewerId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<Interview[]> {
    if (actorRoles.includes(UserRole.Interviewer) && interviewerId !== actorId && !this.canManage(actorRoles)) {
      throw new AuthorizationError('Cannot view other schedules');
    }
    return (await this.interviewRepo.getByInterviewer(interviewerId)).filter(i => i.organizationId === actorOrgId);
  }

  async getByCandidate(candidateId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<Interview[]> {
    if (actorRoles.includes(UserRole.Candidate) && candidateId !== actorId && !this.canManage(actorRoles)) {
      throw new AuthorizationError('Cannot view other schedules');
    }
    return (await this.interviewRepo.getByCandidate(candidateId)).filter(i => i.organizationId === actorOrgId);
  }

  /**
   * List all interviews in the caller's organization.
   * Restricted to management roles (Employer, HRCoordinator, Administrator).
   */
  async listByOrganization(actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<Interview[]> {
    if (!this.canManage(actorRoles)) throw new AuthorizationError('Not authorized to list all interviews');
    const all = await this.interviewRepo.getByOrganization(actorOrgId);
    // Administrator: full visibility
    if (actorRoles.includes(UserRole.Administrator)) return all;
    // HRCoordinator: scoped to their department (resolved via application → job chain)
    if (actorRoles.includes(UserRole.HRCoordinator)) {
      const actor = await this.userRepo.getById(actorId);
      const actorDept = actor?.departmentId;
      if (actorDept) {
        const orgJobs = await this.jobRepo.getByOrganization(actorOrgId);
        const deptJobIds = new Set(
          orgJobs.filter(j => !j.departmentId || j.departmentId === actorDept).map(j => j.id),
        );
        // Resolve interview → application → job
        const appIds = new Set(all.map(i => i.applicationId));
        const apps = await Promise.all([...appIds].map(id => this.appRepo.getById(id)));
        const deptAppIds = new Set(
          apps.filter(a => a && deptJobIds.has(a.jobId)).map(a => a!.id),
        );
        return all.filter(i => deptAppIds.has(i.applicationId));
      }
    }
    return all;
  }
}
