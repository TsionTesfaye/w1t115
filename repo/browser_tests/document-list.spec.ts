/**
 * browser_tests/document-list.spec.ts
 *
 * Component / UI interaction tests for DocumentListComponent.
 * These use Angular TestBed to test that UI state signals update correctly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { DocumentListComponent } from '../src/app/modules/documents/pages/document-list.component';
import { SessionService } from '../src/app/core/services/session.service';
import { DocumentService } from '../src/app/core/services/document.service';
import { UserRole, DocumentStatus } from '../src/app/core/enums';
import { vi } from 'vitest';

afterEach(() => {
  TestBed.resetTestingModule();
});

function makeSessionMock(role: UserRole = UserRole.Candidate) {
  return {
    activeRole: signal(role),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test User' }),
    organizationId: computed(() => 'org1'),
    userId: computed(() => 'user1'),
    userRoles: computed(() => [role]),
    requireAuth: () => ({ userId: 'user1', organizationId: 'org1', roles: [role], activeRole: role }),
  };
}

function makeDocSvcMock(overrides: Record<string, any> = {}) {
  return {
    listAuthorized: vi.fn().mockResolvedValue([]),
    uploadDocument: vi.fn().mockResolvedValue({ id: 'doc1', fileName: 'test.pdf', status: 'uploaded', sizeBytes: 1000, mimeType: 'application/pdf' }),
    downloadDocument: vi.fn().mockResolvedValue({ blob: new Blob(['test']), fileName: 'test.pdf', mimeType: 'application/pdf' }),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function configure(docSvc = makeDocSvcMock()) {
  TestBed.configureTestingModule({
    imports: [DocumentListComponent],
    providers: [
      { provide: SessionService, useValue: makeSessionMock() },
      { provide: DocumentService, useValue: docSvc },
    ],
  });
  const fixture = TestBed.createComponent(DocumentListComponent);
  return { component: fixture.componentInstance, docSvc };
}

describe('DocumentListComponent', () => {
  it('loads documents on init', async () => {
    const doc = { id: 'd1', fileName: 'resume.pdf', sizeBytes: 1000, mimeType: 'application/pdf', status: DocumentStatus.Uploaded, organizationId: 'org1', ownerUserId: 'user1', applicationId: null, extension: '.pdf', encryptedBlob: 'x', encryptionIv: 'y', version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
    const { component, docSvc } = configure(makeDocSvcMock({ listAuthorized: vi.fn().mockResolvedValue([doc]) }));

    await component.loadDocuments();

    expect(docSvc.listAuthorized).toHaveBeenCalled();
    expect(component.documents()).toHaveLength(1);
    expect(component.isLoading()).toBe(false);
  });

  it('sets error signal when load fails', async () => {
    const { component } = configure(makeDocSvcMock({
      listAuthorized: vi.fn().mockRejectedValue(new Error('load failed')),
    }));

    await component.loadDocuments();

    expect(component.error()).toBe('load failed');
  });

  it('watermark is enabled by default', () => {
    const { component } = configure();
    expect(component.watermarkEnabled()).toBe(true);
  });

  it('watermark can be toggled', () => {
    const { component } = configure();
    component.watermarkEnabled.set(false);
    expect(component.watermarkEnabled()).toBe(false);
  });
});
