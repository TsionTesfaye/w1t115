/**
 * ApplicationPacketService tests
 *
 * Tests cover: getOrCreatePacket (RBAC, creation, idempotency),
 * updateSection (create/update, Draft->InProgress transition, locked/submitted guards),
 * transitionStatus (submit, reopen, lock, invalid transitions, optimistic locking).
 *
 * No IndexedDB — all repos are in-memory fakes.
 */

import { describe, it, expect } from 'vitest';
import { ApplicationPacketService } from '../application-packet.service';
import { ApplicationPacket, PacketSection } from '../../models';
import { PacketStatus, UserRole } from '../../enums';
import { generateId, now } from '../../utils/id';
import {
  FakeApplicationRepo, FakeApplicationPacketRepo, FakeDocumentRepo,
  fakeAudit, makeApplication, makePacket,
} from './helpers';
import { Document as TBDoc } from '../../models';
import { DocumentStatus } from '../../enums';

// ── Inline fakes for repos that need extra methods ────────────────────────────

/**
 * Extended FakeApplicationPacketRepo with updateWithLock support
 * needed by transitionStatus and updateSection.
 */
class FakePacketRepo {
  private store: ApplicationPacket[] = [];
  seed(items: ApplicationPacket[]): this { this.store = [...items]; return this; }
  snapshot(): ApplicationPacket[] { return [...this.store]; }
  async getById(id: string) { return this.store.find(p => p.id === id) ?? null; }
  async getByApplication(appId: string) { return this.store.find(p => p.applicationId === appId) ?? null; }
  async add(item: ApplicationPacket) { this.store.push(item); }
  async put(item: ApplicationPacket) {
    const idx = this.store.findIndex(p => p.id === item.id);
    if (idx >= 0) this.store[idx] = item; else this.store.push(item);
  }
  async updateWithLock(id: string, updater: (current: ApplicationPacket) => ApplicationPacket): Promise<ApplicationPacket> {
    const idx = this.store.findIndex(p => p.id === id);
    if (idx < 0) throw new Error(`FakePacketRepo: not found: ${id}`);
    const updated = updater(this.store[idx]);
    this.store[idx] = updated;
    return updated;
  }
}

class FakePacketSectionRepo {
  private store: PacketSection[] = [];
  seed(items: PacketSection[]): this { this.store = [...items]; return this; }
  snapshot(): PacketSection[] { return [...this.store]; }
  async getByPacket(packetId: string) { return this.store.filter(s => s.applicationPacketId === packetId); }
  async add(item: PacketSection) { this.store.push(item); }
  async updateWithLock(id: string, updater: (current: PacketSection) => PacketSection): Promise<PacketSection> {
    const idx = this.store.findIndex(s => s.id === id);
    if (idx < 0) throw new Error(`FakePacketSectionRepo: not found: ${id}`);
    const updated = updater(this.store[idx]);
    this.store[idx] = updated;
    return updated;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

function makeResumeDoc(applicationId: string, ownerId = CANDIDATE): TBDoc {
  return {
    id: 'doc-resume', ownerUserId: ownerId, organizationId: ORG, applicationId,
    fileName: 'resume.pdf', mimeType: 'application/pdf', extension: '.pdf', sizeBytes: 1000,
    documentType: 'Resume / CV',
    encryptedBlob: 'enc:data', encryptionIv: 'iv', adminEncryptedBlob: 'enc:data', adminEncryptionIv: 'iv',
    status: DocumentStatus.Uploaded, version: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeSvc(
  packetRepo = new FakePacketRepo(),
  sectionRepo = new FakePacketSectionRepo(),
  appRepo = new FakeApplicationRepo(),
  docRepo = new FakeDocumentRepo(),
) {
  return {
    svc: new ApplicationPacketService(
      packetRepo as any,
      sectionRepo as any,
      appRepo as any,
      fakeAudit as any,
      docRepo as any,
    ),
    packetRepo,
    sectionRepo,
    appRepo,
    docRepo,
  };
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const APP_ID = 'app1';
const CANDIDATE = 'candidate1';
const ORG = 'org1';

function seedApp(appRepo: FakeApplicationRepo, overrides: Partial<ReturnType<typeof makeApplication>> = {}) {
  const app = makeApplication({ id: APP_ID, candidateId: CANDIDATE, organizationId: ORG, ...overrides });
  appRepo.seed([app]);
  return app;
}

// ── getOrCreatePacket ─────────────────────────────────────────────────────────

describe('ApplicationPacketService', () => {
  describe('getOrCreatePacket', () => {
    it('creates a new Draft packet for a valid application', async () => {
      const { svc, appRepo, packetRepo } = makeSvc();
      seedApp(appRepo);

      const packet = await svc.getOrCreatePacket(APP_ID, CANDIDATE, ORG);
      expect(packet.applicationId).toBe(APP_ID);
      expect(packet.status).toBe(PacketStatus.Draft);
      expect(packet.version).toBe(1);
      // Verify it was persisted
      expect(await packetRepo.getById(packet.id)).toBeTruthy();
    });

    it('returns existing packet if one exists', async () => {
      const packetRepo = new FakePacketRepo();
      const existing = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress });
      packetRepo.seed([existing]);
      const { svc, appRepo } = makeSvc(packetRepo);
      seedApp(appRepo);

      const packet = await svc.getOrCreatePacket(APP_ID, CANDIDATE, ORG);
      expect(packet.id).toBe(existing.id);
      expect(packet.status).toBe(PacketStatus.InProgress);
    });

    it('throws when application does not belong to caller org', async () => {
      const { svc, appRepo } = makeSvc();
      seedApp(appRepo, { organizationId: 'other-org' });

      await expect(svc.getOrCreatePacket(APP_ID, CANDIDATE, ORG))
        .rejects.toThrow('Organization mismatch');
    });

    it('throws when candidate tries to access another candidate packet', async () => {
      const { svc, appRepo } = makeSvc();
      seedApp(appRepo, { candidateId: 'other-candidate' });

      await expect(svc.getOrCreatePacket(APP_ID, CANDIDATE, ORG))
        .rejects.toThrow('Only the owning candidate');
    });
  });

  // ── updateSection ─────────────────────────────────────────────────────────

  describe('updateSection', () => {
    it('creates a new section and transitions packet to InProgress', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.Draft });
      packetRepo.seed([pkt]);
      const { svc, appRepo, sectionRepo } = makeSvc(packetRepo);
      seedApp(appRepo);

      const section = await svc.updateSection(pkt.id, 'personal_info', { name: 'Alice' }, CANDIDATE, ORG);
      expect(section.sectionKey).toBe('personal_info');
      expect(section.payload).toEqual({ name: 'Alice' });
      expect(section.isComplete).toBe(true);

      // Packet should have transitioned to InProgress
      const updated = await packetRepo.getById(pkt.id);
      expect(updated!.status).toBe(PacketStatus.InProgress);
    });

    it('updates an existing section', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress });
      packetRepo.seed([pkt]);
      const sectionRepo = new FakePacketSectionRepo();
      const existingSection: PacketSection = {
        id: generateId(), applicationPacketId: pkt.id, sectionKey: 'personal_info',
        payload: { name: 'Alice' }, isComplete: true, version: 1, createdAt: now(), updatedAt: now(),
      };
      sectionRepo.seed([existingSection]);
      const { svc, appRepo } = makeSvc(packetRepo, sectionRepo);
      seedApp(appRepo);

      const section = await svc.updateSection(pkt.id, 'personal_info', { name: 'Alice Updated' }, CANDIDATE, ORG);
      expect(section.payload).toEqual({ name: 'Alice Updated' });
      expect(section.version).toBe(2);
    });

    it('throws when packet is Locked', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.Locked });
      packetRepo.seed([pkt]);
      const { svc, appRepo } = makeSvc(packetRepo);
      seedApp(appRepo);

      await expect(svc.updateSection(pkt.id, 'personal_info', { name: 'Alice' }, CANDIDATE, ORG))
        .rejects.toThrow('locked');
    });

    it('throws when packet is Submitted', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.Submitted });
      packetRepo.seed([pkt]);
      const { svc, appRepo } = makeSvc(packetRepo);
      seedApp(appRepo);

      await expect(svc.updateSection(pkt.id, 'personal_info', { name: 'Alice' }, CANDIDATE, ORG))
        .rejects.toThrow('submitted');
    });
  });

  // ── transitionStatus ──────────────────────────────────────────────────────

  describe('transitionStatus', () => {
    it('candidate can submit InProgress packet with required Resume/CV doc', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress, version: 1 });
      packetRepo.seed([pkt]);
      const docRepo = new FakeDocumentRepo();
      docRepo.seed([makeResumeDoc(APP_ID)]);
      const { svc, appRepo } = makeSvc(packetRepo, new FakePacketSectionRepo(), new FakeApplicationRepo(), docRepo);
      seedApp(appRepo);

      const updated = await svc.transitionStatus(
        pkt.id, PacketStatus.Submitted, CANDIDATE, [UserRole.Candidate], ORG, 1,
      );
      expect(updated.status).toBe(PacketStatus.Submitted);
      expect(updated.submittedAt).toBeTruthy();
      expect(updated.version).toBe(2);
    });

    it('rejects submit when no Resume/CV document exists', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress, version: 1 });
      packetRepo.seed([pkt]);
      // No doc seeded
      const { svc, appRepo } = makeSvc(packetRepo);
      seedApp(appRepo);

      await expect(svc.transitionStatus(
        pkt.id, PacketStatus.Submitted, CANDIDATE, [UserRole.Candidate], ORG, 1,
      )).rejects.toThrow(/Resume \/ CV/);
    });

    it('rejects submit when only non-resume doc exists (e.g. Cover Letter)', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress, version: 1 });
      packetRepo.seed([pkt]);
      const docRepo = new FakeDocumentRepo();
      const coverLetterDoc: TBDoc = { ...makeResumeDoc(APP_ID), id: 'doc-cl', documentType: 'Cover Letter', fileName: 'cover.pdf' };
      docRepo.seed([coverLetterDoc]);
      const { svc, appRepo } = makeSvc(packetRepo, new FakePacketSectionRepo(), new FakeApplicationRepo(), docRepo);
      seedApp(appRepo);

      await expect(svc.transitionStatus(
        pkt.id, PacketStatus.Submitted, CANDIDATE, [UserRole.Candidate], ORG, 1,
      )).rejects.toThrow(/Resume \/ CV/);
    });

    it('management can reopen Submitted packet with reason', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.Submitted, version: 2 });
      packetRepo.seed([pkt]);
      const { svc, appRepo } = makeSvc(packetRepo);
      seedApp(appRepo);

      const updated = await svc.transitionStatus(
        pkt.id, PacketStatus.Reopened, 'employer1', [UserRole.Employer], ORG, 2, 'Missing docs',
      );
      expect(updated.status).toBe(PacketStatus.Reopened);
      expect(updated.reopenReason).toBe('Missing docs');
      expect(updated.reopenedBy).toBe('employer1');
    });

    it('management can lock Submitted packet', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.Submitted, version: 2 });
      packetRepo.seed([pkt]);
      const { svc, appRepo } = makeSvc(packetRepo);
      seedApp(appRepo);

      const updated = await svc.transitionStatus(
        pkt.id, PacketStatus.Locked, 'employer1', [UserRole.Employer], ORG, 2,
      );
      expect(updated.status).toBe(PacketStatus.Locked);
    });

    it('rejects reopen without reason', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.Submitted, version: 2 });
      packetRepo.seed([pkt]);
      const { svc, appRepo } = makeSvc(packetRepo);
      seedApp(appRepo);

      await expect(svc.transitionStatus(
        pkt.id, PacketStatus.Reopened, 'employer1', [UserRole.Employer], ORG, 2,
      )).rejects.toThrow('reason');
    });

    it('rejects invalid transition (Draft -> Submitted)', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.Draft, version: 1 });
      packetRepo.seed([pkt]);
      const docRepo = new FakeDocumentRepo();
      docRepo.seed([makeResumeDoc(APP_ID)]);
      const { svc, appRepo } = makeSvc(packetRepo, new FakePacketSectionRepo(), new FakeApplicationRepo(), docRepo);
      seedApp(appRepo);

      await expect(svc.transitionStatus(
        pkt.id, PacketStatus.Submitted, CANDIDATE, [UserRole.Candidate], ORG, 1,
      )).rejects.toThrow();
    });

    it('enforces optimistic locking', async () => {
      const packetRepo = new FakePacketRepo();
      const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress, version: 3 });
      packetRepo.seed([pkt]);
      const docRepo = new FakeDocumentRepo();
      docRepo.seed([makeResumeDoc(APP_ID)]);
      const { svc, appRepo } = makeSvc(packetRepo, new FakePacketSectionRepo(), new FakeApplicationRepo(), docRepo);
      seedApp(appRepo);

      // Pass stale version 1 when actual is 3
      await expect(svc.transitionStatus(
        pkt.id, PacketStatus.Submitted, CANDIDATE, [UserRole.Candidate], ORG, 1,
      )).rejects.toThrow();
    });
  });
});
