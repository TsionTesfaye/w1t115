import { Injectable } from '@angular/core';
import { ApplicationPacketRepository, PacketSectionRepository, ApplicationRepository, DocumentRepository } from '../repositories';
import { AuditService } from './audit.service';
import { ApplicationPacket, PacketSection } from '../models';
import { PacketStatus, AuditAction, UserRole } from '../enums';
import { PACKET_TRANSITIONS, assertTransition } from '../state-machines';
import { generateId, now } from '../utils/id';
import { AuthorizationError, NotFoundError, ValidationError, OptimisticLockError } from '../errors';

@Injectable({ providedIn: 'root' })
export class ApplicationPacketService {
  /** Document type that must exist before a packet can be submitted. */
  static readonly REQUIRED_DOC_TYPE = 'Resume / CV';

  constructor(
    private readonly packetRepo: ApplicationPacketRepository,
    private readonly sectionRepo: PacketSectionRepository,
    private readonly appRepo: ApplicationRepository,
    private readonly audit: AuditService,
    private readonly docRepo: DocumentRepository,
  ) {}

  private isMgmt(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.Employer || r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  async getOrCreatePacket(applicationId: string, actorId: string, actorOrgId: string): Promise<ApplicationPacket> {
    const app = await this.appRepo.getById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    if (app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (app.candidateId !== actorId) throw new AuthorizationError('Only the owning candidate can access their packet');

    const existing = await this.packetRepo.getByApplication(applicationId);
    if (existing) return existing;

    const packet: ApplicationPacket = {
      id: generateId(), applicationId, status: PacketStatus.Draft,
      reopenReason: null, reopenedAt: null, reopenedBy: null,
      completenessScore: 0, submittedAt: null,
      version: 1, createdAt: now(), updatedAt: now(),
    };
    await this.packetRepo.add(packet);
    return packet;
  }

  async getPacketWithSections(
    packetId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string,
  ): Promise<{ packet: ApplicationPacket; sections: PacketSection[] }> {
    const packet = await this.packetRepo.getById(packetId);
    if (!packet) throw new NotFoundError('ApplicationPacket', packetId);
    const app = await this.appRepo.getById(packet.applicationId);
    if (!app || app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (!this.isMgmt(actorRoles) && app.candidateId !== actorId) {
      throw new AuthorizationError('Not authorized to view this packet');
    }
    const sections = await this.sectionRepo.getByPacket(packetId);
    return { packet, sections };
  }

  async updateSection(
    packetId: string, sectionKey: string, payload: Record<string, unknown>,
    actorId: string, actorOrgId: string,
  ): Promise<PacketSection> {
    const packet = await this.packetRepo.getById(packetId);
    if (!packet) throw new NotFoundError('ApplicationPacket', packetId);
    if (packet.status === PacketStatus.Locked) throw new ValidationError('Cannot edit a locked packet');
    if (packet.status === PacketStatus.Submitted) throw new ValidationError('Cannot edit a submitted packet — request reopen first');
    const app = await this.appRepo.getById(packet.applicationId);
    if (!app || app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    if (app.candidateId !== actorId) throw new AuthorizationError('Only the owning candidate can edit their packet');

    // Transition Draft -> InProgress on first edit
    if (packet.status === PacketStatus.Draft) {
      await this.packetRepo.updateWithLock(packetId, (current) => {
        assertTransition(PACKET_TRANSITIONS, current.status as PacketStatus, PacketStatus.InProgress, 'ApplicationPacket');
        return { ...current, status: PacketStatus.InProgress, version: current.version + 1, updatedAt: now() };
      });
    }

    const existing = (await this.sectionRepo.getByPacket(packetId)).find(s => s.sectionKey === sectionKey);
    if (existing) {
      return this.sectionRepo.updateWithLock(existing.id, (current) => ({
        ...current, payload, isComplete: Object.keys(payload).length > 0,
        version: current.version + 1, updatedAt: now(),
      }));
    }
    const section: PacketSection = {
      id: generateId(), applicationPacketId: packetId, sectionKey, payload,
      isComplete: Object.keys(payload).length > 0,
      version: 1, createdAt: now(), updatedAt: now(),
    };
    await this.sectionRepo.add(section);
    return section;
  }

  async transitionStatus(
    packetId: string, newStatus: PacketStatus,
    actorId: string, actorRoles: UserRole[], actorOrgId: string,
    expectedVersion: number, reopenReason?: string,
  ): Promise<ApplicationPacket> {
    const packet = await this.packetRepo.getById(packetId);
    if (!packet) throw new NotFoundError('ApplicationPacket', packetId);
    const app = await this.appRepo.getById(packet.applicationId);
    if (!app || app.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');

    // RBAC: submission by candidate, reopen/lock by management
    if (newStatus === PacketStatus.Submitted) {
      if (app.candidateId !== actorId) throw new AuthorizationError('Only the owning candidate can submit');
      // Enforce required document types at the service layer.
      const docs = await this.docRepo.getByOwner(app.candidateId);
      const appDocs = docs.filter(d => d.applicationId === packet.applicationId);
      const hasResume = appDocs.some(d => d.documentType === ApplicationPacketService.REQUIRED_DOC_TYPE);
      if (!hasResume) {
        throw new ValidationError(`A "${ApplicationPacketService.REQUIRED_DOC_TYPE}" document is required before submitting`);
      }
    } else if (newStatus === PacketStatus.Reopened) {
      if (!this.isMgmt(actorRoles)) throw new AuthorizationError('Only management can reopen a packet');
      if (!reopenReason?.trim()) throw new ValidationError('Reopen reason is required');
    } else if (newStatus === PacketStatus.Locked) {
      if (!this.isMgmt(actorRoles)) throw new AuthorizationError('Only management can lock a packet');
    }

    const updated = await this.packetRepo.updateWithLock(packetId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('ApplicationPacket', packetId);
      assertTransition(PACKET_TRANSITIONS, current.status as PacketStatus, newStatus, 'ApplicationPacket');
      return {
        ...current, status: newStatus, version: current.version + 1, updatedAt: now(),
        submittedAt: newStatus === PacketStatus.Submitted ? now() : current.submittedAt,
        reopenReason: newStatus === PacketStatus.Reopened ? (reopenReason ?? null) : current.reopenReason,
        reopenedAt: newStatus === PacketStatus.Reopened ? now() : current.reopenedAt,
        reopenedBy: newStatus === PacketStatus.Reopened ? actorId : current.reopenedBy,
      };
    });
    await this.audit.log(actorId, AuditAction.PacketSubmitted, 'applicationPacket', packetId, actorOrgId, { newStatus });
    return updated;
  }
}
