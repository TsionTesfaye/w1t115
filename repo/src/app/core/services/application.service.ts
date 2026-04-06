import { Injectable } from '@angular/core';
import { ApplicationRepository, JobRepository, LineageLinkRepository, NotificationRepository, UserRepository } from '../repositories';
import { AuditService } from './audit.service';
import { NotificationService } from './notification.service';
import { Application } from '../models';
import { ApplicationStage, ApplicationStatus, JobStatus, AuditAction, UserRole, NotificationEventType } from '../enums';
import {
  APPLICATION_STAGE_TRANSITIONS,
  APPLICATION_STATUS_TRANSITIONS,
  WITHDRAWABLE_STAGES,
  assertTransition,
} from '../state-machines';
import { generateId, now } from '../utils/id';
import {
  AuthorizationError, NotFoundError, ValidationError,
  ConflictError, OptimisticLockError,
} from '../errors';

@Injectable({ providedIn: 'root' })
export class ApplicationService {
  constructor(
    private readonly appRepo: ApplicationRepository,
    private readonly jobRepo: JobRepository,
    private readonly lineageRepo: LineageLinkRepository,
    private readonly notifRepo: NotificationRepository,
    private readonly audit: AuditService,
    private readonly notifService: NotificationService,
    private readonly userRepo: UserRepository,
  ) {}

  private hasMgmt(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.Employer || r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  /** True if role has org-wide visibility (HR Coordinator or Administrator, NOT Employer). */
  private hasFullOrgAccess(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  // ─── CREATE ──────────────────────────────────────────────────────────────

  async createApplication(
    jobId: string,
    candidateId: string,
    candidateOrgId: string,
    actorRoles: UserRole[],
  ): Promise<Application> {
    if (!actorRoles.includes(UserRole.Candidate)) {
      throw new AuthorizationError('Only candidates can create applications');
    }
    const job = await this.jobRepo.getById(jobId);
    if (!job) throw new NotFoundError('Job', jobId);
    if (job.organizationId !== candidateOrgId) {
      throw new AuthorizationError('Cannot apply to jobs outside your organization');
    }
    // Job lifecycle enforcement: candidates may only apply to active jobs
    if (job.status !== JobStatus.Active) {
      throw new ValidationError(`Cannot apply to a job with status '${job.status}' — job must be active`);
    }
    const app: Application = {
      id: generateId(), jobId, candidateId, organizationId: candidateOrgId,
      stage: ApplicationStage.Draft, status: ApplicationStatus.Active,
      offerExpiresAt: null, submittedAt: null, version: 1, createdAt: now(), updatedAt: now(),
    };
    // Atomic duplicate check + insert in a single IDB readwrite transaction.
    // Prevents TOCTOU: two concurrent createApplication calls for the same
    // candidate+job cannot both pass the duplicate check.
    await this.appRepo.addAtomicallyIfNoDuplicate(app);
    await this.lineageRepo.add({
      id: generateId(), fromEntityType: 'job', fromEntityId: jobId,
      toEntityType: 'application', toEntityId: app.id,
    });
    await this.audit.log(candidateId, AuditAction.ApplicationCreated, 'application', app.id, candidateOrgId, { jobId });

    // Notify the job owner (employer) that a new application was received
    this.notifService.createNotification(
      job.ownerUserId,
      candidateOrgId,
      NotificationEventType.ApplicationReceived,
      'application',
      app.id,
      `app_received_${app.id}`,
      `New application received for "${job.title}"`,
    ).catch(() => {}); // notification failure must never block the main flow

    return app;
  }

  // ─── READ ────────────────────────────────────────────────────────────────

  async getApplication(
    applicationId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string,
  ): Promise<Application> {
    const app = await this.appRepo.getById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    if (app.organizationId !== actorOrgId) throw new AuthorizationError('Cannot access application from a different organization');
    if (actorRoles.includes(UserRole.Candidate) && !this.hasMgmt(actorRoles) && app.candidateId !== actorId) {
      throw new AuthorizationError("Cannot access another candidate's application");
    }
    return app;
  }

  async listByJob(jobId: string, actorRoles: UserRole[], actorOrgId: string): Promise<Application[]> {
    if (!this.hasMgmt(actorRoles)) throw new AuthorizationError('Only management roles can list applications by job');
    // Validate job belongs to caller's org before reading its applications
    const job = await this.jobRepo.getById(jobId);
    if (!job) throw new NotFoundError('Job', jobId);
    if (job.organizationId !== actorOrgId) throw new AuthorizationError('Job belongs to a different organization');
    return (await this.appRepo.getByJob(jobId)).filter(
      a => a.organizationId === actorOrgId && a.status !== ApplicationStatus.Deleted,
    );
  }

  async listByCandidate(candidateId: string, actorId: string, actorOrgId: string): Promise<Application[]> {
    if (candidateId !== actorId) throw new AuthorizationError('Candidates can only list their own applications');
    return (await this.appRepo.getByCandidate(candidateId)).filter(
      a => a.organizationId === actorOrgId && a.status !== ApplicationStatus.Deleted,
    );
  }

  // ─── STAGE TRANSITIONS ───────────────────────────────────────────────────

  /**
   * Advance the lifecycle stage of an application.
   * Draft → Submitted: only the owning candidate.
   * All subsequent stages: management roles only.
   *
   * Both the state-machine assertion and version check run inside updateWithLock —
   * a single IDB readwrite transaction — eliminating TOCTOU.
   */
  async transitionStage(
    applicationId: string, newStage: ApplicationStage,
    actorId: string, actorRoles: UserRole[], actorOrgId: string, expectedVersion: number,
  ): Promise<Application> {
    const app = await this.appRepo.getById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    if (app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (app.status !== ApplicationStatus.Active) {
      throw new ValidationError('Can only advance the stage of an active application');
    }
    if (app.stage === ApplicationStage.Draft && newStage === ApplicationStage.Submitted) {
      if (app.candidateId !== actorId) throw new AuthorizationError('Only the owning candidate can submit their application');
    } else if (!this.hasMgmt(actorRoles)) {
      throw new AuthorizationError('Only management roles can advance application stages beyond submission');
    }

    const oldStage = app.stage;
    const updated = await this.appRepo.updateWithLock(applicationId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('Application', applicationId);
      if (current.status !== ApplicationStatus.Active) {
        throw new ValidationError('Application status changed concurrently — cannot transition stage');
      }
      assertTransition(APPLICATION_STAGE_TRANSITIONS, current.stage as ApplicationStage, newStage, 'ApplicationStage');
      return {
        ...current,
        stage: newStage,
        submittedAt: newStage === ApplicationStage.Submitted ? now() : current.submittedAt,
        version: current.version + 1,
        updatedAt: now(),
      };
    });
    await this.audit.log(actorId, AuditAction.ApplicationStageChanged, 'application', applicationId, actorOrgId, { oldStage, newStage });
    return updated;
  }

  // ─── STATUS TRANSITIONS ──────────────────────────────────────────────────

  /**
   * Candidate withdraws their own application.
   * Enforces: ownership, WITHDRAWABLE_STAGES, APPLICATION_STATUS_TRANSITIONS (Active→Withdrawn),
   * optimistic lock. Notification cancellation uses indexed query on userId — not getAll().
   */
  async withdraw(
    applicationId: string, actorId: string, actorOrgId: string, expectedVersion: number,
  ): Promise<Application> {
    const app = await this.appRepo.getById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    if (app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (app.candidateId !== actorId) throw new AuthorizationError('Only the owning candidate can withdraw');
    if (app.status !== ApplicationStatus.Active) throw new ValidationError('Can only withdraw an active application');
    if (!WITHDRAWABLE_STAGES.has(app.stage as ApplicationStage)) {
      throw new ValidationError(`Cannot withdraw from stage '${app.stage}' — application must be submitted first`);
    }

    const updated = await this.appRepo.updateWithLock(applicationId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('Application', applicationId);
      if (current.status !== ApplicationStatus.Active) throw new ValidationError('Application status changed concurrently');
      if (!WITHDRAWABLE_STAGES.has(current.stage as ApplicationStage)) {
        throw new ValidationError(`Stage changed concurrently to '${current.stage}' — no longer withdrawable`);
      }
      assertTransition(APPLICATION_STATUS_TRANSITIONS, current.status as ApplicationStatus, ApplicationStatus.Withdrawn, 'ApplicationStatus');
      return { ...current, status: ApplicationStatus.Withdrawn, version: current.version + 1, updatedAt: now() };
    });

    // Cancel linked notifications via indexed query (never getAll)
    const candidateNotifs = await this.notifRepo.getByUser(actorId);
    for (const n of candidateNotifs.filter(
      n => n.referenceType === 'application' && n.referenceId === applicationId && !n.isRead && !n.isCanceled,
    )) {
      n.isCanceled = true; n.updatedAt = now(); n.version += 1;
      await this.notifRepo.put(n);
    }
    await this.audit.log(actorId, AuditAction.ApplicationStatusChanged, 'application', applicationId, actorOrgId, { newStatus: ApplicationStatus.Withdrawn });
    return updated;
  }

  /**
   * Candidate soft-deletes their own draft application.
   * Only valid when stage === Draft. Enforces APPLICATION_STATUS_TRANSITIONS (Active→Deleted)
   * atomically inside updateWithLock. Requires expectedVersion for optimistic lock.
   */
  async deleteDraft(
    applicationId: string, actorId: string, actorOrgId: string, expectedVersion: number,
  ): Promise<void> {
    const app = await this.appRepo.getById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    if (app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (app.candidateId !== actorId) throw new AuthorizationError('Only the owning candidate can delete their draft');
    if (app.stage !== ApplicationStage.Draft) {
      throw new ValidationError("Only draft-stage applications may be deleted — use withdraw() for submitted applications");
    }
    await this.appRepo.updateWithLock(applicationId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('Application', applicationId);
      if (current.stage !== ApplicationStage.Draft) {
        throw new ValidationError('Stage changed concurrently — application is no longer in draft');
      }
      assertTransition(APPLICATION_STATUS_TRANSITIONS, current.status as ApplicationStatus, ApplicationStatus.Deleted, 'ApplicationStatus');
      return { ...current, status: ApplicationStatus.Deleted, version: current.version + 1, updatedAt: now() };
    });
  }

  /**
   * Candidate accepts an extended offer.
   * Enforces APPLICATION_STATUS_TRANSITIONS (Active→Accepted) atomically.
   */
  async acceptOffer(
    applicationId: string, actorId: string, actorOrgId: string, expectedVersion: number,
  ): Promise<Application> {
    const app = await this.appRepo.getById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    if (app.candidateId !== actorId) throw new AuthorizationError('Only the owning candidate can accept an offer');
    if (app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (app.stage !== ApplicationStage.OfferExtended) throw new ValidationError('Cannot accept — no offer has been extended on this application');
    if (app.status !== ApplicationStatus.Active) throw new ValidationError('Can only accept an offer on an active application');
    if (app.offerExpiresAt && new Date(app.offerExpiresAt).getTime() < Date.now()) throw new ValidationError('The offer has already expired');

    const updated = await this.appRepo.updateWithLock(applicationId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('Application', applicationId);
      if (current.stage !== ApplicationStage.OfferExtended || current.status !== ApplicationStatus.Active) {
        throw new ValidationError('Application state changed concurrently');
      }
      if (current.offerExpiresAt && new Date(current.offerExpiresAt).getTime() < Date.now()) {
        throw new ValidationError('The offer expired while processing your request');
      }
      assertTransition(APPLICATION_STATUS_TRANSITIONS, current.status as ApplicationStatus, ApplicationStatus.Accepted, 'ApplicationStatus');
      return { ...current, status: ApplicationStatus.Accepted, version: current.version + 1, updatedAt: now() };
    });
    await this.audit.log(actorId, AuditAction.ApplicationStatusChanged, 'application', applicationId, actorOrgId, { newStatus: ApplicationStatus.Accepted });
    return updated;
  }

  /**
   * Management rejects an application.
   * Enforces APPLICATION_STATUS_TRANSITIONS (Active→Rejected) atomically.
   * Guard: Draft-stage applications cannot be rejected — the candidate has not yet submitted.
   *        Rejection is only meaningful from Submitted stage or later.
   */
  async reject(
    applicationId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string, expectedVersion: number,
  ): Promise<Application> {
    if (!this.hasMgmt(actorRoles)) throw new AuthorizationError('Only management roles can reject applications');
    const app = await this.appRepo.getById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    if (app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (app.status !== ApplicationStatus.Active) throw new ValidationError('Can only reject an active application');
    // Stage guard: Draft applications have not been submitted — reject is meaningless and confusing
    if (app.stage === ApplicationStage.Draft) {
      throw new ValidationError('Cannot reject a Draft application — candidate has not yet submitted. Use deleteDraft() to remove it.');
    }

    const updated = await this.appRepo.updateWithLock(applicationId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('Application', applicationId);
      if (current.status !== ApplicationStatus.Active) throw new ValidationError('Application status changed concurrently');
      if (current.stage === ApplicationStage.Draft) {
        throw new ValidationError('Application reverted to Draft concurrently — cannot reject');
      }
      assertTransition(APPLICATION_STATUS_TRANSITIONS, current.status as ApplicationStatus, ApplicationStatus.Rejected, 'ApplicationStatus');
      return { ...current, status: ApplicationStatus.Rejected, version: current.version + 1, updatedAt: now() };
    });
    await this.audit.log(actorId, AuditAction.ApplicationStatusChanged, 'application', applicationId, actorOrgId, { newStatus: ApplicationStatus.Rejected });
    return updated;
  }

  /**
   * Expire an offer whose deadline has passed.
   * Called by the scheduler — no human actor roles required.
   * Enforces: stage must be OfferExtended, offerExpiresAt must have passed,
   *           APPLICATION_STATUS_TRANSITIONS (Active→Expired) atomically.
   */
  async expireOffer(
    applicationId: string, actorOrgId: string, expectedVersion: number,
  ): Promise<Application> {
    const app = await this.appRepo.getById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    if (app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (app.stage !== ApplicationStage.OfferExtended) {
      throw new ValidationError('Can only expire an application in OfferExtended stage');
    }
    if (app.status !== ApplicationStatus.Active) {
      throw new ValidationError('Can only expire an active application');
    }
    if (!app.offerExpiresAt || new Date(app.offerExpiresAt).getTime() > Date.now()) {
      throw new ValidationError('Offer has not yet expired');
    }

    const updated = await this.appRepo.updateWithLock(applicationId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('Application', applicationId);
      if (current.stage !== ApplicationStage.OfferExtended || current.status !== ApplicationStatus.Active) {
        throw new ValidationError('Application state changed concurrently');
      }
      if (!current.offerExpiresAt || new Date(current.offerExpiresAt).getTime() > Date.now()) {
        throw new ValidationError('Offer expiry state changed concurrently');
      }
      assertTransition(APPLICATION_STATUS_TRANSITIONS, current.status as ApplicationStatus, ApplicationStatus.Expired, 'ApplicationStatus');
      return { ...current, status: ApplicationStatus.Expired, version: current.version + 1, updatedAt: now() };
    });
    await this.audit.log(app.candidateId, AuditAction.ApplicationStatusChanged, 'application', applicationId, actorOrgId, { newStatus: ApplicationStatus.Expired });

    // Notify the candidate that their offer has expired
    this.notifService.createNotification(
      app.candidateId,
      actorOrgId,
      NotificationEventType.OfferExpiring,
      'application',
      applicationId,
      `offer_expired_${applicationId}`,
      'Your offer has expired',
    ).catch(() => {});

    return updated;
  }

  /**
   * Archive a terminal application (Accepted, Rejected, Withdrawn, or Expired → Archived).
   * Management only. Applications must have reached a terminal status before archiving.
   */
  async archiveApplication(
    applicationId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string, expectedVersion: number,
  ): Promise<Application> {
    if (!this.hasMgmt(actorRoles)) throw new AuthorizationError('Only management roles can archive applications');
    const app = await this.appRepo.getById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    if (app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    // Pre-flight: only terminal statuses can be archived
    const archivableStatuses: ApplicationStatus[] = [
      ApplicationStatus.Accepted, ApplicationStatus.Rejected,
      ApplicationStatus.Withdrawn, ApplicationStatus.Expired,
    ];
    if (!archivableStatuses.includes(app.status as ApplicationStatus)) {
      throw new ValidationError(`Cannot archive an application with status '${app.status}' — must be Accepted, Rejected, Withdrawn, or Expired`);
    }

    const updated = await this.appRepo.updateWithLock(applicationId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('Application', applicationId);
      if (!archivableStatuses.includes(current.status as ApplicationStatus)) {
        throw new ValidationError('Application status changed concurrently — no longer archivable');
      }
      assertTransition(APPLICATION_STATUS_TRANSITIONS, current.status as ApplicationStatus, ApplicationStatus.Archived, 'ApplicationStatus');
      return { ...current, status: ApplicationStatus.Archived, version: current.version + 1, updatedAt: now() };
    });
    await this.audit.log(actorId, AuditAction.ApplicationStatusChanged, 'application', applicationId, actorOrgId, { newStatus: ApplicationStatus.Archived });
    return updated;
  }

  /**
   * List all non-deleted applications in the caller's organization.
   * Restricted to management roles (Employer, HRCoordinator, Administrator).
   */
  async listByOrganization(actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<Application[]> {
    if (!this.hasMgmt(actorRoles)) throw new AuthorizationError('Only management roles can list all applications');
    const all = (await this.appRepo.getByOrganization(actorOrgId)).filter(
      a => a.status !== ApplicationStatus.Deleted,
    );
    // Employer: restrict to applications for their own jobs
    if (!this.hasFullOrgAccess(actorRoles)) {
      const ownedJobs = await this.jobRepo.getByOwner(actorId);
      const ownedJobIds = new Set(ownedJobs.filter(j => j.organizationId === actorOrgId).map(j => j.id));
      return all.filter(a => ownedJobIds.has(a.jobId));
    }
    // Administrator: full visibility
    if (actorRoles.includes(UserRole.Administrator)) return all;
    // HRCoordinator: department-scoped (same rule as JobService)
    const actor = await this.userRepo.getById(actorId);
    const actorDept = actor?.departmentId;
    if (actorDept) {
      const orgJobs = await this.jobRepo.getByOrganization(actorOrgId);
      const deptJobIds = new Set(
        orgJobs.filter(j => !j.departmentId || j.departmentId === actorDept).map(j => j.id),
      );
      return all.filter(a => deptJobIds.has(a.jobId));
    }
    return all;
  }
}
