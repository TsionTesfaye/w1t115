import { Injectable } from '@angular/core';
import { InterviewFeedbackRepository, InterviewRepository } from '../repositories';
import { AuditService } from './audit.service';
import { InterviewFeedback } from '../models';
import { InterviewStatus, AuditAction, UserRole } from '../enums';
import { generateId, now } from '../utils/id';
import { AuthorizationError, NotFoundError, ValidationError } from '../errors';

@Injectable({ providedIn: 'root' })
export class FeedbackService {
  constructor(private readonly feedbackRepo: InterviewFeedbackRepository, private readonly interviewRepo: InterviewRepository, private readonly audit: AuditService) {}

  async submitFeedback(interviewId: string, score: number, notes: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<InterviewFeedback> {
    const interview = await this.interviewRepo.getById(interviewId); if (!interview) throw new NotFoundError('Interview', interviewId);
    if (interview.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (interview.interviewerId !== actorId) throw new AuthorizationError('Only assigned interviewer can submit feedback');
    if (interview.status !== InterviewStatus.Completed) throw new ValidationError('Can only submit feedback for completed interviews');
    const existing = await this.feedbackRepo.getByInterview(interviewId);
    if (existing.find(f => f.interviewerId === actorId)) throw new ValidationError('Feedback already submitted');
    if (score < 1 || score > 10) throw new ValidationError('Score must be between 1 and 10');
    const feedback: InterviewFeedback = { id: generateId(), interviewId, organizationId: actorOrgId, interviewerId: actorId, score, notes: notes.trim(), submittedAt: now(), version: 1, createdAt: now(), updatedAt: now() };
    await this.feedbackRepo.add(feedback); await this.audit.log(actorId, AuditAction.FeedbackSubmitted, 'interviewFeedback', feedback.id, actorOrgId, { interviewId, score }); return feedback;
  }

  async getFeedbackForInterview(interviewId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<InterviewFeedback[]> {
    const interview = await this.interviewRepo.getById(interviewId); if (!interview) throw new NotFoundError('Interview', interviewId);
    if (interview.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    // Candidates are blocked entirely
    if (actorRoles.includes(UserRole.Candidate) && !this.isMgmt(actorRoles)) {
      throw new AuthorizationError('Candidates cannot access interview feedback');
    }
    const all = (await this.feedbackRepo.getByInterview(interviewId)).filter(f => f.organizationId === actorOrgId);
    // Interviewers (non-management) can only see their own submitted feedback
    if (actorRoles.includes(UserRole.Interviewer) && !this.isMgmt(actorRoles)) {
      return all.filter(f => f.interviewerId === actorId);
    }
    // Management can see all feedback, but only after interview is complete
    if (this.isMgmt(actorRoles)) {
      if (interview.status !== InterviewStatus.Completed) throw new ValidationError('Feedback only visible after interview completion');
      return all;
    }
    // Any other role (no recognized permission) is denied
    throw new AuthorizationError('Not authorized to access interview feedback');
  }
  private isMgmt(roles: UserRole[]): boolean { return roles.some(r => r === UserRole.Employer || r === UserRole.HRCoordinator || r === UserRole.Administrator); }
}
