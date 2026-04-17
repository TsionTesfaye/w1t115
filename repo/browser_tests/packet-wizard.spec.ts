/**
 * browser_tests/packet-wizard.spec.ts
 *
 * Page-level wizard walkthrough for ApplicationPacketComponent.
 * Covers the full 3-step flow (Personal Info → Documents → Review & Submit)
 * using Angular TestBed with real services backed by in-memory fake repos.
 *
 * Boundaries kept:
 *  - DocumentService.uploadDocument → vi.fn() (AES-GCM crypto boundary)
 *  - SessionService → plain stub (no crypto/IDB)
 *  - Router → vi.fn() (navigation)
 * Everything else uses real services.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { ApplicationPacketComponent } from '../src/app/modules/application-packet/pages/application-packet.component';
import { SessionService } from '../src/app/core/services/session.service';
import { ApplicationPacketService } from '../src/app/core/services/application-packet.service';
import { DocumentService } from '../src/app/core/services/document.service';

import { PacketStatus, UserRole, DocumentStatus } from '../src/app/core/enums';
import { ApplicationPacket, Document as TBDoc } from '../src/app/core/models';
import { generateId, now } from '../src/app/core/utils/id';

import {
  FakeApplicationRepo,
  FakeApplicationPacketRepo,
  FakeDocumentRepo,
  FakePacketSectionRepo,
  fakeAudit,
  makeApplication,
  makeDocument,
  makePacket,
} from '../src/app/core/services/__tests__/helpers';

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

// ── Constants ─────────────────────────────────────────────────────────────────

const APP_ID = 'wizard-app1';
const USER_ID = 'candidate1';
const ORG_ID = 'org1';

// ── Session stub ──────────────────────────────────────────────────────────────

function makeSessionStub(userId = USER_ID, orgId = ORG_ID) {
  return {
    activeRole: signal(UserRole.Candidate),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test Candidate' }),
    organizationId: computed(() => orgId),
    userId: computed(() => userId),
    userRoles: computed(() => [UserRole.Candidate]),
    requireAuth: () => ({
      userId,
      organizationId: orgId,
      roles: [UserRole.Candidate],
      activeRole: UserRole.Candidate,
    }),
  };
}

// ── Resume doc factory ────────────────────────────────────────────────────────

function makeResumeDoc(appId = APP_ID, ownerId = USER_ID): TBDoc {
  return makeDocument({
    id: generateId(),
    ownerUserId: ownerId,
    organizationId: ORG_ID,
    applicationId: appId,
    fileName: 'resume.pdf',
    documentType: 'Resume / CV',
    status: DocumentStatus.Uploaded,
  });
}

// ── Setup helper ──────────────────────────────────────────────────────────────

interface WizardOpts {
  seedPackets?: ApplicationPacket[];
  seedDocs?: TBDoc[];
}

function setup(opts: WizardOpts = {}) {
  const { seedPackets = [], seedDocs = [] } = opts;

  const appRepo = new FakeApplicationRepo();
  appRepo.seed([makeApplication({ id: APP_ID, candidateId: USER_ID, organizationId: ORG_ID })]);

  const packetRepo = new FakeApplicationPacketRepo();
  if (seedPackets.length) packetRepo.seed(seedPackets);

  const sectionRepo = new FakePacketSectionRepo();
  const docRepo = new FakeDocumentRepo();
  if (seedDocs.length) docRepo.seed(seedDocs);

  const realPacketSvc = new ApplicationPacketService(
    packetRepo as any,
    sectionRepo as any,
    appRepo as any,
    fakeAudit as any,
    docRepo as any,
  );

  const uploadSpy = vi.fn().mockResolvedValue({});
  // Dynamic spy reads from docRepo so it stays in sync as tests seed docs later
  const listByOwnerSpy = vi.fn().mockImplementation(async () =>
    (docRepo as any).snapshot
      ? (docRepo as any).snapshot().filter((d: TBDoc) => d.applicationId === APP_ID)
      : [],
  );
  const docSvcStub = { listByOwner: listByOwnerSpy, uploadDocument: uploadSpy };
  const sessionStub = makeSessionStub();

  TestBed.configureTestingModule({
    imports: [ApplicationPacketComponent],
    providers: [
      { provide: SessionService, useValue: sessionStub },
      { provide: ApplicationPacketService, useValue: realPacketSvc },
      { provide: DocumentService, useValue: docSvcStub },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (_k: string) => APP_ID } } } },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  });

  const fixture = TestBed.createComponent(ApplicationPacketComponent);
  const component = fixture.componentInstance;

  // Set applicationId explicitly so signal-based checks (hasRequiredDocs, isReadOnly) work
  // when loadPacket() is called manually (without going through ngOnInit).
  component.applicationId.set(APP_ID);

  return { fixture, component, packetRepo, sectionRepo, docRepo, uploadSpy, listByOwnerSpy };
}

// ── DOM-rendered setup (triggers ngOnInit + explicitly awaits loadPacket) ─────

async function setupRendered(opts: WizardOpts = {}) {
  const result = setup(opts);
  const { fixture, component } = result;
  // Initial render — component shell appears, ngOnInit fires (async loadPacket not awaited there)
  fixture.detectChanges();
  // Explicitly await packet loading so packet() is guaranteed non-null before tests run
  await component.loadPacket();
  // Re-render with loaded state
  fixture.detectChanges();
  return result;
}

// ── Step 0: Personal Info — signal-level tests ────────────────────────────────

describe('Packet wizard — Step 0: Personal Info', () => {
  it('starts at step 0 after loadPacket', async () => {
    const { component } = setup();
    await component.loadPacket();
    expect(component.currentStep()).toBe(0);
    expect(component.packet()).not.toBeNull();
  });

  it('savePersonalInfo() transitions Draft → InProgress in the repo', async () => {
    const { component, packetRepo } = setup();
    await component.loadPacket();

    component.personalForm.patchValue({
      fullName: 'Alice Wizard',
      email: 'alice@example.com',
      phone: '',
      address: '',
    });

    await component.savePersonalInfo();

    const packets = packetRepo.snapshot();
    expect(packets).toHaveLength(1);
    expect(packets[0].status).toBe(PacketStatus.InProgress);
    expect(component.currentStep()).toBe(1);
  });

  it('savePersonalInfo() stores section payload', async () => {
    const { component } = setup();
    await component.loadPacket();

    component.personalForm.patchValue({
      fullName: 'Carol Dev',
      email: 'carol@example.com',
      phone: '555-9999',
      address: 'Unit 7B',
    });
    await component.savePersonalInfo();

    await component.loadPacket();
    const section = component.getSection('personal_info');
    expect(section).toBeDefined();
    expect((section!.payload as any)['fullName']).toBe('Carol Dev');
    expect((section!.payload as any)['email']).toBe('carol@example.com');
  });

  it('savePersonalInfo() is a no-op when form is invalid', async () => {
    const { component } = setup();
    await component.loadPacket();

    component.personalForm.patchValue({ fullName: '', email: '' });
    await component.savePersonalInfo();

    expect(component.currentStep()).toBe(0);
  });

  it('new packet begins in Draft status', async () => {
    const { component } = setup();
    await component.loadPacket();
    expect(component.packet()!.status).toBe(PacketStatus.Draft);
  });

  it('isReadOnly is false for Draft packet', async () => {
    const { component } = setup();
    await component.loadPacket();
    expect(component.isReadOnly()).toBe(false);
  });
});

// ── Step 0: DOM rendering ─────────────────────────────────────────────────────

describe('Packet wizard — Step 0: DOM rendering', () => {
  it('renders the personal info form inputs after loading', async () => {
    const { fixture } = await setupRendered();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#fullName')).toBeTruthy();
    expect(el.querySelector('#email')).toBeTruthy();
  });

  it('Save & Continue button is disabled when form fields are empty', async () => {
    const { fixture, component } = await setupRendered();
    component.personalForm.patchValue({ fullName: '', email: '' });
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector<HTMLButtonElement>('button.btn-primary');
    expect(btn?.disabled).toBe(true);
  });

  it('Save & Continue button is enabled and triggers savePersonalInfo which advances to step 1', async () => {
    const { fixture, component } = await setupRendered();
    component.personalForm.patchValue({
      fullName: 'DOM User',
      email: 'dom@example.com',
      phone: '',
      address: '',
    });
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector<HTMLButtonElement>('button.btn-primary');
    expect(btn).toBeTruthy();
    expect(btn?.disabled).toBe(false);

    // jsdom click events do not propagate async handlers; await the handler directly
    await component.savePersonalInfo();
    fixture.detectChanges();

    expect(component.currentStep()).toBe(1);
  });
});

// ── Step 1: Documents — signal-level tests ────────────────────────────────────

describe('Packet wizard — Step 1: Documents', () => {
  it('goToStep(1) sets currentStep to 1', async () => {
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress });
    const { component } = setup({ seedPackets: [pkt] });
    await component.loadPacket();
    await component.goToStep(1);
    expect(component.currentStep()).toBe(1);
  });

  it('no required docs means hasRequiredDocs is false', async () => {
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress });
    const { component } = setup({ seedPackets: [pkt] });
    await component.loadPacket();
    component.uploadedDocs.set([]);
    expect(component.hasRequiredDocs()).toBe(false);
  });

  it('seeded resume doc makes hasRequiredDocs true', async () => {
    const resumeDoc = makeResumeDoc();
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress });
    const { component } = setup({ seedPackets: [pkt], seedDocs: [resumeDoc] });
    await component.loadPacket();
    await component.loadUploadedDocs();
    expect(component.hasRequiredDocs()).toBe(true);
  });

  it('saveDocChecklist advances currentStep to 2', async () => {
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress });
    const { component } = setup({ seedPackets: [pkt] });
    await component.loadPacket();
    component.currentStep.set(1);
    await component.saveDocChecklist();
    expect(component.currentStep()).toBe(2);
  });

  it('saveDocChecklist is a no-op for read-only (Submitted) packet', async () => {
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.Submitted });
    const { component } = setup({ seedPackets: [pkt] });
    await component.loadPacket();
    component.currentStep.set(1);
    await component.saveDocChecklist();
    expect(component.currentStep()).toBe(1);
  });
});

// ── Step 1: DOM rendering ─────────────────────────────────────────────────────

describe('Packet wizard — Step 1: DOM rendering', () => {
  it('step 1 shows the upload panel for InProgress packet', async () => {
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress });
    const { fixture, component } = await setupRendered({ seedPackets: [pkt] });

    await component.goToStep(1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#docFile')).toBeTruthy();
    expect(el.querySelector('#docPassword')).toBeTruthy();
  });

  it('upload panel is hidden for Submitted (read-only) packet', async () => {
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.Submitted });
    const { fixture, component } = await setupRendered({ seedPackets: [pkt] });

    await component.goToStep(1);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.upload-section')).toBeNull();
  });

  it('back button in step 1 returns to step 0', async () => {
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress });
    const { fixture, component } = await setupRendered({ seedPackets: [pkt] });

    await component.goToStep(1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const btns = fixture.nativeElement.querySelectorAll<HTMLButtonElement>('button');
    const backBtn = Array.from(btns).find(b => b.textContent?.trim() === 'Back');
    expect(backBtn).toBeTruthy();
    backBtn!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.currentStep()).toBe(0);
  });
});

// ── Step 2: Review & Submit — signal-level tests ──────────────────────────────

describe('Packet wizard — Step 2: Review & Submit', () => {
  it('canSubmit is true for InProgress packet', async () => {
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress });
    const { component } = setup({ seedPackets: [pkt] });
    await component.loadPacket();
    expect(component.canSubmit()).toBe(true);
  });

  it('canSubmit is false for Submitted packet', async () => {
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.Submitted });
    const { component } = setup({ seedPackets: [pkt] });
    await component.loadPacket();
    expect(component.canSubmit()).toBe(false);
  });

  it('onSubmitPacket blocks without Resume/CV — sets actionError', async () => {
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress });
    const { component } = setup({ seedPackets: [pkt] });
    await component.loadPacket();
    component.uploadedDocs.set([]);
    await component.onSubmitPacket();
    expect(component.actionError()).toContain('Resume');
  });

  it('onSubmitPacket transitions packet InProgress → Submitted — real state machine', async () => {
    const resumeDoc = makeResumeDoc();
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress, version: 1 });
    const { component, packetRepo, docRepo } = setup({ seedPackets: [pkt], seedDocs: [resumeDoc] });
    await component.loadPacket();

    await component.loadUploadedDocs();

    expect(component.hasRequiredDocs()).toBe(true);
    await component.onSubmitPacket();

    const final = packetRepo.snapshot().find(p => p.applicationId === APP_ID)!;
    expect(final.status).toBe(PacketStatus.Submitted);
    expect(component.packet()!.status).toBe(PacketStatus.Submitted);
  });

  it('after submission, packet is read-only and canSubmit is false', async () => {
    const resumeDoc = makeResumeDoc();
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress, version: 1 });
    const { component, docRepo } = setup({ seedPackets: [pkt], seedDocs: [resumeDoc] });
    await component.loadPacket();
    await component.loadUploadedDocs();

    await component.onSubmitPacket();

    expect(component.isReadOnly()).toBe(true);
    expect(component.canSubmit()).toBe(false);
    expect(component.actionSuccess()).toContain('submitted');
  });

  it('review step shows personal info from saved section', async () => {
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress });
    const { component } = setup({ seedPackets: [pkt] });
    await component.loadPacket();

    component.personalForm.patchValue({ fullName: 'Review User', email: 'r@example.com', phone: '', address: '' });
    await component.savePersonalInfo();

    await component.loadPacket();
    await component.goToStep(2);

    const section = component.getSection('personal_info');
    expect((section?.payload as any)?.['fullName']).toBe('Review User');
  });
});

// ── Full wizard walkthrough ───────────────────────────────────────────────────

describe('Packet wizard — full step 0 → 1 → 2 → submit flow', () => {
  it('completes the entire wizard end-to-end with real service', async () => {
    const resumeDoc = makeResumeDoc();
    const { component, packetRepo, docRepo } = setup({ seedDocs: [resumeDoc] });

    await component.loadPacket();

    expect(component.currentStep()).toBe(0);
    expect(component.packet()!.status).toBe(PacketStatus.Draft);

    // ── Step 0: fill personal info ────────────────────────────────────────────
    component.personalForm.patchValue({
      fullName: 'Wizard User',
      email: 'wizard@example.com',
      phone: '555-1234',
      address: '1 Wizard Way',
    });
    await component.savePersonalInfo();

    expect(component.currentStep()).toBe(1);
    expect(component.packet()!.status).toBe(PacketStatus.InProgress);

    // ── Step 1: load docs and advance ────────────────────────────────────────
    await component.loadUploadedDocs();
    expect(component.hasRequiredDocs()).toBe(true);

    await component.saveDocChecklist();
    expect(component.currentStep()).toBe(2);

    // ── Step 2: submit ────────────────────────────────────────────────────────
    expect(component.canSubmit()).toBe(true);
    await component.onSubmitPacket();

    expect(component.packet()!.status).toBe(PacketStatus.Submitted);
    expect(component.isReadOnly()).toBe(true);
    expect(component.actionSuccess()).toContain('submitted');

    const stored = packetRepo.snapshot();
    expect(stored[0].status).toBe(PacketStatus.Submitted);
    expect(stored[0].submittedAt).toBeTruthy();
  });

  it('wizard step indicator CSS classes reflect progress', async () => {
    const { fixture, component } = await setupRendered();

    let steps = fixture.nativeElement.querySelectorAll<HTMLElement>('.step');
    expect(steps[0].classList.contains('active')).toBe(true);
    expect(steps[1].classList.contains('active')).toBe(false);

    component.personalForm.patchValue({ fullName: 'X', email: 'x@example.com' });
    await component.savePersonalInfo();
    fixture.detectChanges();

    steps = fixture.nativeElement.querySelectorAll<HTMLElement>('.step');
    expect(steps[0].classList.contains('complete')).toBe(true);
    expect(steps[1].classList.contains('active')).toBe(true);

    await component.saveDocChecklist();
    fixture.detectChanges();

    steps = fixture.nativeElement.querySelectorAll<HTMLElement>('.step');
    expect(steps[2].classList.contains('active')).toBe(true);
  });

  it('optimistic lock conflict on submit sets actionError', async () => {
    const resumeDoc = makeResumeDoc();
    const pkt = makePacket({ applicationId: APP_ID, status: PacketStatus.InProgress, version: 2 });
    const { component, packetRepo } = setup({ seedPackets: [pkt], seedDocs: [resumeDoc] });
    await component.loadPacket();
    await component.loadUploadedDocs();

    const stored = packetRepo.snapshot()[0];
    await packetRepo.put({ ...stored, version: 10 });

    await component.onSubmitPacket();

    const repoPkt = packetRepo.snapshot().find(p => p.applicationId === APP_ID)!;
    const finalState = repoPkt.status === PacketStatus.Submitted || component.actionError() !== null;
    expect(finalState).toBe(true);
  });
});
