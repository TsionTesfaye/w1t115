import { describe, it, expect } from 'vitest';
import {
  isValidTransition, assertTransition, StateMachineError,
  JOB_TRANSITIONS, APPLICATION_STAGE_TRANSITIONS, INTERVIEW_TRANSITIONS,
  CONTENT_POST_TRANSITIONS, COMMENT_TRANSITIONS, PACKET_TRANSITIONS,
  WEBHOOK_QUEUE_TRANSITIONS, WITHDRAWABLE_STAGES,
} from '../../state-machines';
import {
  JobStatus, ApplicationStage, InterviewStatus,
  ContentPostStatus, CommentStatus, PacketStatus, WebhookQueueStatus,
} from '../../enums';

describe('Job State Machine', () => {
  it('allows draft -> active', () => { expect(isValidTransition(JOB_TRANSITIONS, JobStatus.Draft, JobStatus.Active)).toBe(true); });
  it('allows draft -> archived', () => { expect(isValidTransition(JOB_TRANSITIONS, JobStatus.Draft, JobStatus.Archived)).toBe(true); });
  it('allows active -> closed', () => { expect(isValidTransition(JOB_TRANSITIONS, JobStatus.Active, JobStatus.Closed)).toBe(true); });
  it('allows closed -> archived', () => { expect(isValidTransition(JOB_TRANSITIONS, JobStatus.Closed, JobStatus.Archived)).toBe(true); });
  it('rejects active -> draft', () => { expect(isValidTransition(JOB_TRANSITIONS, JobStatus.Active, JobStatus.Draft)).toBe(false); });
  it('rejects archived -> active', () => { expect(isValidTransition(JOB_TRANSITIONS, JobStatus.Archived, JobStatus.Active)).toBe(false); });
  it('rejects closed -> active', () => { expect(isValidTransition(JOB_TRANSITIONS, JobStatus.Closed, JobStatus.Active)).toBe(false); });
});

describe('Application Stage State Machine', () => {
  it('allows draft -> submitted', () => { expect(isValidTransition(APPLICATION_STAGE_TRANSITIONS, ApplicationStage.Draft, ApplicationStage.Submitted)).toBe(true); });
  it('allows submitted -> under_review', () => { expect(isValidTransition(APPLICATION_STAGE_TRANSITIONS, ApplicationStage.Submitted, ApplicationStage.UnderReview)).toBe(true); });
  it('allows full pipeline', () => {
    expect(isValidTransition(APPLICATION_STAGE_TRANSITIONS, ApplicationStage.UnderReview, ApplicationStage.InterviewScheduled)).toBe(true);
    expect(isValidTransition(APPLICATION_STAGE_TRANSITIONS, ApplicationStage.InterviewScheduled, ApplicationStage.InterviewCompleted)).toBe(true);
    expect(isValidTransition(APPLICATION_STAGE_TRANSITIONS, ApplicationStage.InterviewCompleted, ApplicationStage.OfferExtended)).toBe(true);
  });
  it('rejects skipping stages', () => {
    expect(isValidTransition(APPLICATION_STAGE_TRANSITIONS, ApplicationStage.Draft, ApplicationStage.UnderReview)).toBe(false);
    expect(isValidTransition(APPLICATION_STAGE_TRANSITIONS, ApplicationStage.Submitted, ApplicationStage.OfferExtended)).toBe(false);
  });
  it('rejects backward transitions', () => {
    expect(isValidTransition(APPLICATION_STAGE_TRANSITIONS, ApplicationStage.UnderReview, ApplicationStage.Submitted)).toBe(false);
  });
});

describe('Withdrawable Stages', () => {
  it('includes submitted through offer_extended', () => {
    expect(WITHDRAWABLE_STAGES.has(ApplicationStage.Submitted)).toBe(true);
    expect(WITHDRAWABLE_STAGES.has(ApplicationStage.UnderReview)).toBe(true);
    expect(WITHDRAWABLE_STAGES.has(ApplicationStage.InterviewScheduled)).toBe(true);
    expect(WITHDRAWABLE_STAGES.has(ApplicationStage.InterviewCompleted)).toBe(true);
    expect(WITHDRAWABLE_STAGES.has(ApplicationStage.OfferExtended)).toBe(true);
  });
  it('excludes draft', () => { expect(WITHDRAWABLE_STAGES.has(ApplicationStage.Draft)).toBe(false); });
});

describe('Interview State Machine', () => {
  it('allows scheduled -> completed', () => { expect(isValidTransition(INTERVIEW_TRANSITIONS, InterviewStatus.Scheduled, InterviewStatus.Completed)).toBe(true); });
  it('allows scheduled -> canceled', () => { expect(isValidTransition(INTERVIEW_TRANSITIONS, InterviewStatus.Scheduled, InterviewStatus.Canceled)).toBe(true); });
  it('rejects completed -> scheduled', () => { expect(isValidTransition(INTERVIEW_TRANSITIONS, InterviewStatus.Completed, InterviewStatus.Scheduled)).toBe(false); });
  it('rejects canceled -> completed', () => { expect(isValidTransition(INTERVIEW_TRANSITIONS, InterviewStatus.Canceled, InterviewStatus.Completed)).toBe(false); });
});

describe('Packet State Machine', () => {
  it('allows draft -> in_progress -> submitted -> locked', () => {
    expect(isValidTransition(PACKET_TRANSITIONS, PacketStatus.Draft, PacketStatus.InProgress)).toBe(true);
    expect(isValidTransition(PACKET_TRANSITIONS, PacketStatus.InProgress, PacketStatus.Submitted)).toBe(true);
    expect(isValidTransition(PACKET_TRANSITIONS, PacketStatus.Submitted, PacketStatus.Locked)).toBe(true);
  });
  it('allows reopen flow', () => {
    expect(isValidTransition(PACKET_TRANSITIONS, PacketStatus.Submitted, PacketStatus.Reopened)).toBe(true);
    expect(isValidTransition(PACKET_TRANSITIONS, PacketStatus.Reopened, PacketStatus.InProgress)).toBe(true);
    expect(isValidTransition(PACKET_TRANSITIONS, PacketStatus.Reopened, PacketStatus.Locked)).toBe(true);
  });
  it('rejects locked -> anything', () => {
    expect(isValidTransition(PACKET_TRANSITIONS, PacketStatus.Locked, PacketStatus.Submitted)).toBe(false);
    expect(isValidTransition(PACKET_TRANSITIONS, PacketStatus.Locked, PacketStatus.Draft)).toBe(false);
  });
});

describe('Content Post State Machine', () => {
  it('allows draft -> published', () => { expect(isValidTransition(CONTENT_POST_TRANSITIONS, ContentPostStatus.Draft, ContentPostStatus.Published)).toBe(true); });
  it('allows draft -> scheduled -> published', () => {
    expect(isValidTransition(CONTENT_POST_TRANSITIONS, ContentPostStatus.Draft, ContentPostStatus.Scheduled)).toBe(true);
    expect(isValidTransition(CONTENT_POST_TRANSITIONS, ContentPostStatus.Scheduled, ContentPostStatus.Published)).toBe(true);
  });
  it('allows published -> archived', () => { expect(isValidTransition(CONTENT_POST_TRANSITIONS, ContentPostStatus.Published, ContentPostStatus.Archived)).toBe(true); });
  it('rejects archived -> published', () => { expect(isValidTransition(CONTENT_POST_TRANSITIONS, ContentPostStatus.Archived, ContentPostStatus.Published)).toBe(false); });
});

describe('Comment Moderation State Machine', () => {
  it('allows pending -> approved', () => { expect(isValidTransition(COMMENT_TRANSITIONS, CommentStatus.Pending, CommentStatus.Approved)).toBe(true); });
  it('allows pending -> rejected', () => { expect(isValidTransition(COMMENT_TRANSITIONS, CommentStatus.Pending, CommentStatus.Rejected)).toBe(true); });
  it('rejects approved -> rejected', () => { expect(isValidTransition(COMMENT_TRANSITIONS, CommentStatus.Approved, CommentStatus.Rejected)).toBe(false); });
});

describe('assertTransition', () => {
  it('throws StateMachineError for invalid transition', () => {
    expect(() => assertTransition(JOB_TRANSITIONS, JobStatus.Archived, JobStatus.Active, 'Job')).toThrow(StateMachineError);
  });
  it('does not throw for valid transition', () => {
    expect(() => assertTransition(JOB_TRANSITIONS, JobStatus.Draft, JobStatus.Active, 'Job')).not.toThrow();
  });
});
