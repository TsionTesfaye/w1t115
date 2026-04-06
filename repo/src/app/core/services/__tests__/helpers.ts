/**
 * In-memory test doubles for repositories and cross-cutting services.
 *
 * Rules:
 *  • No Angular DI — services are instantiated with `new ServiceName(...)`.
 *  • No IndexedDB — all state is a plain in-memory array.
 *  • updateWithLock() propagates errors thrown by the updater (same semantics
 *    as the IDB version: atomicity + throw-on-conflict).
 *  • Factory helpers produce valid minimal entity objects; tests pass overrides.
 */

import {
  Job, Application, Interview, Document as TBDoc,
  Thread, Message, Notification, NotificationPreference,
  DocumentQuotaUsage, ApplicationPacket, LineageLink, User,
  Session, Comment, ModerationCase, SensitiveWord,
  IntegrationSecret, WebhookQueueItem, IdempotencyKeyRecord, IntegrationResponse, OrgAdminKey,
} from '../../models';
import {
  PacketStatus, NotificationDeliveryMode, InterviewStatus,
  CommentStatus, WebhookQueueStatus, UserRole,
} from '../../enums';
import { ConflictError } from '../../errors';
import { generateId, now } from '../../utils/id';

// ── Generic in-memory CRUD store ───────────────────────────────────────────

export class FakeStore<T extends { id: string }> {
  protected store: T[] = [];

  seed(items: T[]): this { this.store = [...items]; return this; }
  snapshot(): T[] { return [...this.store]; }

  async getById(id: string): Promise<T | null> {
    return this.store.find(i => i.id === id) ?? null;
  }
  async getAll(): Promise<T[]> { return [...this.store]; }
  async add(item: T): Promise<void> { this.store.push(item); }
  async put(item: T): Promise<void> {
    const idx = this.store.findIndex(i => i.id === item.id);
    if (idx >= 0) this.store[idx] = item; else this.store.push(item);
  }
  async delete(id: string): Promise<void> {
    this.store = this.store.filter(i => i.id !== id);
  }

  /**
   * Mirrors BaseRepository.updateWithLock():
   * reads the current record, runs the updater (may throw), writes the result.
   * In-memory so truly atomic — no concurrent writes possible in a single JS thread.
   */
  async updateWithLock(id: string, updater: (current: T) => T): Promise<T> {
    const idx = this.store.findIndex(i => i.id === id);
    if (idx < 0) throw new Error(`FakeStore: not found: ${id}`);
    const updated = updater(this.store[idx]); // propagates any errors the updater throws
    this.store[idx] = updated;
    return updated;
  }
}

// ── Specialised repository fakes ───────────────────────────────────────────

export class FakeJobRepo extends FakeStore<Job> {
  async getByOrganization(orgId: string) { return this.store.filter(j => j.organizationId === orgId); }
  async getByOwner(userId: string) { return this.store.filter(j => j.ownerUserId === userId); }
  async getByOrgAndStatus(orgId: string, status: string) {
    return this.store.filter(j => j.organizationId === orgId && j.status === status);
  }
}

export class FakeApplicationRepo extends FakeStore<Application> {
  async getByJob(jobId: string) { return this.store.filter(a => a.jobId === jobId); }
  async getByCandidate(id: string) { return this.store.filter(a => a.candidateId === id); }
  async getByOrganization(orgId: string) { return this.store.filter(a => a.organizationId === orgId); }
  async getByCandidateAndJob(cId: string, jId: string) {
    return this.store.filter(a => a.candidateId === cId && a.jobId === jId);
  }
  async addAtomicallyIfNoDuplicate(app: Application): Promise<void> {
    const existing = this.store.filter(a => a.candidateId === app.candidateId && a.jobId === app.jobId && a.status !== 'deleted');
    if (existing.length > 0) throw new ConflictError('You already have an active application for this job');
    this.store.push(app);
  }
}

export class FakeInterviewRepo extends FakeStore<Interview> {
  async getByApplication(appId: string) { return this.store.filter(i => i.applicationId === appId); }
  async getByInterviewer(id: string) { return this.store.filter(i => i.interviewerId === id); }
  async getByCandidate(id: string) { return this.store.filter(i => i.candidateId === id); }
  async getByOrganization(orgId: string) { return this.store.filter(i => i.organizationId === orgId); }

  /**
   * In-memory mirror of InterviewRepository.scheduleAtomically().
   * Checks for time conflicts involving the same interviewer or candidate, then adds.
   */
  async scheduleAtomically(interview: Interview): Promise<void> {
    for (const existing of this.store) {
      if (existing.status === InterviewStatus.Canceled) continue;
      if (existing.interviewerId !== interview.interviewerId && existing.candidateId !== interview.candidateId) continue;
      if (interview.startTime < existing.endTime && interview.endTime > existing.startTime) {
        throw new ConflictError(`Scheduling conflict with interview ${existing.id}`);
      }
    }
    this.store.push(interview);
  }

  /**
   * In-memory mirror of InterviewRepository.rescheduleAtomically().
   * Checks for conflicts at the new times (excluding self), then applies the updater.
   */
  async rescheduleAtomically(
    id: string,
    newStartTime: string,
    newEndTime: string,
    updater: (current: Interview) => Interview,
  ): Promise<Interview> {
    const idx = this.store.findIndex(i => i.id === id);
    if (idx < 0) throw new Error(`FakeInterviewRepo: not found: ${id}`);
    const current = this.store[idx];
    for (const existing of this.store) {
      if (existing.id === id) continue;
      if (existing.status === InterviewStatus.Canceled) continue;
      if (existing.interviewerId !== current.interviewerId && existing.candidateId !== current.candidateId) continue;
      if (newStartTime < existing.endTime && newEndTime > existing.startTime) {
        throw new ConflictError(`Scheduling conflict with interview ${existing.id}`);
      }
    }
    const updated = updater(current); // may throw OptimisticLockError / ValidationError
    this.store[idx] = updated;
    return updated;
  }
}

export class FakeDocumentRepo extends FakeStore<TBDoc> {
  async getByOwner(userId: string) { return this.store.filter(d => d.ownerUserId === userId); }
  async getByOrganization(orgId: string) { return this.store.filter(d => d.organizationId === orgId); }
}

export class FakeDocumentQuotaRepo {
  private quotas = new Map<string, DocumentQuotaUsage>();
  async get(userId: string): Promise<DocumentQuotaUsage | null> { return this.quotas.get(userId) ?? null; }
  async put(item: DocumentQuotaUsage): Promise<void> { this.quotas.set(item.userId, item); }
}

export class FakeApplicationPacketRepo {
  private packets: ApplicationPacket[] = [];
  seed(items: ApplicationPacket[]): this { this.packets = [...items]; return this; }
  async getByApplication(appId: string): Promise<ApplicationPacket | null> {
    return this.packets.find(p => p.applicationId === appId) ?? null;
  }
  async getById(id: string) { return this.packets.find(p => p.id === id) ?? null; }
  async add(item: ApplicationPacket) { this.packets.push(item); }
  async put(item: ApplicationPacket) {
    const idx = this.packets.findIndex(p => p.id === item.id);
    if (idx >= 0) this.packets[idx] = item; else this.packets.push(item);
  }
}

export class FakeUserRepo extends FakeStore<User> {
  async getByUsername(username: string): Promise<User | null> {
    return this.store.find(u => u.username === username) ?? null;
  }
  async getByOrganization(orgId: string) { return this.store.filter(u => u.organizationId === orgId); }
}

export class FakeThreadRepo extends FakeStore<Thread> {
  async getByOrganization(orgId: string) { return this.store.filter(t => t.organizationId === orgId); }
}

export class FakeMessageRepo extends FakeStore<Message> {
  async getByThread(threadId: string) { return this.store.filter(m => m.threadId === threadId); }
}

export class FakeNotificationRepo extends FakeStore<Notification> {
  async getByUser(userId: string) { return this.store.filter(n => n.userId === userId); }
  async getByEventId(eventId: string) { return this.store.filter(n => n.eventId === eventId); }
  async getByUserAndType(userId: string, type: string) {
    return this.store.filter(n => n.userId === userId && n.type === type);
  }
}

export class FakeNotificationPreferenceRepo {
  private prefs: NotificationPreference[] = [];
  seed(items: NotificationPreference[]): this { this.prefs = [...items]; return this; }
  async getByUser(userId: string) { return this.prefs.filter(p => p.userId === userId); }
  async getByUserAndType(userId: string, type: string): Promise<NotificationPreference | null> {
    return this.prefs.find(p => p.userId === userId && p.eventType === type) ?? null;
  }
  async add(item: NotificationPreference) { this.prefs.push(item); }
  async put(item: NotificationPreference) {
    const idx = this.prefs.findIndex(p => p.id === item.id);
    if (idx >= 0) this.prefs[idx] = item; else this.prefs.push(item);
  }
}

export class FakeLineageRepo {
  private links: LineageLink[] = [];
  async add(link: LineageLink): Promise<void> { this.links.push(link); }
  async getFromEntity(type: string, id: string) {
    return this.links.filter(l => l.fromEntityType === type && l.fromEntityId === id);
  }
  async getToEntity(type: string, id: string) {
    return this.links.filter(l => l.toEntityType === type && l.toEntityId === id);
  }
}

export class FakeContentPostRepo extends FakeStore<any> {
  async getByOrganization(orgId: string) { return this.store.filter(p => p.organizationId === orgId); }
  async getByStatus(status: string) { return this.store.filter(p => p.status === status); }
}

/** Minimal fake for InterviewPlanRepository (only getById needed for InterviewService tests). */
export class FakeInterviewPlanRepo extends FakeStore<any> {
  async getByJob(jobId: string) { return this.store.filter(p => p.jobId === jobId); }
  async getByOrganization(orgId: string) { return this.store.filter(p => p.organizationId === orgId); }
}

// ── Shared service stubs ───────────────────────────────────────────────────

/** No-op audit service. */
export const fakeAudit = {
  log: async (..._args: unknown[]): Promise<void> => undefined,
};

/** No-op notification service stub — notification delivery is fire-and-forget in all callers. */
export const fakeNotifService = {
  createNotification: async (..._args: unknown[]): Promise<null> => null,
};

/**
 * CryptoService stub — passes RBAC/validation tests without real Web Crypto.
 * Encrypt stores plaintext with a trivial prefix so decrypt can reverse it.
 */
export const fakeCrypto = {
  deriveEncryptionKey: async (_pw: string, _salt: string): Promise<CryptoKey> => ({} as CryptoKey),
  encrypt: async (data: string, _key: CryptoKey, _aad?: string) => ({
    iv: 'aabbccdd11223344aabbccdd',
    ciphertext: `enc:${data}`,
  }),
  decrypt: async (ct: string, _iv: string, _key: CryptoKey, _aad?: string): Promise<string> =>
    ct.replace(/^enc:/, ''),
  generateSalt: (): string => 'deadbeef00112233',
  hashPassword: async (_p: string, _s: string): Promise<string> => 'fakehash',
  verifyPassword: async (): Promise<boolean> => true,
  computeHmac: async (): Promise<string> => 'fakesig',
  verifyHmac: async (): Promise<boolean> => true,
  sha256: async (s: string): Promise<string> => s,
  bufferToHex: (b: Uint8Array): string =>
    Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''),
  hexToBuffer: (_h: string): Uint8Array => new Uint8Array(0),
};

/** DND stub — pass `inDnd: true` to simulate an active DND window. */
export function makeFakeDnd(inDnd = false) {
  return {
    isInDND: async (_userId: string): Promise<boolean> => inDnd,
    delayDelivery: async (_notifId: string, _userId: string): Promise<void> => undefined,
    releaseExpiredDelays: async (): Promise<void> => undefined,
  };
}

// ── Entity factories ───────────────────────────────────────────────────────

export function makeJob(o: Partial<Job> = {}): Job {
  return {
    id: generateId(), organizationId: 'org1', ownerUserId: 'employer1',
    title: 'Test Job', description: 'A test job description.', tags: [], topics: [],
    status: 'active', version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as Job;
}

export function makeApplication(o: Partial<Application> = {}): Application {
  return {
    id: generateId(), jobId: 'job1', candidateId: 'candidate1',
    organizationId: 'org1', stage: 'draft', status: 'active',
    offerExpiresAt: null, submittedAt: null,
    version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as Application;
}

export function makeDocument(o: Partial<TBDoc> = {}): TBDoc {
  return {
    id: generateId(), ownerUserId: 'candidate1', organizationId: 'org1',
    applicationId: null, fileName: 'resume.pdf', mimeType: 'application/pdf',
    extension: '.pdf', sizeBytes: 1000,
    documentType: null,
    encryptedBlob: 'enc:hex', encryptionIv: 'aabbcc',
    adminEncryptedBlob: 'enc:hex', adminEncryptionIv: 'aabbcc',
    status: 'uploaded', version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as TBDoc;
}

export function makeUser(o: Partial<User> = {}): User {
  return {
    id: 'candidate1', username: 'testuser', passwordHash: 'hash', passwordSalt: 'salt',
    pbkdf2Iterations: 100000, roles: ['candidate'], organizationId: 'org1',
    departmentId: 'dept1', displayName: 'Test User',
    failedAttempts: 0, captchaRequiredAfterFailures: 3, lockoutUntil: null,
    lastCommentAt: null, deactivatedAt: null, encryptionKeySalt: 'saltsaltsaltsalt',
    version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as User;
}

export function makeInterviewPlan(o: Record<string, unknown> = {}): any {
  return {
    id: generateId(), organizationId: 'org1', jobId: 'job1',
    title: 'Technical Screen', stages: [],
    version: 1, createdAt: now(), updatedAt: now(), ...o,
  };
}

export function makeInterview(o: Partial<Interview> = {}): Interview {
  return {
    id: generateId(), applicationId: 'app1', interviewPlanId: 'plan1',
    organizationId: 'org1', interviewerId: 'employer1', candidateId: 'candidate1',
    startTime: '2026-05-01T10:00:00.000Z', endTime: '2026-05-01T11:00:00.000Z',
    status: InterviewStatus.Scheduled, rescheduledAt: null, rescheduledBy: null,
    version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as Interview;
}

export function makeThread(o: Partial<Thread> = {}): Thread {
  return {
    id: generateId(), organizationId: 'org1', contextType: 'application',
    contextId: 'app1', participantIds: ['candidate1', 'employer1'],
    version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as Thread;
}

export function makeNotification(o: Partial<Notification> = {}): Notification {
  return {
    id: generateId(), organizationId: 'org1', userId: 'candidate1',
    type: 'application_received', referenceType: 'application', referenceId: 'app1',
    eventId: `evt-${generateId()}`, message: 'Test notification',
    isRead: false, deliveryMode: NotificationDeliveryMode.Instant,
    isCanceled: false, version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as Notification;
}

export function makeMessage(o: Partial<Message> = {}): Message {
  return {
    id: generateId(), organizationId: 'org1', threadId: 'thread1',
    senderId: 'candidate1', content: 'Test message', isSensitive: false,
    readBy: ['candidate1'], version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as Message;
}

export function makePacket(o: Partial<ApplicationPacket> = {}): ApplicationPacket {
  return {
    id: generateId(), applicationId: 'app1', status: PacketStatus.Draft,
    reopenReason: null, reopenedAt: null, reopenedBy: null, completenessScore: 0,
    version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as ApplicationPacket;
}

// ── Additional repository fakes ────────────────────────────────────────────

export class FakeSessionRepo extends FakeStore<Session> {
  async getByUserId(userId: string): Promise<Session[]> {
    return this.store.filter(s => s.userId === userId);
  }
}

export class FakeCommentRepo extends FakeStore<Comment> {
  async getByPost(postId: string): Promise<Comment[]> {
    return this.store.filter(c => c.postId === postId);
  }
  async getByStatus(status: string): Promise<Comment[]> {
    return this.store.filter(c => c.status === status);
  }
}

export class FakeModerationCaseRepo extends FakeStore<ModerationCase> {
  async getByComment(commentId: string): Promise<ModerationCase[]> {
    return this.store.filter(m => m.commentId === commentId);
  }
}

export class FakeSensitiveWordRepo extends FakeStore<SensitiveWord> {}

export class FakeOrgAdminKeyRepo {
  private keys = new Map<string, OrgAdminKey>();
  /** Seed with a specific secret for an org (useful in upload+download round-trip tests). */
  seed(items: OrgAdminKey[]): this { items.forEach(k => this.keys.set(k.organizationId, k)); return this; }
  async getByOrg(orgId: string): Promise<OrgAdminKey | null> { return this.keys.get(orgId) ?? null; }
  async put(item: OrgAdminKey): Promise<void> { this.keys.set(item.organizationId, item); }
}

export class FakeIntegrationRequestRepo extends FakeStore<any> {
  async getByIntegrationKey(key: string) {
    return this.store.filter((r: any) => r.integrationKey === key);
  }
}

export class FakeIntegrationSecretRepo {
  private secrets: IntegrationSecret[] = [];
  seed(items: IntegrationSecret[]): this { this.secrets = [...items]; return this; }
  async getByIntegrationKey(key: string): Promise<IntegrationSecret[]> {
    return this.secrets.filter(s => s.integrationKey === key);
  }
  async getByOrgAndKey(orgId: string, key: string): Promise<IntegrationSecret[]> {
    return this.secrets.filter(s => s.organizationId === orgId && s.integrationKey === key);
  }
  async getByOrganization(orgId: string): Promise<IntegrationSecret[]> {
    return this.secrets.filter(s => s.organizationId === orgId);
  }
  async getById(id: string): Promise<IntegrationSecret | null> {
    return this.secrets.find(s => s.id === id) ?? null;
  }
  async getAll(): Promise<IntegrationSecret[]> { return [...this.secrets]; }
  async add(item: IntegrationSecret): Promise<void> { this.secrets.push(item); }
  async put(item: IntegrationSecret): Promise<void> {
    const idx = this.secrets.findIndex(s => s.id === item.id);
    if (idx >= 0) this.secrets[idx] = item; else this.secrets.push(item);
  }
  async updateWithLock(id: string, updater: (s: IntegrationSecret) => IntegrationSecret): Promise<IntegrationSecret> {
    const idx = this.secrets.findIndex(s => s.id === id);
    if (idx < 0) throw new Error(`FakeIntegrationSecretRepo: not found: ${id}`);
    const updated = updater(this.secrets[idx]);
    this.secrets[idx] = updated;
    return updated;
  }
}

/** IdempotencyKeyRepository fake — keyed by the `key` string, not by `id`. */
export class FakeIdempotencyKeyRepo {
  private records = new Map<string, IdempotencyKeyRecord>();
  seed(items: IdempotencyKeyRecord[]): this { items.forEach(r => this.records.set(r.key, r)); return this; }
  async get(key: string): Promise<IdempotencyKeyRecord | null> { return this.records.get(key) ?? null; }
  async put(record: IdempotencyKeyRecord): Promise<void> { this.records.set(record.key, record); }
  async deleteExpired(nowStr: string): Promise<void> {
    for (const [k, r] of this.records) { if (r.expiresAt <= nowStr) this.records.delete(k); }
  }
}

export class FakeWebhookQueueRepo extends FakeStore<WebhookQueueItem> {
  async getByStatus(status: string): Promise<WebhookQueueItem[]> {
    return this.store.filter(w => w.status === status);
  }
  async getPendingRetries(nowStr: string): Promise<WebhookQueueItem[]> {
    return this.store.filter(w => w.status === WebhookQueueStatus.Pending && w.nextRetryAt <= nowStr);
  }
}

// ── Additional entity factories ────────────────────────────────────────────

export function makeSession(o: Partial<Session> = {}): Session {
  return {
    id: generateId(), userId: 'candidate1',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    lastActiveAt: now(), rememberSession: false, timeoutPolicy: 30,
    isLocked: false, version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as Session;
}

export function makeComment(o: Partial<Comment> = {}): Comment {
  return {
    id: generateId(), organizationId: 'org1', postId: 'post1',
    authorId: 'candidate1', content: 'Nice post!',
    status: CommentStatus.Approved, moderationReason: null,
    version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as Comment;
}

export function makeSensitiveWord(word: string, o: Partial<SensitiveWord> = {}): SensitiveWord {
  return {
    id: generateId(), word, createdAt: now(), createdBy: 'admin1', ...o,
  } as SensitiveWord;
}

export function makeWebhookItem(o: Partial<WebhookQueueItem> = {}): WebhookQueueItem {
  return {
    id: generateId(), organizationId: 'org1', targetName: 'test-hook',
    payload: '{"event":"test"}', retryCount: 0, nextRetryAt: now(),
    status: WebhookQueueStatus.Pending,
    version: 1, createdAt: now(), updatedAt: now(), ...o,
  } as WebhookQueueItem;
}

export function makeIntegrationSecret(o: Partial<IntegrationSecret> = {}): IntegrationSecret {
  return {
    id: generateId(), organizationId: 'org1', integrationKey: 'key1', secret: 'mysecret',
    version: 1, activatedAt: now(), deactivatedAt: null, ...o,
  } as IntegrationSecret;
}

/** Crypto stub that always fails password verification (for lockout / wrong-password tests). */
export const failingCrypto = {
  ...fakeCrypto,
  verifyPassword: async (): Promise<boolean> => false,
};

export class FakeDelayedDeliveryRepo extends FakeStore<any> {
  async getByUser(userId: string) { return this.store.filter((d: any) => d.userId === userId); }
}

export class FakeDigestRepo extends FakeStore<any> {
  async getByUser(userId: string) { return this.store.filter((d: any) => d.userId === userId); }
  async getByUniqueKey(key: string) { return this.store.find((d: any) => d.uniqueKey === key) ?? null; }
}

// ── Governance fakes ───────────────────────────────────────────────────────

export class FakeMetricDefinitionRepo extends FakeStore<any> {}

export class FakeDataDictionaryRepo extends FakeStore<any> {
  async getByEntityType(et: string) { return this.store.filter((e: any) => e.entityType === et); }
}

export class FakeDatasetSnapshotRepo extends FakeStore<any> {
  async getByOrganization(orgId: string) { return this.store.filter((s: any) => s.organizationId === orgId); }
}
