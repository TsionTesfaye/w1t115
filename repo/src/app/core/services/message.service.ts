import { Injectable } from '@angular/core';
import { ThreadRepository, MessageRepository, ApplicationRepository, InterviewRepository } from '../repositories';
import { AuditService } from './audit.service';
import { Thread, Message } from '../models';
import { AuditAction, UserRole, ThreadContextType } from '../enums';
import { generateId, now } from '../utils/id';
import { sanitizePlainText } from '../utils/sanitizer';
import { AuthorizationError, NotFoundError, ValidationError } from '../errors';

@Injectable({ providedIn: 'root' })
export class MessageService {
  constructor(private readonly threadRepo: ThreadRepository, private readonly msgRepo: MessageRepository, private readonly appRepo: ApplicationRepository, private readonly interviewRepo: InterviewRepository, private readonly audit: AuditService) {}

  async createThread(contextType: ThreadContextType, contextId: string, participantIds: string[], actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<Thread> {
    if (!participantIds.includes(actorId)) participantIds = [actorId, ...participantIds];
    if (participantIds.length < 2) throw new ValidationError('Thread requires at least 2 participants');
    if (contextType === ThreadContextType.Application) {
      const app = await this.appRepo.getById(contextId); if (!app) throw new NotFoundError('Application', contextId);
      if (app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
      if (actorRoles.includes(UserRole.Candidate) && app.candidateId !== actorId) throw new AuthorizationError('Cannot message for another candidate');
    } else if (contextType === ThreadContextType.Interview) {
      const interview = await this.interviewRepo.getById(contextId); if (!interview) throw new NotFoundError('Interview', contextId);
      if (interview.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
      const isParticipant = interview.candidateId === actorId || interview.interviewerId === actorId;
      if (!isParticipant && !actorRoles.includes(UserRole.Administrator) && !actorRoles.includes(UserRole.HRCoordinator)) {
        throw new AuthorizationError('Not a participant in this interview');
      }
    }
    const thread: Thread = { id: generateId(), organizationId: actorOrgId, contextType, contextId, participantIds, version: 1, createdAt: now(), updatedAt: now() };
    await this.threadRepo.add(thread); return thread;
  }

  async sendMessage(threadId: string, content: string, actorId: string, actorOrgId: string, isSensitive: boolean = false): Promise<Message> {
    const thread = await this.threadRepo.getById(threadId); if (!thread) throw new NotFoundError('Thread', threadId);
    if (thread.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (!thread.participantIds.includes(actorId)) throw new AuthorizationError('Not a participant');
    const sanitized = sanitizePlainText(content); if (!sanitized.trim()) throw new ValidationError('Content cannot be empty');
    const msg: Message = { id: generateId(), organizationId: actorOrgId, threadId, senderId: actorId, content: sanitized, isSensitive, readBy: [actorId], version: 1, createdAt: now(), updatedAt: now() };
    await this.msgRepo.add(msg); await this.audit.log(actorId, AuditAction.MessageSent, 'message', msg.id, actorOrgId, { threadId }); return msg;
  }

  async markAsRead(messageId: string, actorId: string, actorOrgId: string): Promise<void> {
    const msg = await this.msgRepo.getById(messageId);
    if (!msg || msg.organizationId !== actorOrgId) return;
    // Verify actor is a participant in the thread — prevents unauthorized read-marking
    const thread = await this.threadRepo.getById(msg.threadId);
    if (!thread || !thread.participantIds.includes(actorId)) return;
    if (!msg.readBy.includes(actorId)) {
      msg.readBy = [...msg.readBy, actorId];
      msg.updatedAt = now();
      msg.version += 1;
      await this.msgRepo.put(msg);
    }
  }

  async getThreadsForUser(actorId: string, actorOrgId: string): Promise<Thread[]> { return (await this.threadRepo.getByOrganization(actorOrgId)).filter(t => t.participantIds.includes(actorId)); }

  async getMessages(threadId: string, actorId: string, actorOrgId: string): Promise<Message[]> {
    const thread = await this.threadRepo.getById(threadId); if (!thread) throw new NotFoundError('Thread', threadId);
    if (thread.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (!thread.participantIds.includes(actorId)) throw new AuthorizationError('Not a participant');
    return (await this.msgRepo.getByThread(threadId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
