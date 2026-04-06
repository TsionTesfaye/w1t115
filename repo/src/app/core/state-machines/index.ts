import {
  JobStatus, ApplicationStage, ApplicationStatus, PacketStatus,
  InterviewStatus, ContentPostStatus, CommentStatus, WebhookQueueStatus,
} from '../enums';

export const JOB_TRANSITIONS: ReadonlyMap<JobStatus, ReadonlySet<JobStatus>> = new Map([
  [JobStatus.Draft, new Set([JobStatus.Active, JobStatus.Archived])],
  [JobStatus.Active, new Set([JobStatus.Closed])],
  [JobStatus.Closed, new Set([JobStatus.Archived])],
  [JobStatus.Archived, new Set<JobStatus>()],
]);

export const APPLICATION_STAGE_TRANSITIONS: ReadonlyMap<ApplicationStage, ReadonlySet<ApplicationStage>> = new Map([
  [ApplicationStage.Draft, new Set([ApplicationStage.Submitted])],
  [ApplicationStage.Submitted, new Set([ApplicationStage.UnderReview])],
  [ApplicationStage.UnderReview, new Set([ApplicationStage.InterviewScheduled])],
  [ApplicationStage.InterviewScheduled, new Set([ApplicationStage.InterviewCompleted])],
  [ApplicationStage.InterviewCompleted, new Set([ApplicationStage.OfferExtended])],
  [ApplicationStage.OfferExtended, new Set<ApplicationStage>()],
]);

export const WITHDRAWABLE_STAGES: ReadonlySet<ApplicationStage> = new Set([
  ApplicationStage.Submitted, ApplicationStage.UnderReview,
  ApplicationStage.InterviewScheduled, ApplicationStage.InterviewCompleted,
  ApplicationStage.OfferExtended,
]);

/**
 * Status transitions for applications.
 * Active → Deleted is reserved for draft-stage applications only.
 * The additional stage=Draft guard is enforced in ApplicationService.deleteDraft().
 */
export const APPLICATION_STATUS_TRANSITIONS: ReadonlyMap<ApplicationStatus, ReadonlySet<ApplicationStatus>> = new Map([
  [ApplicationStatus.Active, new Set([
    ApplicationStatus.Accepted,
    ApplicationStatus.Rejected,
    ApplicationStatus.Withdrawn,
    ApplicationStatus.Expired,
    ApplicationStatus.Deleted,   // only valid when stage === Draft (additional guard in service)
    ApplicationStatus.Archived,
  ])],
  [ApplicationStatus.Accepted, new Set([ApplicationStatus.Archived])],
  [ApplicationStatus.Rejected, new Set([ApplicationStatus.Archived])],
  [ApplicationStatus.Withdrawn, new Set([ApplicationStatus.Archived])],
  [ApplicationStatus.Expired, new Set([ApplicationStatus.Archived])],
  [ApplicationStatus.Deleted, new Set<ApplicationStatus>()],
  [ApplicationStatus.Archived, new Set<ApplicationStatus>()],
]);

export const PACKET_TRANSITIONS: ReadonlyMap<PacketStatus, ReadonlySet<PacketStatus>> = new Map([
  [PacketStatus.Draft, new Set([PacketStatus.InProgress])],
  [PacketStatus.InProgress, new Set([PacketStatus.Submitted])],
  [PacketStatus.Submitted, new Set([PacketStatus.Reopened, PacketStatus.Locked])],
  [PacketStatus.Reopened, new Set([PacketStatus.InProgress, PacketStatus.Locked])],
  [PacketStatus.Locked, new Set<PacketStatus>()],
]);

export const INTERVIEW_TRANSITIONS: ReadonlyMap<InterviewStatus, ReadonlySet<InterviewStatus>> = new Map([
  [InterviewStatus.Scheduled, new Set([InterviewStatus.Completed, InterviewStatus.Canceled])],
  [InterviewStatus.Completed, new Set<InterviewStatus>()],
  [InterviewStatus.Canceled, new Set<InterviewStatus>()],
]);

export const CONTENT_POST_TRANSITIONS: ReadonlyMap<ContentPostStatus, ReadonlySet<ContentPostStatus>> = new Map([
  [ContentPostStatus.Draft, new Set([ContentPostStatus.Scheduled, ContentPostStatus.Published])],
  [ContentPostStatus.Scheduled, new Set([ContentPostStatus.Published])],
  [ContentPostStatus.Published, new Set([ContentPostStatus.Archived])],
  [ContentPostStatus.Archived, new Set<ContentPostStatus>()],
]);

export const COMMENT_TRANSITIONS: ReadonlyMap<CommentStatus, ReadonlySet<CommentStatus>> = new Map([
  [CommentStatus.Pending, new Set([CommentStatus.Approved, CommentStatus.Rejected])],
  [CommentStatus.Approved, new Set<CommentStatus>()],
  [CommentStatus.Rejected, new Set<CommentStatus>()],
]);

export const WEBHOOK_QUEUE_TRANSITIONS: ReadonlyMap<WebhookQueueStatus, ReadonlySet<WebhookQueueStatus>> = new Map([
  [WebhookQueueStatus.Pending, new Set([WebhookQueueStatus.Processing])],
  [WebhookQueueStatus.Processing, new Set([WebhookQueueStatus.Delivered, WebhookQueueStatus.Failed, WebhookQueueStatus.Pending])],
  [WebhookQueueStatus.Delivered, new Set<WebhookQueueStatus>()],
  [WebhookQueueStatus.Failed, new Set<WebhookQueueStatus>()],
]);

export function isValidTransition<T>(map: ReadonlyMap<T, ReadonlySet<T>>, current: T, next: T): boolean {
  const allowed = map.get(current);
  if (!allowed) return false;
  return allowed.has(next);
}

export function assertTransition<T>(map: ReadonlyMap<T, ReadonlySet<T>>, current: T, next: T, entityType: string): void {
  if (!isValidTransition(map, current, next)) {
    throw new StateMachineError(`Invalid ${entityType} transition: ${String(current)} → ${String(next)}`, String(current), String(next), entityType);
  }
}

export class StateMachineError extends Error {
  constructor(message: string, public readonly fromState: string, public readonly toState: string, public readonly entityType: string) {
    super(message);
    this.name = 'StateMachineError';
  }
}
