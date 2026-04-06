import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { DocumentListComponent } from '../document-list.component';
import { SessionService } from '../../../../core/services/session.service';
import { DocumentService } from '../../../../core/services/document.service';
import { UserRole } from '../../../../core/enums';
import { Document as TBDoc } from '../../../../core/models';

afterEach(() => {
  TestBed.resetTestingModule();
});

function makeSessionMock() {
  return {
    activeRole: signal(UserRole.Candidate),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test User' }),
    organizationId: computed(() => 'org1'),
    userId: computed(() => 'user1'),
    userRoles: computed(() => [UserRole.Candidate]),
    requireAuth: () => ({
      userId: 'user1',
      organizationId: 'org1',
      roles: [UserRole.Candidate],
      activeRole: UserRole.Candidate,
    }),
  };
}

const sampleDoc: TBDoc = {
  id: 'doc1', ownerUserId: 'user1', organizationId: 'org1', applicationId: null,
  fileName: 'resume.pdf', mimeType: 'application/pdf', extension: '.pdf',
  sizeBytes: 1024, documentType: 'Resume / CV',
  encryptedBlob: 'abc', encryptionIv: 'iv1', adminEncryptedBlob: null, adminEncryptionIv: null,
  status: 'uploaded', version: 1, createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z',
};

const sampleDoc2: TBDoc = {
  id: 'doc2', ownerUserId: 'user1', organizationId: 'org1', applicationId: 'app1',
  fileName: 'photo.png', mimeType: 'image/png', extension: '.png',
  sizeBytes: 2048, documentType: null,
  encryptedBlob: 'def', encryptionIv: 'iv2', adminEncryptedBlob: null, adminEncryptionIv: null,
  status: 'uploaded', version: 1, createdAt: '2026-04-02T00:00:00Z', updatedAt: '2026-04-02T00:00:00Z',
};

function configure(overrides: Record<string, any> = {}) {
  const docSvc = {
    listAuthorized: vi.fn().mockResolvedValue([sampleDoc, sampleDoc2]),
    uploadDocument: vi.fn().mockResolvedValue(sampleDoc),
    downloadDocument: vi.fn().mockResolvedValue({ blob: new Blob(['test']), fileName: 'resume.pdf', mimeType: 'application/pdf' }),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

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
  it('loads and displays user documents', async () => {
    const { component, docSvc } = configure();
    await component.loadDocuments();
    expect(docSvc.listAuthorized).toHaveBeenCalledWith('user1', [UserRole.Candidate], 'org1');
    expect(component.documents().length).toBe(2);
    expect(component.documents()[0].fileName).toBe('resume.pdf');
    expect(component.isLoading()).toBe(false);
  });

  it('shows upload form when button clicked', () => {
    const { component } = configure();
    expect(component.showUploadForm()).toBe(false);
    component.showUploadForm.set(true);
    expect(component.showUploadForm()).toBe(true);
  });

  it('uploads a document and refreshes list', async () => {
    const { component, docSvc } = configure();
    component.showUploadForm.set(true);
    component.selectedFile.set({ name: 'test.pdf', type: 'application/pdf', size: 500, data: new ArrayBuffer(500) });
    component.uploadForm.setValue({ password: 'secret', applicationId: '' });
    await component.onUpload();
    expect(docSvc.uploadDocument).toHaveBeenCalledWith(
      { name: 'test.pdf', type: 'application/pdf', size: 500, data: expect.any(ArrayBuffer) },
      null, 'user1', 'org1', 'secret',
    );
    expect(component.showUploadForm()).toBe(false);
    expect(docSvc.listAuthorized).toHaveBeenCalled();
  });

  it('deletes a document and refreshes list', async () => {
    // Mock confirm
    vi.stubGlobal('confirm', () => true);
    const { component, docSvc } = configure();
    await component.loadDocuments();
    await component.onDelete(sampleDoc);
    expect(docSvc.deleteDocument).toHaveBeenCalledWith('doc1', 'user1', [UserRole.Candidate], 'org1');
    // listAuthorized called again for refresh
    expect(docSvc.listAuthorized).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('shows error on upload failure', async () => {
    const { component } = configure({
      uploadDocument: vi.fn().mockRejectedValue(new Error('File too large')),
    });
    component.selectedFile.set({ name: 'big.pdf', type: 'application/pdf', size: 999999, data: new ArrayBuffer(10) });
    component.uploadForm.setValue({ password: 'pw', applicationId: '' });
    await component.onUpload();
    expect(component.actionError()).toBe('File too large');
  });

  it('downloads a document', async () => {
    vi.stubGlobal('prompt', () => 'mypassword');
    // Mock URL.createObjectURL and revokeObjectURL
    const mockUrl = 'blob:http://localhost/fake';
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue(mockUrl), revokeObjectURL: vi.fn() });
    const { component, docSvc } = configure();
    await component.onDownload(sampleDoc);
    expect(docSvc.downloadDocument).toHaveBeenCalledWith('doc1', 'mypassword', 'user1', [UserRole.Candidate], 'org1');
    vi.unstubAllGlobals();
  });
});
