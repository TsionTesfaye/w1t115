export interface BaseEntity {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface User extends BaseEntity {
  username: string;
  passwordHash: string;
  passwordSalt: string;
  pbkdf2Iterations: number;
  roles: string[];
  organizationId: string;
  departmentId: string;
  displayName: string;
  failedAttempts: number;
  captchaRequiredAfterFailures: number;
  lockoutUntil: string | null;
  lastCommentAt: string | null;
  deactivatedAt: string | null;
  encryptionKeySalt: string | null;
}

export interface Session extends BaseEntity {
  userId: string;
  expiresAt: string;
  lastActiveAt: string;
  rememberSession: boolean;
  timeoutPolicy: number;
  isLocked: boolean;
}

export interface Job extends BaseEntity {
  organizationId: string;
  ownerUserId: string;
  departmentId?: string;
  title: string;
  description: string;
  tags: string[];
  topics: string[];
  status: string;
}

export interface Application extends BaseEntity {
  jobId: string;
  candidateId: string;
  organizationId: string;
  stage: string;
  status: string;
  offerExpiresAt: string | null;
  submittedAt: string | null;
}

export interface ApplicationPacket extends BaseEntity {
  applicationId: string;
  status: string;
  reopenReason: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  completenessScore: number;
  submittedAt: string | null;
}

export interface PacketSection extends BaseEntity {
  applicationPacketId: string;
  sectionKey: string;
  payload: Record<string, unknown>;
  isComplete: boolean;
}

export interface InterviewPlan extends BaseEntity {
  jobId: string;
  organizationId: string;
  stages: InterviewPlanStage[];
  createdBy: string;
}

export interface InterviewPlanStage {
  name: string;
  order: number;
  durationMinutes: number;
  interviewerRole: string;
}

export interface Interview extends BaseEntity {
  applicationId: string;
  interviewPlanId: string;
  organizationId: string;
  interviewerId: string;
  candidateId: string;
  startTime: string;
  endTime: string;
  status: string;
  rescheduledAt: string | null;
  rescheduledBy: string | null;
}

export interface InterviewFeedback extends BaseEntity {
  interviewId: string;
  organizationId: string;
  interviewerId: string;
  score: number;
  notes: string;
  submittedAt: string;
}

export interface Document extends BaseEntity {
  ownerUserId: string;
  organizationId: string;
  applicationId: string | null;
  fileName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  /** Optional label set by the uploader (e.g. "Resume / CV", "Cover Letter"). */
  documentType: string | null;
  /** AES-GCM ciphertext, hex-encoded. Null only before first upload completes. */
  encryptedBlob: string | null;
  /** AES-GCM IV, hex-encoded. Always set alongside encryptedBlob. */
  encryptionIv: string | null;
  /**
   * AES-GCM ciphertext encrypted with the org-level admin key (deterministic passphrase + orgId).
   * Allows HR/Admin to decrypt without the owner's password.
   * Null for legacy documents uploaded before this feature.
   */
  adminEncryptedBlob: string | null;
  adminEncryptionIv: string | null;
  status: string;
}

export interface DocumentQuotaUsage {
  userId: string;
  totalBytes: number;
  updatedAt: string;
}

export interface Thread extends BaseEntity {
  organizationId: string;
  contextType: string;
  contextId: string;
  participantIds: string[];
}

export interface Message extends BaseEntity {
  organizationId: string;
  threadId: string;
  senderId: string;
  content: string;
  isSensitive: boolean;
  readBy: string[];
}

export interface Notification extends BaseEntity {
  organizationId: string;
  userId: string;
  type: string;
  referenceType: string;
  referenceId: string;
  eventId: string;
  message: string;
  isRead: boolean;
  deliveryMode: string;
  isCanceled: boolean;
}

export interface NotificationPreference extends BaseEntity {
  userId: string;
  organizationId: string;
  eventType: string;
  instantEnabled: boolean;
  digestEnabled: boolean;
  dndStart: string | null;
  dndEnd: string | null;
}

export interface Digest extends BaseEntity {
  userId: string;
  organizationId: string;
  digestDate: string;
  itemIds: string[];
  deliveredAt: string | null;
  uniqueKey: string;
}

export interface DelayedDelivery extends BaseEntity {
  notificationId: string;
  userId: string;
  scheduledReleaseAt: string;
  released: boolean;
}

export interface ContentPost extends BaseEntity {
  organizationId: string;
  authorId: string;
  title: string;
  body: string;
  tags: string[];
  topics: string[];
  status: string;
  scheduledPublishAt: string | null;
  pinnedUntil: string | null;
}

export interface Comment extends BaseEntity {
  organizationId: string;
  postId: string;
  authorId: string;
  content: string;
  status: string;
  moderationReason: string | null;
}

export interface ModerationCase extends BaseEntity {
  organizationId: string;
  commentId: string;
  detectedIssues: string[];
  decision: string | null;
  decisionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface SensitiveWord {
  id: string;
  word: string;
  createdAt: string;
  createdBy: string;
}

export interface IntegrationRequest extends BaseEntity {
  organizationId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  idempotencyKey: string | null;
  signature: string | null;
  secretVersion: number | null;
  integrationKey: string;
  responseSnapshot: IntegrationResponse | null;
}

export interface IntegrationResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export interface IdempotencyKeyRecord {
  key: string;
  integrationKey: string;
  responseSnapshot: IntegrationResponse;
  createdAt: string;
  expiresAt: string;
}

export interface RateLimitBucket {
  integrationKey: string;
  windowStart: string;
  requestCount: number;
}

export interface IntegrationSecret {
  id: string;
  organizationId: string;
  integrationKey: string;
  secret: string;
  version: number;
  activatedAt: string;
  deactivatedAt: string | null;
}

/**
 * Per-organization admin encryption key.
 * keyPath is `organizationId` so there is exactly one entry per org.
 * The `secret` (32 random bytes hex) is used to derive the org-level
 * document encryption key, replacing the old hardcoded passphrase.
 */
export interface OrgAdminKey {
  organizationId: string;
  secret: string;
  createdAt: string;
  rotatedAt: string | null;
}

export interface WebhookQueueItem extends BaseEntity {
  organizationId: string;
  targetName: string;
  payload: string;
  retryCount: number;
  nextRetryAt: string;
  status: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  organizationId: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  previousHash: string;
  entryHash: string;
}

export interface MetricDefinition {
  id: string;
  key: string;
  label: string;
  formulaDescription: string;
  seededBySystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DataDictionaryEntry {
  id: string;
  entityType: string;
  fieldName: string;
  description: string;
  dataType: string;
  sensitivity: string;
  seededBySystem: boolean;
  updatedAt: string;
}

export interface LineageLink {
  id: string;
  fromEntityType: string;
  fromEntityId: string;
  toEntityType: string;
  toEntityId: string;
}

export interface DatasetSnapshot extends BaseEntity {
  label: string;
  organizationId: string;
  createdBy: string;
  manifest: SnapshotManifest;
  queryNotes: string;
}

export interface SnapshotManifest {
  entityCounts: Record<string, number>;
  entityIds: Record<string, string[]>;
  /** Full point-in-time record snapshots for revision traceability.
   *  Document encryptedBlob and encryptionIv are intentionally omitted
   *  to avoid persisting encrypted bytes in the snapshot store. */
  entityData: {
    jobs: Job[];
    applications: Application[];
    interviews: Interview[];
    documents: Array<Omit<Document, 'encryptedBlob' | 'encryptionIv'>>;
  };
  capturedAt: string;
}

export interface AppConfig {
  key: string;
  value: string | number | boolean;
  updatedAt: string;
}

export interface StorageReservation {
  id: string;
  userId: string;
  reservedBytes: number;
  purpose: string;
  createdAt: string;
  expiresAt: string;
}

export interface ServiceResult<T = void> {
  success: boolean;
  data?: T;
  error?: ServiceError;
}

export interface ServiceError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface AuditSearchParams {
  startDate?: string;
  endDate?: string;
  actorId?: string;
  action?: string;
  entityType?: string;
  organizationId?: string;
  offset?: number;
  limit?: number;
}

export interface CaptchaChallenge {
  id: string;
  /** Canvas-rendered image data URL shown to the user. */
  imageDataUrl: string;
  /** Case-insensitive alphanumeric answer; stored in-memory only, never persisted. */
  answer: string;
  createdAt: number;
  expiresAt: number;
}

/** Subset of CaptchaChallenge returned to callers — answer is intentionally omitted. */
export type CaptchaDisplay = Pick<CaptchaChallenge, 'id' | 'imageDataUrl' | 'createdAt' | 'expiresAt'>;
