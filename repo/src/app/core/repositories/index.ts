import { Injectable } from '@angular/core';
import { BaseRepository } from '../db/base-repository';
import { Database } from '../db/database';
import {
  User, Session, Job, Application, ApplicationPacket, PacketSection,
  InterviewPlan, Interview, InterviewFeedback, Document, DocumentQuotaUsage,
  Thread, Message, Notification, NotificationPreference, Digest, DelayedDelivery,
  ContentPost, Comment, ModerationCase, SensitiveWord,
  IntegrationRequest, IdempotencyKeyRecord, RateLimitBucket, IntegrationSecret,
  WebhookQueueItem, MetricDefinition, DataDictionaryEntry,
  LineageLink, DatasetSnapshot, AppConfig, StorageReservation, OrgAdminKey,
} from '../models';
import { InterviewStatus } from '../enums';
import { ConflictError } from '../errors';

@Injectable({ providedIn: 'root' })
export class UserRepository extends BaseRepository<User> {
  protected readonly storeName = 'users';
  constructor(db: Database) { super(db); }
  async getByUsername(username: string): Promise<User | null> { return this.getOneByIndex('username', username); }
  async getByOrganization(orgId: string): Promise<User[]> { return this.getAllByIndex('organizationId', orgId); }
}

@Injectable({ providedIn: 'root' })
export class SessionRepository extends BaseRepository<Session> {
  protected readonly storeName = 'sessions';
  constructor(db: Database) { super(db); }
  async getByUserId(userId: string): Promise<Session[]> { return this.getAllByIndex('userId', userId); }
}

@Injectable({ providedIn: 'root' })
export class JobRepository extends BaseRepository<Job> {
  protected readonly storeName = 'jobs';
  constructor(db: Database) { super(db); }
  async getByOrganization(orgId: string): Promise<Job[]> { return this.getAllByIndex('organizationId', orgId); }
  async getByOwner(userId: string): Promise<Job[]> { return this.getAllByIndex('ownerUserId', userId); }
  async getByOrgAndStatus(orgId: string, status: string): Promise<Job[]> { return this.getAllByIndex('org_status', [orgId, status]); }
}

@Injectable({ providedIn: 'root' })
export class ApplicationRepository extends BaseRepository<Application> {
  protected readonly storeName = 'applications';
  constructor(db: Database) { super(db); }
  async getByJob(jobId: string): Promise<Application[]> { return this.getAllByIndex('jobId', jobId); }
  async getByCandidate(candidateId: string): Promise<Application[]> { return this.getAllByIndex('candidateId', candidateId); }
  async getByOrganization(orgId: string): Promise<Application[]> { return this.getAllByIndex('organizationId', orgId); }
  async getByCandidateAndJob(candidateId: string, jobId: string): Promise<Application[]> { return this.getAllByIndex('candidate_job', [candidateId, jobId]); }

  /**
   * Atomically check for duplicate (candidateId+jobId) and add the application.
   * Runs inside a single IDB readwrite transaction to prevent TOCTOU.
   */
  async addAtomicallyIfNoDuplicate(app: Application): Promise<void> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      tx.onerror = () => reject(tx.error);

      const idx = store.index('candidate_job');
      const req = idx.getAll([app.candidateId, app.jobId]);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const existing: Application[] = req.result ?? [];
        const active = existing.filter(a => a.status !== 'deleted');
        if (active.length > 0) {
          tx.abort();
          reject(new ConflictError('You already have an active application for this job'));
          return;
        }
        const addReq = store.add(app);
        addReq.onerror = () => reject(addReq.error);
        addReq.onsuccess = () => resolve();
      };
    });
  }
}

@Injectable({ providedIn: 'root' })
export class ApplicationPacketRepository extends BaseRepository<ApplicationPacket> {
  protected readonly storeName = 'applicationPackets';
  constructor(db: Database) { super(db); }
  async getByApplication(applicationId: string): Promise<ApplicationPacket | null> { return this.getOneByIndex('applicationId', applicationId); }
}

@Injectable({ providedIn: 'root' })
export class PacketSectionRepository extends BaseRepository<PacketSection> {
  protected readonly storeName = 'packetSections';
  constructor(db: Database) { super(db); }
  async getByPacket(packetId: string): Promise<PacketSection[]> { return this.getAllByIndex('applicationPacketId', packetId); }
}

@Injectable({ providedIn: 'root' })
export class InterviewPlanRepository extends BaseRepository<InterviewPlan> {
  protected readonly storeName = 'interviewPlans';
  constructor(db: Database) { super(db); }
  async getByJob(jobId: string): Promise<InterviewPlan[]> { return this.getAllByIndex('jobId', jobId); }
  async getByOrganization(orgId: string): Promise<InterviewPlan[]> { return this.getAllByIndex('organizationId', orgId); }
}

@Injectable({ providedIn: 'root' })
export class InterviewRepository extends BaseRepository<Interview> {
  protected readonly storeName = 'interviews';
  constructor(db: Database) { super(db); }
  async getByApplication(applicationId: string): Promise<Interview[]> { return this.getAllByIndex('applicationId', applicationId); }
  async getByInterviewer(interviewerId: string): Promise<Interview[]> { return this.getAllByIndex('interviewerId', interviewerId); }
  async getByCandidate(candidateId: string): Promise<Interview[]> { return this.getAllByIndex('candidateId', candidateId); }
  async getByOrganization(orgId: string): Promise<Interview[]> { return this.getAllByIndex('organizationId', orgId); }

  /**
   * Atomically check for scheduling conflicts and add a new interview record.
   *
   * All steps — reading existing interviews for the interviewer and candidate,
   * conflict detection, and the final add — run inside a single IDB readwrite
   * transaction.  Because IDB serializes readwrite transactions on the same store,
   * two concurrent scheduleAtomically calls for the same person cannot both pass
   * the conflict check: the second transaction blocks until the first commits, then
   * reads the freshly written record and correctly detects the overlap.
   */
  async scheduleAtomically(interview: Interview): Promise<void> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      tx.onerror = () => reject(tx.error);

      // Step 1: read all scheduled interviews for the interviewer
      const interviewerReq = store.index('interviewerId').getAll(interview.interviewerId);
      interviewerReq.onerror = () => reject(interviewerReq.error);
      interviewerReq.onsuccess = () => {
        const interviewerRows: Interview[] = interviewerReq.result ?? [];

        // Step 2: read all scheduled interviews for the candidate
        const candidateReq = store.index('candidateId').getAll(interview.candidateId);
        candidateReq.onerror = () => reject(candidateReq.error);
        candidateReq.onsuccess = () => {
          const candidateRows: Interview[] = candidateReq.result ?? [];

          // Step 3: deduplicate, skip canceled, check time overlap
          const seen = new Set<string>();
          const combined = [...interviewerRows, ...candidateRows].filter(i => {
            if (seen.has(i.id)) return false; seen.add(i.id); return true;
          });
          for (const existing of combined) {
            if (existing.status === InterviewStatus.Canceled) continue;
            if (interview.startTime < existing.endTime && interview.endTime > existing.startTime) {
              tx.abort();
              reject(new ConflictError(`Scheduling conflict with interview ${existing.id}`));
              return;
            }
          }

          // Step 4: no conflict — add the new interview
          const addReq = store.add(interview);
          addReq.onerror = () => reject(addReq.error);
          addReq.onsuccess = () => resolve();
        };
      };
    });
  }

  /**
   * Atomically check for rescheduling conflicts, call the updater, and write the result.
   *
   * All steps — reading the current record, reading existing interviews for the
   * interviewer and candidate, conflict detection (excluding the interview being
   * rescheduled), calling the updater callback, and the final put — run inside a
   * single IDB readwrite transaction.  The updater is called synchronously inside
   * the IDB event handler; errors thrown by the updater (e.g. OptimisticLockError,
   * ValidationError) propagate as Promise rejections without writing anything.
   */
  async rescheduleAtomically(
    id: string,
    newStartTime: string,
    newEndTime: string,
    updater: (current: Interview) => Interview,
  ): Promise<Interview> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      tx.onerror = () => reject(tx.error);

      // Step 1: read the current interview record
      const getReq = store.get(id);
      getReq.onerror = () => reject(getReq.error);
      getReq.onsuccess = () => {
        const current: Interview = getReq.result;
        if (!current) { reject(new Error(`interviews:${id} not found`)); return; }

        // Step 2: read all interviews for the same interviewer
        const interviewerReq = store.index('interviewerId').getAll(current.interviewerId);
        interviewerReq.onerror = () => reject(interviewerReq.error);
        interviewerReq.onsuccess = () => {
          const interviewerRows: Interview[] = interviewerReq.result ?? [];

          // Step 3: read all interviews for the same candidate
          const candidateReq = store.index('candidateId').getAll(current.candidateId);
          candidateReq.onerror = () => reject(candidateReq.error);
          candidateReq.onsuccess = () => {
            const candidateRows: Interview[] = candidateReq.result ?? [];

            // Step 4: deduplicate, exclude self, skip canceled, check time overlap at new times
            const seen = new Set<string>();
            const combined = [...interviewerRows, ...candidateRows].filter(i => {
              if (seen.has(i.id)) return false; seen.add(i.id); return true;
            });
            for (const existing of combined) {
              if (existing.id === id) continue; // exclude the interview being rescheduled
              if (existing.status === InterviewStatus.Canceled) continue;
              if (newStartTime < existing.endTime && newEndTime > existing.startTime) {
                tx.abort();
                reject(new ConflictError(`Scheduling conflict with interview ${existing.id}`));
                return;
              }
            }

            // Step 5: no conflict — apply updater (may throw OptimisticLockError / ValidationError)
            let updated: Interview;
            try {
              updated = updater(current);
            } catch (err) {
              reject(err);
              return;
            }

            // Step 6: write the updated record
            const putReq = store.put(updated);
            putReq.onerror = () => reject(putReq.error);
            putReq.onsuccess = () => resolve(updated);
          };
        };
      };
    });
  }
}

@Injectable({ providedIn: 'root' })
export class InterviewFeedbackRepository extends BaseRepository<InterviewFeedback> {
  protected readonly storeName = 'interviewFeedback';
  constructor(db: Database) { super(db); }
  async getByInterview(interviewId: string): Promise<InterviewFeedback[]> { return this.getAllByIndex('interviewId', interviewId); }
  async getByInterviewer(interviewerId: string): Promise<InterviewFeedback[]> { return this.getAllByIndex('interviewerId', interviewerId); }
}

@Injectable({ providedIn: 'root' })
export class DocumentRepository extends BaseRepository<Document> {
  protected readonly storeName = 'documents';
  constructor(db: Database) { super(db); }
  async getByOwner(userId: string): Promise<Document[]> { return this.getAllByIndex('ownerUserId', userId); }
  async getByApplication(applicationId: string): Promise<Document[]> { return this.getAllByIndex('applicationId', applicationId); }
  async getByOrganization(orgId: string): Promise<Document[]> { return this.getAllByIndex('organizationId', orgId); }
}

@Injectable({ providedIn: 'root' })
export class DocumentQuotaRepository {
  private readonly storeName = 'documentQuotaUsage';
  constructor(private readonly database: Database) {}
  async get(userId: string): Promise<DocumentQuotaUsage | null> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => { const tx = db.transaction(this.storeName, 'readonly'); const req = tx.objectStore(this.storeName).get(userId); req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => reject(req.error); });
  }
  async put(item: DocumentQuotaUsage): Promise<void> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => { const tx = db.transaction(this.storeName, 'readwrite'); const req = tx.objectStore(this.storeName).put(item); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); });
  }
}

@Injectable({ providedIn: 'root' })
export class ThreadRepository extends BaseRepository<Thread> {
  protected readonly storeName = 'threads';
  constructor(db: Database) { super(db); }
  async getByContext(contextType: string, contextId: string): Promise<Thread[]> { return this.getAllByIndex('contextType_contextId', [contextType, contextId]); }
  async getByOrganization(orgId: string): Promise<Thread[]> { return this.getAllByIndex('organizationId', orgId); }
}

@Injectable({ providedIn: 'root' })
export class MessageRepository extends BaseRepository<Message> {
  protected readonly storeName = 'messages';
  constructor(db: Database) { super(db); }
  async getByThread(threadId: string): Promise<Message[]> { return this.getAllByIndex('threadId', threadId); }
}

@Injectable({ providedIn: 'root' })
export class NotificationRepository extends BaseRepository<Notification> {
  protected readonly storeName = 'notifications';
  constructor(db: Database) { super(db); }
  async getByUser(userId: string): Promise<Notification[]> { return this.getAllByIndex('userId', userId); }
  async getByEventId(eventId: string): Promise<Notification[]> { return this.getAllByIndex('eventId', eventId); }
  async getByUserAndType(userId: string, type: string): Promise<Notification[]> { return this.getAllByIndex('user_type', [userId, type]); }
}

@Injectable({ providedIn: 'root' })
export class NotificationPreferenceRepository extends BaseRepository<NotificationPreference> {
  protected readonly storeName = 'notificationPreferences';
  constructor(db: Database) { super(db); }
  async getByUser(userId: string): Promise<NotificationPreference[]> { return this.getAllByIndex('userId', userId); }
  async getByUserAndType(userId: string, eventType: string): Promise<NotificationPreference | null> { return this.getOneByIndex('user_eventType', [userId, eventType]); }
}

@Injectable({ providedIn: 'root' })
export class DigestRepository extends BaseRepository<Digest> {
  protected readonly storeName = 'digests';
  constructor(db: Database) { super(db); }
  async getByUser(userId: string): Promise<Digest[]> { return this.getAllByIndex('userId', userId); }
  async getByUniqueKey(uniqueKey: string): Promise<Digest | null> { return this.getOneByIndex('uniqueKey', uniqueKey); }
}

@Injectable({ providedIn: 'root' })
export class DelayedDeliveryRepository extends BaseRepository<DelayedDelivery> {
  protected readonly storeName = 'delayedDeliveries';
  constructor(db: Database) { super(db); }
  async getByUser(userId: string): Promise<DelayedDelivery[]> { return this.getAllByIndex('userId', userId); }
}

@Injectable({ providedIn: 'root' })
export class ContentPostRepository extends BaseRepository<ContentPost> {
  protected readonly storeName = 'contentPosts';
  constructor(db: Database) { super(db); }
  async getByOrganization(orgId: string): Promise<ContentPost[]> { return this.getAllByIndex('organizationId', orgId); }
  async getByAuthor(authorId: string): Promise<ContentPost[]> { return this.getAllByIndex('authorId', authorId); }
  async getByStatus(status: string): Promise<ContentPost[]> { return this.getAllByIndex('status', status); }
}

@Injectable({ providedIn: 'root' })
export class CommentRepository extends BaseRepository<Comment> {
  protected readonly storeName = 'contentComments';
  constructor(db: Database) { super(db); }
  async getByPost(postId: string): Promise<Comment[]> { return this.getAllByIndex('postId', postId); }
  async getByStatus(status: string): Promise<Comment[]> { return this.getAllByIndex('status', status); }
  async getByAuthor(authorId: string): Promise<Comment[]> { return this.getAllByIndex('authorId', authorId); }
}

@Injectable({ providedIn: 'root' })
export class ModerationCaseRepository extends BaseRepository<ModerationCase> {
  protected readonly storeName = 'moderationCases';
  constructor(db: Database) { super(db); }
  async getByComment(commentId: string): Promise<ModerationCase[]> { return this.getAllByIndex('commentId', commentId); }
}

@Injectable({ providedIn: 'root' })
export class SensitiveWordRepository {
  private readonly storeName = 'sensitiveWords';
  constructor(private readonly database: Database) {}
  async getAll(): Promise<SensitiveWord[]> { const db = await this.database.getDb(); return new Promise((resolve, reject) => { const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAll(); req.onsuccess = () => resolve(req.result ?? []); req.onerror = () => reject(req.error); }); }
  async add(item: SensitiveWord): Promise<void> { const db = await this.database.getDb(); return new Promise((resolve, reject) => { const req = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).add(item); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }); }
  async delete(id: string): Promise<void> { const db = await this.database.getDb(); return new Promise((resolve, reject) => { const req = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).delete(id); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }); }
}

@Injectable({ providedIn: 'root' })
export class IntegrationRequestRepository extends BaseRepository<IntegrationRequest> {
  protected readonly storeName = 'integrationRequests';
  constructor(db: Database) { super(db); }
  async getByIntegrationKey(key: string): Promise<IntegrationRequest[]> { return this.getAllByIndex('integrationKey', key); }
}

@Injectable({ providedIn: 'root' })
export class IdempotencyKeyRepository {
  private readonly storeName = 'idempotencyKeys';
  constructor(private readonly database: Database) {}
  async get(key: string): Promise<IdempotencyKeyRecord | null> { const db = await this.database.getDb(); return new Promise((resolve, reject) => { const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(key); req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => reject(req.error); }); }
  async put(item: IdempotencyKeyRecord): Promise<void> { const db = await this.database.getDb(); return new Promise((resolve, reject) => { const req = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put(item); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }); }
  async deleteExpired(now: string): Promise<void> { const db = await this.database.getDb(); return new Promise((resolve, reject) => { const tx = db.transaction(this.storeName, 'readwrite'); const idx = tx.objectStore(this.storeName).index('expiresAt'); const req = idx.openCursor(IDBKeyRange.upperBound(now)); req.onsuccess = () => { const cursor = req.result; if (cursor) { cursor.delete(); cursor.continue(); } }; tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
}

@Injectable({ providedIn: 'root' })
export class RateLimitBucketRepository {
  private readonly storeName = 'rateLimitBuckets';
  constructor(private readonly database: Database) {}
  async get(integrationKey: string): Promise<RateLimitBucket | null> { const db = await this.database.getDb(); return new Promise((resolve, reject) => { const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(integrationKey); req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => reject(req.error); }); }
  async put(item: RateLimitBucket): Promise<void> { const db = await this.database.getDb(); return new Promise((resolve, reject) => { const req = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put(item); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }); }
}

@Injectable({ providedIn: 'root' })
export class IntegrationSecretRepository extends BaseRepository<IntegrationSecret> {
  protected readonly storeName = 'activeIntegrationSecrets';
  constructor(db: Database) { super(db); }
  async getByIntegrationKey(key: string): Promise<IntegrationSecret[]> { return this.getAllByIndex('integrationKey', key); }
  async getByOrgAndKey(orgId: string, key: string): Promise<IntegrationSecret[]> { return this.getAllByIndex('org_key', [orgId, key]); }
  async getByOrganization(orgId: string): Promise<IntegrationSecret[]> { return this.getAllByIndex('organizationId', orgId); }
}

@Injectable({ providedIn: 'root' })
export class WebhookQueueRepository extends BaseRepository<WebhookQueueItem> {
  protected readonly storeName = 'webhookQueue';
  constructor(db: Database) { super(db); }
  async getByStatus(status: string): Promise<WebhookQueueItem[]> { return this.getAllByIndex('status', status); }
  async getPendingRetries(now: string): Promise<WebhookQueueItem[]> { const pending = await this.getByStatus('pending'); return pending.filter(item => item.nextRetryAt <= now); }
}

// AuditLogRepository is intentionally NOT exported here.
// It lives in src/app/core/db/audit-log.repository.ts and is accessible
// only to AuditService.  This prevents other services from bypassing the
// RBAC checks and hash-chain integrity enforced by AuditService.

@Injectable({ providedIn: 'root' })
export class MetricDefinitionRepository extends BaseRepository<MetricDefinition> {
  protected readonly storeName = 'metricDefinitions';
  constructor(db: Database) { super(db); }
}

@Injectable({ providedIn: 'root' })
export class DataDictionaryRepository extends BaseRepository<DataDictionaryEntry> {
  protected readonly storeName = 'dataDictionaryEntries';
  constructor(db: Database) { super(db); }
  async getByEntityType(entityType: string): Promise<DataDictionaryEntry[]> { return this.getAllByIndex('entityType', entityType); }
}

@Injectable({ providedIn: 'root' })
export class LineageLinkRepository extends BaseRepository<LineageLink> {
  protected readonly storeName = 'lineageLinks';
  constructor(db: Database) { super(db); }
  async getFromEntity(entityType: string, entityId: string): Promise<LineageLink[]> { return this.getAllByIndex('fromEntityType_fromEntityId', [entityType, entityId]); }
  async getToEntity(entityType: string, entityId: string): Promise<LineageLink[]> { return this.getAllByIndex('toEntityType_toEntityId', [entityType, entityId]); }
}

@Injectable({ providedIn: 'root' })
export class DatasetSnapshotRepository extends BaseRepository<DatasetSnapshot> {
  protected readonly storeName = 'datasetSnapshots';
  constructor(db: Database) { super(db); }
  async getByOrganization(orgId: string): Promise<DatasetSnapshot[]> { return this.getAllByIndex('organizationId', orgId); }
}

@Injectable({ providedIn: 'root' })
export class OrgAdminKeyRepository {
  private readonly storeName = 'orgAdminKeys';
  constructor(private readonly database: Database) {}
  async getByOrg(orgId: string): Promise<OrgAdminKey | null> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(orgId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }
  async put(item: OrgAdminKey): Promise<void> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

@Injectable({ providedIn: 'root' })
export class AppConfigRepository {
  private readonly storeName = 'appConfig';
  constructor(private readonly database: Database) {}
  async get(key: string): Promise<AppConfig | null> { const db = await this.database.getDb(); return new Promise((resolve, reject) => { const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(key); req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => reject(req.error); }); }
  async put(item: AppConfig): Promise<void> { const db = await this.database.getDb(); return new Promise((resolve, reject) => { const req = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put(item); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }); }
}

@Injectable({ providedIn: 'root' })
export class StorageReservationRepository extends BaseRepository<StorageReservation> {
  protected readonly storeName = 'storageReservations';
  constructor(db: Database) { super(db); }
  async getByUser(userId: string): Promise<StorageReservation[]> { return this.getAllByIndex('userId', userId); }
}
