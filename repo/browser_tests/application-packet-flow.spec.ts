/**
 * browser_tests/application-packet-flow.spec.ts
 *
 * Service-layer end-to-end test for ApplicationPacketService.
 * No TestBed or Angular DI required — constructs real service with fake repos.
 *
 * Flow:
 *  1. Create a packet (getOrCreatePacket)
 *  2. Update a section (updateSection — also transitions Draft → InProgress)
 *  3. Transition status: InProgress → Submitted (requires a Resume doc)
 *  4. Verify final state in FakeApplicationPacketRepo
 */

import { describe, it, expect } from 'vitest';
import { ApplicationPacketService } from '../src/app/core/services/application-packet.service';
import { ApplicationPacket, PacketSection } from '../src/app/core/models';
import { PacketStatus, DocumentStatus, UserRole } from '../src/app/core/enums';
import { OptimisticLockError, ValidationError } from '../src/app/core/errors';
import {
  FakeApplicationRepo, FakeDocumentRepo,
  FakeApplicationPacketRepo, FakePacketSectionRepo,
  fakeAudit, makeApplication, makeDocument,
} from '../src/app/core/services/__tests__/helpers';
import { generateId, now } from '../src/app/core/utils/id';

// ── Constants ─────────────────────────────────────────────────────────────────

const CANDIDATE_ID = 'candidate1';
const ORG_ID = 'org1';
const APP_ID = 'app1';

// ── Service factory ───────────────────────────────────────────────────────────

function makeService(
  packetRepo = new FakeApplicationPacketRepo(),
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ApplicationPacketService — end-to-end flow', () => {
  it('creates a new packet for a candidate application', async () => {
    const { svc, packetRepo, appRepo } = makeService();
    appRepo.seed([
      makeApplication({ id: APP_ID, candidateId: CANDIDATE_ID, organizationId: ORG_ID }),
    ]);

    const packet = await svc.getOrCreatePacket(APP_ID, CANDIDATE_ID, ORG_ID);

    expect(packet.applicationId).toBe(APP_ID);
    expect(packet.status).toBe(PacketStatus.Draft);
    expect(packet.version).toBe(1);

    const stored = packetRepo.snapshot();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(packet.id);
  });

  it('getOrCreatePacket is idempotent — returns existing packet on second call', async () => {
    const { svc, packetRepo, appRepo } = makeService();
    appRepo.seed([
      makeApplication({ id: APP_ID, candidateId: CANDIDATE_ID, organizationId: ORG_ID }),
    ]);

    const first = await svc.getOrCreatePacket(APP_ID, CANDIDATE_ID, ORG_ID);
    const second = await svc.getOrCreatePacket(APP_ID, CANDIDATE_ID, ORG_ID);

    expect(second.id).toBe(first.id);
    expect(packetRepo.snapshot()).toHaveLength(1);
  });

  it('updateSection transitions Draft → InProgress and creates section', async () => {
    const appRepo = new FakeApplicationRepo();
    appRepo.seed([
      makeApplication({ id: APP_ID, candidateId: CANDIDATE_ID, organizationId: ORG_ID }),
    ]);
    const packetRepo = new FakeApplicationPacketRepo();
    const sectionRepo = new FakePacketSectionRepo();
    const { svc } = makeService(packetRepo, sectionRepo, appRepo);

    // Create packet first
    const packet = await svc.getOrCreatePacket(APP_ID, CANDIDATE_ID, ORG_ID);
    expect(packet.status).toBe(PacketStatus.Draft);

    // Update section — triggers Draft → InProgress transition
    const section = await svc.updateSection(
      packet.id,
      'personal_info',
      { firstName: 'Alice', lastName: 'Smith' },
      CANDIDATE_ID,
      ORG_ID,
    );

    // Section was created
    expect(section.sectionKey).toBe('personal_info');
    expect(section.payload).toEqual({ firstName: 'Alice', lastName: 'Smith' });
    expect(section.isComplete).toBe(true);

    // Packet was transitioned to InProgress
    const updatedPacket = (await packetRepo.getById(packet.id))!;
    expect(updatedPacket.status).toBe(PacketStatus.InProgress);
    expect(updatedPacket.version).toBeGreaterThan(1);
  });

  it('updateSection updates existing section', async () => {
    const appRepo = new FakeApplicationRepo();
    appRepo.seed([
      makeApplication({ id: APP_ID, candidateId: CANDIDATE_ID, organizationId: ORG_ID }),
    ]);
    const packetRepo = new FakeApplicationPacketRepo();
    const sectionRepo = new FakePacketSectionRepo();
    const { svc } = makeService(packetRepo, sectionRepo, appRepo);

    const packet = await svc.getOrCreatePacket(APP_ID, CANDIDATE_ID, ORG_ID);

    // First update — creates section
    await svc.updateSection(packet.id, 'work_history', { years: 3 }, CANDIDATE_ID, ORG_ID);

    // Second update — should update existing section
    const updated = await svc.updateSection(packet.id, 'work_history', { years: 5, companies: ['Acme'] }, CANDIDATE_ID, ORG_ID);

    expect(updated.payload).toEqual({ years: 5, companies: ['Acme'] });
    expect(updated.version).toBeGreaterThan(1);
  });

  it('full flow: Draft → InProgress → Submitted with resume doc', async () => {
    const appRepo = new FakeApplicationRepo();
    appRepo.seed([
      makeApplication({ id: APP_ID, candidateId: CANDIDATE_ID, organizationId: ORG_ID }),
    ]);
    const docRepo = new FakeDocumentRepo();
    docRepo.seed([
      makeDocument({
        id: 'doc1',
        ownerUserId: CANDIDATE_ID,
        organizationId: ORG_ID,
        applicationId: APP_ID,
        documentType: ApplicationPacketService.REQUIRED_DOC_TYPE,
        status: DocumentStatus.Uploaded,
      }),
    ]);
    const packetRepo = new FakeApplicationPacketRepo();
    const sectionRepo = new FakePacketSectionRepo();
    const { svc } = makeService(packetRepo, sectionRepo, appRepo, docRepo);

    // Step 1: Create packet (Draft)
    const packet = await svc.getOrCreatePacket(APP_ID, CANDIDATE_ID, ORG_ID);
    expect(packet.status).toBe(PacketStatus.Draft);

    // Step 2: Update a section (Draft → InProgress)
    await svc.updateSection(packet.id, 'personal_info', { name: 'Alice' }, CANDIDATE_ID, ORG_ID);
    const afterEdit = (await packetRepo.getById(packet.id))!;
    expect(afterEdit.status).toBe(PacketStatus.InProgress);

    // Step 3: Submit (InProgress → Submitted)
    const submitted = await svc.transitionStatus(
      packet.id, PacketStatus.Submitted,
      CANDIDATE_ID, [UserRole.Candidate], ORG_ID,
      afterEdit.version,
    );

    expect(submitted.status).toBe(PacketStatus.Submitted);
    expect(submitted.submittedAt).toBeTruthy();
    expect(submitted.version).toBeGreaterThan(afterEdit.version);

    // Verify final state in repo
    const final = (await packetRepo.getById(packet.id))!;
    expect(final.status).toBe(PacketStatus.Submitted);
  });

  it('transitionStatus requires resume doc for submission — ValidationError without it', async () => {
    const appRepo = new FakeApplicationRepo();
    appRepo.seed([
      makeApplication({ id: APP_ID, candidateId: CANDIDATE_ID, organizationId: ORG_ID }),
    ]);
    // No resume doc seeded
    const docRepo = new FakeDocumentRepo();
    const packetRepo = new FakeApplicationPacketRepo();
    const sectionRepo = new FakePacketSectionRepo();
    const { svc } = makeService(packetRepo, sectionRepo, appRepo, docRepo);

    const packet = await svc.getOrCreatePacket(APP_ID, CANDIDATE_ID, ORG_ID);
    // Manually bump packet to InProgress so it can be submitted
    await packetRepo.put({ ...packet, status: PacketStatus.InProgress, version: 2 });

    await expect(
      svc.transitionStatus(
        packet.id, PacketStatus.Submitted,
        CANDIDATE_ID, [UserRole.Candidate], ORG_ID,
        2,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('transitionStatus fails with OptimisticLockError when expectedVersion is stale', async () => {
    const appRepo = new FakeApplicationRepo();
    appRepo.seed([
      makeApplication({ id: APP_ID, candidateId: CANDIDATE_ID, organizationId: ORG_ID }),
    ]);
    const docRepo = new FakeDocumentRepo();
    docRepo.seed([
      makeDocument({
        ownerUserId: CANDIDATE_ID,
        organizationId: ORG_ID,
        applicationId: APP_ID,
        documentType: ApplicationPacketService.REQUIRED_DOC_TYPE,
        status: DocumentStatus.Uploaded,
      }),
    ]);
    const packetRepo = new FakeApplicationPacketRepo();
    const sectionRepo = new FakePacketSectionRepo();
    const { svc } = makeService(packetRepo, sectionRepo, appRepo, docRepo);

    const packet = await svc.getOrCreatePacket(APP_ID, CANDIDATE_ID, ORG_ID);
    // Advance to InProgress
    await packetRepo.put({ ...packet, status: PacketStatus.InProgress, version: 2 });

    // Pass stale version (1 instead of 2) → OptimisticLockError
    await expect(
      svc.transitionStatus(
        packet.id, PacketStatus.Submitted,
        CANDIDATE_ID, [UserRole.Candidate], ORG_ID,
        1, // stale!
      ),
    ).rejects.toThrow(OptimisticLockError);
  });

  it('management can lock a submitted packet', async () => {
    const appRepo = new FakeApplicationRepo();
    appRepo.seed([
      makeApplication({ id: APP_ID, candidateId: CANDIDATE_ID, organizationId: ORG_ID }),
    ]);
    const docRepo = new FakeDocumentRepo();
    docRepo.seed([
      makeDocument({
        ownerUserId: CANDIDATE_ID,
        organizationId: ORG_ID,
        applicationId: APP_ID,
        documentType: ApplicationPacketService.REQUIRED_DOC_TYPE,
        status: DocumentStatus.Uploaded,
      }),
    ]);
    const packetRepo = new FakeApplicationPacketRepo();
    const sectionRepo = new FakePacketSectionRepo();
    const { svc } = makeService(packetRepo, sectionRepo, appRepo, docRepo);

    // Create and submit
    const packet = await svc.getOrCreatePacket(APP_ID, CANDIDATE_ID, ORG_ID);
    await packetRepo.put({ ...packet, status: PacketStatus.InProgress, version: 2 });
    const submitted = await svc.transitionStatus(
      packet.id, PacketStatus.Submitted,
      CANDIDATE_ID, [UserRole.Candidate], ORG_ID,
      2,
    );

    // Lock it (management action)
    const locked = await svc.transitionStatus(
      packet.id, PacketStatus.Locked,
      'hr1', [UserRole.HRCoordinator], ORG_ID,
      submitted.version,
    );

    expect(locked.status).toBe(PacketStatus.Locked);
    const final = (await packetRepo.getById(packet.id))!;
    expect(final.status).toBe(PacketStatus.Locked);
  });
});
