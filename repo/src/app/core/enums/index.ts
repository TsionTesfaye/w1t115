export enum UserRole {
  Candidate = 'candidate',
  Employer = 'employer',
  HRCoordinator = 'hr_coordinator',
  Interviewer = 'interviewer',
  Administrator = 'administrator'
}

export enum JobStatus {
  Draft = 'draft',
  Active = 'active',
  Closed = 'closed',
  Archived = 'archived'
}

export enum ApplicationStage {
  Draft = 'draft',
  Submitted = 'submitted',
  UnderReview = 'under_review',
  InterviewScheduled = 'interview_scheduled',
  InterviewCompleted = 'interview_completed',
  OfferExtended = 'offer_extended'
}

export enum ApplicationStatus {
  Active = 'active',
  Accepted = 'accepted',
  Rejected = 'rejected',
  Withdrawn = 'withdrawn',
  Expired = 'expired',
  Deleted = 'deleted',
  Archived = 'archived'
}

export enum PacketStatus {
  Draft = 'draft',
  InProgress = 'in_progress',
  Submitted = 'submitted',
  Reopened = 'reopened',
  Locked = 'locked'
}

export enum InterviewStatus {
  Scheduled = 'scheduled',
  Completed = 'completed',
  Canceled = 'canceled'
}

export enum DocumentStatus {
  Uploaded = 'uploaded',
  Reviewed = 'reviewed',
  Rejected = 'rejected',
  Archived = 'archived'
}

export enum ContentPostStatus {
  Draft = 'draft',
  Scheduled = 'scheduled',
  Published = 'published',
  Archived = 'archived'
}

export enum CommentStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected'
}

export enum WebhookQueueStatus {
  Pending = 'pending',
  Processing = 'processing',
  Delivered = 'delivered',
  Failed = 'failed'
}

export enum NotificationDeliveryMode {
  Instant = 'instant',
  Digest = 'digest',
  Delayed = 'delayed'
}

export enum NotificationEventType {
  ApplicationReceived = 'application_received',
  InterviewConfirmed = 'interview_confirmed',
  ScheduleChanged = 'schedule_changed',
  OfferExpiring = 'offer_expiring',
  DocumentReviewed = 'document_reviewed',
  RoleChanged = 'role_changed',
  ApplicationWithdrawn = 'application_withdrawn',
  ContentPublished = 'content_published'
}

export enum ModerationDecision {
  Approved = 'approved',
  Rejected = 'rejected'
}

export enum ThreadContextType {
  Job = 'job',
  Application = 'application',
  Interview = 'interview',
  General = 'general'
}

export enum AuditAction {
  Login = 'login',
  Logout = 'logout',
  LoginFailed = 'login_failed',
  Lockout = 'lockout',
  Register = 'register',
  RoleChanged = 'role_changed',
  UserDeactivated = 'user_deactivated',
  JobCreated = 'job_created',
  JobUpdated = 'job_updated',
  JobStatusChanged = 'job_status_changed',
  ApplicationCreated = 'application_created',
  ApplicationStageChanged = 'application_stage_changed',
  ApplicationStatusChanged = 'application_status_changed',
  PacketSubmitted = 'packet_submitted',
  PacketReopened = 'packet_reopened',
  PacketLocked = 'packet_locked',
  InterviewScheduled = 'interview_scheduled',
  InterviewRescheduled = 'interview_rescheduled',
  InterviewCompleted = 'interview_completed',
  InterviewCanceled = 'interview_canceled',
  FeedbackSubmitted = 'feedback_submitted',
  DocumentUploaded = 'document_uploaded',
  DocumentReviewed = 'document_reviewed',
  DocumentDownloaded = 'document_downloaded',
  DocumentDeleted = 'document_deleted',
  MessageSent = 'message_sent',
  ModerationDecision = 'moderation_decision',
  ContentPublished = 'content_published',
  IntegrationRequest = 'integration_request',
  WebhookRetry = 'webhook_retry',
  WebhookFailed = 'webhook_failed',
  ImportExecuted = 'import_executed',
  ExportExecuted = 'export_executed',
  PrivilegeEscalation = 'privilege_escalation',
  SnapshotCreated = 'snapshot_created'
}

export enum ImportStrategy {
  Overwrite = 'overwrite',
  Merge = 'merge',
  Skip = 'skip',
}

export enum SensitivityLevel {
  Public = 'public',
  Internal = 'internal',
  Sensitive = 'sensitive',
  Restricted = 'restricted'
}
