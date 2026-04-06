import { Injectable } from '@angular/core';
import { DocumentRepository, DocumentQuotaRepository, ApplicationPacketRepository, ApplicationRepository, JobRepository, LineageLinkRepository, UserRepository, InterviewRepository, OrgAdminKeyRepository } from '../repositories';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { NotificationService } from './notification.service';
import { Document as TBDoc } from '../models';
import { DocumentStatus, PacketStatus, AuditAction, UserRole, NotificationEventType } from '../enums';
import { DOCUMENT_CONSTANTS } from '../constants';
import { generateId, now } from '../utils/id';
import { AuthorizationError, NotFoundError, ValidationError, QuotaExceededError } from '../errors';

@Injectable({ providedIn: 'root' })
export class DocumentService {
  constructor(
    private readonly docRepo: DocumentRepository,
    private readonly quotaRepo: DocumentQuotaRepository,
    private readonly packetRepo: ApplicationPacketRepository,
    private readonly lineageRepo: LineageLinkRepository,
    private readonly userRepo: UserRepository,
    private readonly interviewRepo: InterviewRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly appRepo: ApplicationRepository,
    private readonly jobRepo: JobRepository,
    private readonly notifService: NotificationService,
    private readonly orgAdminKeyRepo: OrgAdminKeyRepository,
  ) {}

  async uploadDocument(
    file: { name: string; type: string; size: number; data: ArrayBuffer },
    applicationId: string | null,
    actorId: string,
    actorOrgId: string,
    password: string,
    documentType?: string | null,
  ): Promise<TBDoc> {
    if (!DOCUMENT_CONSTANTS.ALLOWED_MIME_TYPES.includes(file.type)) {
      throw new ValidationError(`Unsupported file type: ${file.type}`);
    }
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    const allowedExts = DOCUMENT_CONSTANTS.MIME_EXTENSION_MAP.get(file.type);
    if (!allowedExts || !allowedExts.includes(ext)) {
      throw new ValidationError(`Extension ${ext} does not match MIME ${file.type}`);
    }
    if (file.size > DOCUMENT_CONSTANTS.MAX_FILE_SIZE_BYTES) throw new QuotaExceededError('File too large');

    const quota = await this.quotaRepo.get(actorId);
    const currentUsage = quota?.totalBytes ?? 0;
    if (currentUsage + file.size > DOCUMENT_CONSTANTS.MAX_ACCOUNT_STORAGE_BYTES) {
      throw new QuotaExceededError('Account storage quota exceeded');
    }

    const user = await this.userRepo.getById(actorId);
    if (!user) throw new NotFoundError('User', actorId);
    if (!user.encryptionKeySalt) throw new ValidationError('User has no encryption key salt — account setup incomplete');

    // Convert ArrayBuffer to hex string, then encrypt with AES-GCM
    const hexData = this.bufferToHex(new Uint8Array(file.data));
    const key = await this.crypto.deriveEncryptionKey(password, user.encryptionKeySalt);
    const { iv, ciphertext } = await this.crypto.encrypt(hexData, key);

    // Also encrypt with the org-level admin key so HR/Admin can read without the owner password.
    const adminSecret = await this.getOrCreateOrgAdminSecret(actorOrgId);
    const adminKey = await this.crypto.deriveEncryptionKey(adminSecret, actorOrgId);
    const { iv: adminIv, ciphertext: adminCiphertext } = await this.crypto.encrypt(hexData, adminKey);

    const doc: TBDoc = {
      id: generateId(), ownerUserId: actorId, organizationId: actorOrgId, applicationId,
      fileName: file.name, mimeType: file.type, extension: ext, sizeBytes: file.size,
      documentType: documentType ?? null,
      encryptedBlob: ciphertext, encryptionIv: iv,
      adminEncryptedBlob: adminCiphertext, adminEncryptionIv: adminIv,
      status: DocumentStatus.Uploaded, version: 1, createdAt: now(), updatedAt: now(),
    };
    await this.docRepo.add(doc);
    await this.quotaRepo.put({ userId: actorId, totalBytes: currentUsage + file.size, updatedAt: now() });
    if (applicationId) {
      await this.lineageRepo.add({ id: generateId(), fromEntityType: 'application', fromEntityId: applicationId, toEntityType: 'document', toEntityId: doc.id });
    }
    await this.audit.log(actorId, AuditAction.DocumentUploaded, 'document', doc.id, actorOrgId, { fileName: file.name, sizeBytes: file.size });
    return doc;
  }

  async downloadDocument(
    documentId: string,
    password: string,
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<{ blob: Blob; fileName: string; mimeType: string }> {
    const doc = await this.docRepo.getById(documentId);
    if (!doc) throw new NotFoundError('Document', documentId);
    if (doc.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');

    // Status gate: Archived documents are inaccessible to everyone.
    // Rejected documents are only accessible to HR/Admin for audit purposes.
    if (doc.status === DocumentStatus.Archived) {
      throw new AuthorizationError('Document is archived and cannot be downloaded');
    }
    if (doc.status === DocumentStatus.Rejected && !this.hasFullOrgAccess(actorRoles)) {
      throw new AuthorizationError('Document has been rejected and is not accessible');
    }

    if (doc.ownerUserId !== actorId) {
      if (this.hasFullOrgAccess(actorRoles)) {
        // HR/Admin: org-wide access
      } else if (actorRoles.includes(UserRole.Employer)) {
        const allowed = await this.isEmployerAuthorizedForDocument(doc, actorId, actorOrgId);
        if (!allowed) throw new AuthorizationError('Not authorized to download this document');
      } else if (actorRoles.includes(UserRole.Interviewer)) {
        const allowed = await this.isInterviewerAuthorizedForDocument(doc, actorId, actorOrgId);
        if (!allowed) throw new AuthorizationError('Not authorized to download this document');
      } else {
        throw new AuthorizationError('Not authorized to download this document');
      }
    }
    if (!doc.encryptedBlob || !doc.encryptionIv) {
      throw new ValidationError('Document has no encrypted content');
    }

    let hexData: string;
    if (doc.ownerUserId !== actorId && this.hasFullOrgAccess(actorRoles) && doc.adminEncryptedBlob && doc.adminEncryptionIv) {
      // HR/Admin non-owner access: use org-level admin key (no owner password required).
      const adminSecret = await this.getOrCreateOrgAdminSecret(doc.organizationId);
      const adminKey = await this.crypto.deriveEncryptionKey(adminSecret, doc.organizationId);
      hexData = await this.crypto.decrypt(doc.adminEncryptedBlob, doc.adminEncryptionIv, adminKey);
    } else {
      // Owner or other authorized roles: derive key from owner password.
      const user = await this.userRepo.getById(doc.ownerUserId);
      if (!user) throw new NotFoundError('User', doc.ownerUserId);
      if (!user.encryptionKeySalt) throw new ValidationError('Document owner has no encryption key salt');
      const key = await this.crypto.deriveEncryptionKey(password, user.encryptionKeySalt);
      hexData = await this.crypto.decrypt(doc.encryptedBlob, doc.encryptionIv, key);
    }
    const buffer = this.hexToBuffer(hexData);
    const blob = new Blob([buffer], { type: doc.mimeType });

    await this.audit.log(actorId, AuditAction.DocumentDownloaded, 'document', documentId, actorOrgId);
    return { blob, fileName: doc.fileName, mimeType: doc.mimeType };
  }

  async getDocument(documentId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<TBDoc> {
    const doc = await this.docRepo.getById(documentId);
    if (!doc) throw new NotFoundError('Document', documentId);
    if (doc.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');

    // Status gate mirrors downloadDocument — archived is fully blocked, rejected is HR/Admin only
    if (doc.status === DocumentStatus.Archived) {
      throw new AuthorizationError('Document is archived and cannot be accessed');
    }
    if (doc.status === DocumentStatus.Rejected && !this.hasFullOrgAccess(actorRoles)) {
      throw new AuthorizationError('Document has been rejected and is not accessible');
    }

    if (doc.ownerUserId !== actorId) {
      if (this.hasFullOrgAccess(actorRoles)) {
        // HR/Admin: org-wide access — already past org check above
      } else if (actorRoles.includes(UserRole.Employer)) {
        const allowed = await this.isEmployerAuthorizedForDocument(doc, actorId, actorOrgId);
        if (!allowed) throw new AuthorizationError('Not authorized to access this document');
      } else if (actorRoles.includes(UserRole.Interviewer)) {
        const allowed = await this.isInterviewerAuthorizedForDocument(doc, actorId, actorOrgId);
        if (!allowed) throw new AuthorizationError('Not authorized');
      } else {
        throw new AuthorizationError('Not authorized');
      }
    }
    return doc;
  }

  async deleteDocument(documentId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<void> {
    const doc = await this.docRepo.getById(documentId);
    if (!doc) throw new NotFoundError('Document', documentId);
    if (doc.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (doc.ownerUserId !== actorId && !actorRoles.includes(UserRole.Administrator)) {
      throw new AuthorizationError('Not authorized');
    }
    if (doc.applicationId) {
      const packet = await this.packetRepo.getByApplication(doc.applicationId);
      if (packet && (packet.status === PacketStatus.Submitted || packet.status === PacketStatus.Locked)) {
        throw new ValidationError('Cannot delete document linked to submitted/locked packet');
      }
    }
    const quota = await this.quotaRepo.get(doc.ownerUserId);
    if (quota) {
      quota.totalBytes = Math.max(0, quota.totalBytes - doc.sizeBytes);
      quota.updatedAt = now();
      await this.quotaRepo.put(quota);
    }
    await this.docRepo.delete(documentId);
    await this.audit.log(actorId, AuditAction.DocumentDeleted, 'document', documentId, actorOrgId);
  }

  async listByOwner(ownerId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<TBDoc[]> {
    // Own documents — always accessible
    if (ownerId === actorId) {
      return (await this.docRepo.getByOwner(ownerId)).filter(d => d.organizationId === actorOrgId);
    }
    // HR/Admin: org-wide document access
    if (this.hasFullOrgAccess(actorRoles)) {
      return (await this.docRepo.getByOwner(ownerId)).filter(d => d.organizationId === actorOrgId);
    }
    const docs = (await this.docRepo.getByOwner(ownerId)).filter(d => d.organizationId === actorOrgId);
    // Employer: only docs linked to applications for their own jobs
    if (actorRoles.includes(UserRole.Employer)) {
      const ownedJobs = await this.jobRepo.getByOwner(actorId);
      const ownedJobIds = new Set(ownedJobs.filter(j => j.organizationId === actorOrgId).map(j => j.id));
      const orgApps = await this.appRepo.getByOrganization(actorOrgId);
      const authorizedAppIds = new Set(orgApps.filter(a => ownedJobIds.has(a.jobId)).map(a => a.id));
      return docs.filter(d => d.applicationId !== null && authorizedAppIds.has(d.applicationId));
    }
    // Interviewer: only docs linked to their assigned interviews
    if (actorRoles.includes(UserRole.Interviewer)) {
      const interviews = await this.interviewRepo.getByInterviewer(actorId);
      const authorizedAppIds = new Set(
        interviews.filter(i => i.organizationId === actorOrgId).map(i => i.applicationId),
      );
      return docs.filter(d => d.applicationId !== null && authorizedAppIds.has(d.applicationId));
    }
    // Candidate trying to view other user's docs
    throw new AuthorizationError('Cannot view other documents');
  }

  /**
   * Return all documents the actor is authorized to see within their org.
   *   Candidate        → own docs only
   *   HR / Admin       → all org docs
   *   Employer         → docs linked to applications for their jobs
   *   Interviewer      → docs linked to their assigned interviews
   */
  async listAuthorized(actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<TBDoc[]> {
    if (this.hasFullOrgAccess(actorRoles)) {
      return this.docRepo.getByOrganization(actorOrgId);
    }
    if (actorRoles.includes(UserRole.Employer)) {
      const ownedJobs = await this.jobRepo.getByOwner(actorId);
      const ownedJobIds = new Set(ownedJobs.filter(j => j.organizationId === actorOrgId).map(j => j.id));
      const orgApps = await this.appRepo.getByOrganization(actorOrgId);
      const authorizedAppIds = new Set(orgApps.filter(a => ownedJobIds.has(a.jobId)).map(a => a.id));
      const orgDocs = await this.docRepo.getByOrganization(actorOrgId);
      return orgDocs.filter(d => d.applicationId !== null && authorizedAppIds.has(d.applicationId));
    }
    if (actorRoles.includes(UserRole.Interviewer)) {
      const interviews = await this.interviewRepo.getByInterviewer(actorId);
      const authorizedAppIds = new Set(
        interviews.filter(i => i.organizationId === actorOrgId).map(i => i.applicationId),
      );
      const orgDocs = await this.docRepo.getByOrganization(actorOrgId);
      return orgDocs.filter(d => d.applicationId !== null && authorizedAppIds.has(d.applicationId));
    }
    // Candidate: own docs only
    return (await this.docRepo.getByOwner(actorId)).filter(d => d.organizationId === actorOrgId);
  }

  /**
   * Mark a document as reviewed (HR/Admin only).
   * Updates status to Reviewed, emits audit log, and notifies the document owner.
   */
  async reviewDocument(
    documentId: string,
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<TBDoc> {
    if (!this.hasFullOrgAccess(actorRoles)) {
      throw new AuthorizationError('Only HR Coordinators or Administrators can review documents');
    }
    const doc = await this.docRepo.getById(documentId);
    if (!doc) throw new NotFoundError('Document', documentId);
    if (doc.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (doc.status === DocumentStatus.Reviewed) {
      return doc; // idempotent
    }

    const updated = await this.docRepo.updateWithLock(documentId, (current) => ({
      ...current,
      status: DocumentStatus.Reviewed,
      version: current.version + 1,
      updatedAt: now(),
    }));

    await this.audit.log(actorId, AuditAction.DocumentReviewed, 'document', documentId, actorOrgId);

    // Notify the document owner that their document was reviewed
    this.notifService.createNotification(
      doc.ownerUserId,
      actorOrgId,
      NotificationEventType.DocumentReviewed,
      'document',
      documentId,
      `doc_reviewed_${documentId}`,
      `Your document "${doc.fileName}" has been reviewed`,
    ).catch(() => {}); // notification failure must never block the main flow

    return updated;
  }

  /**
   * Returns true iff an Interviewer is authorized to access a specific document.
   * Interviewers may only access documents that are linked (via applicationId) to
   * an application for which they are the assigned interviewer.
   * Documents with no applicationId are never accessible to Interviewers via this path.
   */
  private async isInterviewerAuthorizedForDocument(doc: TBDoc, actorId: string, actorOrgId: string): Promise<boolean> {
    if (!doc.applicationId) return false;
    const interviews = await this.interviewRepo.getByInterviewer(actorId);
    return interviews.some(i => i.applicationId === doc.applicationId && i.organizationId === actorOrgId);
  }

  private canReview(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.Employer || r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  /**
   * Get the org-level admin secret, generating and storing one if it doesn't exist yet.
   * The secret is 32 random bytes (64 hex chars) unique to each organization.
   * It replaces the old hardcoded ADMIN_KEY_PASSPHRASE so the key is never in source code.
   */
  private async getOrCreateOrgAdminSecret(orgId: string): Promise<string> {
    const existing = await this.orgAdminKeyRepo.getByOrg(orgId);
    if (existing) return existing.secret;
    const secretBytes = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    await this.orgAdminKeyRepo.put({ organizationId: orgId, secret: secretBytes, createdAt: now(), rotatedAt: null });
    return secretBytes;
  }

  /** HR Coordinator and Administrator have org-wide access; Employer does NOT. */
  private hasFullOrgAccess(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  /**
   * Employer-specific document authorization.
   * An Employer can access a document if:
   *   (a) they own it, OR
   *   (b) it is linked to an application for one of their jobs.
   */
  private async isEmployerAuthorizedForDocument(doc: TBDoc, actorId: string, actorOrgId: string): Promise<boolean> {
    if (doc.ownerUserId === actorId) return true;
    if (!doc.applicationId) return false;
    const app = await this.appRepo.getById(doc.applicationId);
    if (!app || app.organizationId !== actorOrgId) return false;
    const job = await this.jobRepo.getById(app.jobId);
    return !!job && job.ownerUserId === actorId && job.organizationId === actorOrgId;
  }

  private bufferToHex(buffer: Uint8Array): string {
    return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private hexToBuffer(hex: string): Uint8Array {
    const buf = new Uint8Array(new ArrayBuffer(hex.length / 2));
    for (let i = 0; i < hex.length; i += 2) { buf[i / 2] = parseInt(hex.substring(i, i + 2), 16); }
    return buf;
  }
}
