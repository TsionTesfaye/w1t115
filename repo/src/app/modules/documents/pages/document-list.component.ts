import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DomSanitizer, SafeUrl, SafeResourceUrl } from '@angular/platform-browser';
import { SessionService } from '../../../core/services/session.service';
import { DocumentService } from '../../../core/services/document.service';
import { Document as TBDoc } from '../../../core/models';
import { UserRole } from '../../../core/enums';
import { DOCUMENT_CONSTANTS } from '../../../core/constants';
import { watermarkImage } from '../../../core/utils/watermark';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-document-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="header-left">
          <h1>{{ pageTitle() }}</h1>
          @if (!isHrOrAdmin()) {
            <span class="quota-badge">{{ formatSize(quotaUsed()) }} / {{ formatSize(quotaTotal) }} used</span>
          }
        </div>
        <div class="header-right">
          <label class="wm-toggle" title="Apply your name and timestamp as a watermark on previews and downloads">
            <input type="checkbox" [checked]="watermarkEnabled()" (change)="watermarkEnabled.set($any($event.target).checked)">
            Watermark
          </label>
          @if (!isHrOrAdmin()) {
            <button class="btn-primary" (click)="showUploadForm.set(!showUploadForm())">
              {{ showUploadForm() ? 'Cancel' : 'Upload Document' }}
            </button>
          }
        </div>
      </header>

      @if (actionSuccess()) {
        <div class="alert alert-success" role="status">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error" role="alert">{{ actionError() }}</div>
      }

      @if (showUploadForm()) {
        <div class="form-panel">
          <h2>Upload Document</h2>
          <form [formGroup]="uploadForm" (ngSubmit)="onUpload()">
            <div class="field">
              <label for="fileInput">File *</label>
              <input id="fileInput" type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp" (change)="onFileSelected($event)" />
              @if (selectedFileName()) {
                <span class="file-info">{{ selectedFileName() }} ({{ formatSize(selectedFileSize()) }})</span>
              }
            </div>
            <div class="field">
              <label for="password">Encryption Password *</label>
              <input id="password" type="password" formControlName="password" placeholder="Enter encryption password" />
            </div>
            <div class="field">
              <label for="applicationId">Link to Application (optional)</label>
              <input id="applicationId" type="text" formControlName="applicationId" placeholder="Application ID" />
            </div>
            <button type="submit" class="btn-primary" [disabled]="uploading() || !selectedFile() || uploadForm.invalid">
              {{ uploading() ? 'Uploading...' : 'Upload' }}
            </button>
          </form>
        </div>
      }

      @if (isLoading()) {
        <app-loading-state message="Loading documents..." />
      } @else if (error()) {
        <app-error-state [message]="error()!" [retryFn]="loadDocuments.bind(this)" />
      } @else if (documents().length === 0) {
        <app-empty-state message="No documents uploaded yet" />
      } @else {
        <div class="doc-grid">
          @for (doc of documents(); track doc.id) {
            <div class="doc-card">
              <div class="doc-preview">
                @if (isImage(doc.mimeType)) {
                  <div class="preview-icon image-icon">IMG</div>
                } @else {
                  <div class="preview-icon pdf-icon">PDF</div>
                }
              </div>
              <div class="doc-info">
                <h3 class="doc-name">{{ doc.fileName }}</h3>
                @if (isHrOrAdmin()) {
                  <span class="owner-badge">Owner: {{ doc.ownerUserId }}</span>
                }
                @if (doc.documentType) {
                  <span class="doctype-badge">{{ doc.documentType }}</span>
                }
                <span class="type-badge">{{ doc.extension }}</span>
                <span class="doc-size">{{ formatSize(doc.sizeBytes) }}</span>
                <span class="doc-date">{{ doc.createdAt | date:'medium' }}</span>
                <span class="status-badge status-{{ doc.status }}">{{ doc.status }}</span>
              </div>
              <div class="doc-actions">
                <button class="btn-secondary" (click)="onPreview(doc)">Preview</button>
                <button class="btn-secondary" (click)="onDownload(doc)">Download</button>
                @if (isHrOrAdmin() && doc.status !== 'reviewed' && doc.status !== 'archived') {
                  <button class="btn-review" (click)="onReview(doc)">Review</button>
                }
                @if (!isHrOrAdmin() || doc.ownerUserId === currentUserId()) {
                  <button class="btn-danger" (click)="onDelete(doc)">Delete</button>
                }
              </div>
            </div>
          }
        </div>
      }

      <!-- ── Preview modal ─────────────────────────────────────────────── -->
      @if (previewDoc()) {
        <div class="preview-overlay" role="dialog" aria-modal="true" aria-label="Document preview" (click)="closePreview()">
          <div class="preview-modal" (click)="$event.stopPropagation()">
            <div class="preview-modal-header">
              <span class="preview-filename">{{ previewDoc()!.fileName }}</span>
              <div class="preview-header-right">
                @if (watermarkEnabled()) {
                  <span class="wm-badge" title="Watermark active">🔏 Watermarked</span>
                }
                <button class="close-btn" (click)="closePreview()" aria-label="Close preview">✕</button>
              </div>
            </div>

            @if (previewLoading()) {
              <div class="preview-body preview-loading">
                <div class="spinner" aria-hidden="true"></div>
                <p>Decrypting document…</p>
              </div>
            } @else if (previewType() === 'image' && previewImgUrl()) {
              <div class="preview-body preview-image-wrap">
                <img [src]="previewImgUrl()!" [alt]="previewDoc()!.fileName" class="preview-img">
                @if (watermarkEnabled()) {
                  <div class="wm-label-image" aria-hidden="true">{{ watermarkLabel() }}</div>
                }
              </div>
            } @else if (previewType() === 'pdf' && previewPdfUrl()) {
              <div class="preview-body preview-pdf-wrap">
                <iframe
                  [src]="previewPdfUrl()!"
                  class="preview-iframe"
                  title="Document preview"
                  sandbox="allow-same-origin"
                ></iframe>
                @if (watermarkEnabled()) {
                  <div class="wm-label-pdf" aria-hidden="true">{{ watermarkLabel() }}</div>
                }
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .header-left { display: flex; align-items: center; gap: 1rem; }
    .header-left h1 { margin: 0; }
    .header-right { display: flex; align-items: center; gap: 0.75rem; }
    .quota-badge { background: #e8e8ff; color: #4040ff; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; }
    .wm-toggle { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: #555; cursor: pointer; user-select: none; }
    .wm-toggle input { cursor: pointer; }
    .btn-primary { padding: 0.5rem 1.5rem; background: #4040ff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { padding: 0.35rem 1rem; border: 1px solid #4040ff; color: #4040ff; background: transparent; border-radius: 4px; cursor: pointer; }
    .btn-danger { padding: 0.35rem 1rem; border: 1px solid #cc0000; color: #cc0000; background: transparent; border-radius: 4px; cursor: pointer; }
    .alert { padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1rem; }
    .alert-success { background: #e8f5e9; color: #2e7d32; }
    .alert-error { background: #ffebee; color: #cc0000; }
    .form-panel { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
    .form-panel h2 { margin-top: 0; }
    .field { margin-bottom: 1rem; }
    .field label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
    .field input, .field select { width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
    .file-info { display: block; margin-top: 0.25rem; font-size: 0.85rem; color: #666; }
    .doc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
    .doc-card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .doc-preview { display: flex; justify-content: center; }
    .preview-icon { width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; border-radius: 8px; font-weight: bold; font-size: 0.85rem; }
    .image-icon { background: #e8f5e9; color: #2e7d32; }
    .pdf-icon { background: #ffebee; color: #cc0000; }
    .doc-info { display: flex; flex-direction: column; gap: 0.25rem; }
    .doc-name { margin: 0; font-size: 1rem; word-break: break-all; }
    .type-badge { display: inline-block; width: fit-content; background: #f0f0f0; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; }
    .doc-size, .doc-date { font-size: 0.85rem; color: #666; }
    .status-badge { display: inline-block; width: fit-content; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; }
    .status-uploaded { background: #e8e8ff; color: #4040ff; }
    .status-reviewed { background: #e8f5e9; color: #2e7d32; }
    .status-rejected { background: #ffebee; color: #cc0000; }
    .status-archived { background: #f0f0f0; color: #666; }
    .doc-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .owner-badge { font-size: 0.78rem; color: #888; font-style: italic; }
    .doctype-badge { display: inline-block; width: fit-content; background: #fff3e0; color: #e65100; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; }
    .btn-review { padding: 0.35rem 1rem; border: 1px solid #1976d2; color: #1976d2; background: transparent; border-radius: 4px; cursor: pointer; }

    /* ── Preview modal ──────────────────────────────────────── */
    .preview-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.75);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000; padding: 1rem;
    }
    .preview-modal {
      background: white; border-radius: 8px; max-width: 90vw; max-height: 90vh;
      width: 900px; display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    .preview-modal-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.75rem 1rem; border-bottom: 1px solid #eee; flex-shrink: 0;
    }
    .preview-filename { font-weight: 600; font-size: 0.95rem; word-break: break-all; }
    .preview-header-right { display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0; }
    .wm-badge { font-size: 0.75rem; color: #888; }
    .close-btn {
      width: 32px; height: 32px; border: none; background: #f5f5f5; border-radius: 50%;
      cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center;
    }
    .close-btn:hover { background: #eee; }
    .preview-body { flex: 1; overflow: auto; min-height: 200px; }
    .preview-loading {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 1rem; padding: 3rem; color: #666;
    }
    .spinner {
      width: 36px; height: 36px; border: 3px solid #eee; border-top-color: #4040ff;
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Image preview */
    .preview-image-wrap { position: relative; display: flex; align-items: center; justify-content: center; padding: 1rem; background: #f9f9f9; }
    .preview-img { max-width: 100%; max-height: 70vh; object-fit: contain; display: block; }
    .wm-label-image {
      position: absolute; bottom: 1rem; right: 1rem;
      font-size: 0.7rem; color: rgba(80,80,80,0.7); font-family: sans-serif;
      pointer-events: none; background: rgba(255,255,255,0.6);
      padding: 0.15rem 0.4rem; border-radius: 3px;
    }

    /* PDF preview */
    .preview-pdf-wrap { position: relative; height: 70vh; }
    .preview-iframe { width: 100%; height: 100%; border: none; display: block; }
    .wm-label-pdf {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 22px; color: rgba(128,128,128,0.25);
      white-space: nowrap; pointer-events: none; z-index: 10;
      font-family: sans-serif; font-weight: 600;
    }
  `]
})
export class DocumentListComponent implements OnInit, OnDestroy {
  private readonly session = inject(SessionService);
  private readonly docService = inject(DocumentService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly fb = inject(FormBuilder);

  documents = signal<TBDoc[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);
  showUploadForm = signal(false);
  uploading = signal(false);
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);
  selectedFile = signal<{ name: string; type: string; size: number; data: ArrayBuffer } | null>(null);
  selectedFileName = signal('');
  selectedFileSize = signal(0);
  quotaUsed = signal(0);

  // Watermark toggle — persisted in component state for the session
  watermarkEnabled = signal(true);

  // Preview state
  previewDoc = signal<TBDoc | null>(null);
  previewLoading = signal(false);
  previewType = signal<'image' | 'pdf' | null>(null);
  previewImgUrl = signal<SafeUrl | null>(null);
  previewPdfUrl = signal<SafeResourceUrl | null>(null);
  previewTimestamp = signal('');
  private _previewBlobUrl: string | null = null;

  watermarkLabel = computed(() => {
    const user = this.session.currentUser();
    return `${user?.displayName ?? 'User'} — ${this.previewTimestamp()}`;
  });

  isHrOrAdmin = computed(() => {
    try {
      const { roles } = this.session.requireAuth();
      return roles.includes(UserRole.HRCoordinator) || roles.includes(UserRole.Administrator);
    } catch { return false; }
  });

  currentUserId = computed(() => {
    try { return this.session.requireAuth().userId; } catch { return ''; }
  });

  pageTitle = computed(() => {
    if (this.isHrOrAdmin()) return 'All Documents';
    try {
      const { roles } = this.session.requireAuth();
      if (roles.includes(UserRole.Employer) || roles.includes(UserRole.Interviewer)) {
        return 'Candidate Documents';
      }
    } catch { /* ignore */ }
    return 'My Documents';
  });

  readonly quotaTotal = DOCUMENT_CONSTANTS.MAX_ACCOUNT_STORAGE_BYTES;

  uploadForm: FormGroup = this.fb.group({
    password: ['', Validators.required],
    applicationId: [''],
  });

  ngOnInit(): void {
    this.loadDocuments();
  }

  ngOnDestroy(): void {
    this._revokeBlobUrl();
  }

  async loadDocuments(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const { userId, organizationId, roles } = this.session.requireAuth();
      const docs = await this.docService.listAuthorized(userId, roles, organizationId);
      this.documents.set(docs);
      // Quota is only meaningful for own documents
      const ownDocs = docs.filter(d => d.ownerUserId === userId);
      this.quotaUsed.set(ownDocs.reduce((sum, d) => sum + d.sizeBytes, 0));
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load documents');
    } finally {
      this.isLoading.set(false);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.selectedFileName.set(file.name);
    this.selectedFileSize.set(file.size);
    const reader = new FileReader();
    reader.onload = () => {
      this.selectedFile.set({
        name: file.name,
        type: file.type,
        size: file.size,
        data: reader.result as ArrayBuffer,
      });
    };
    reader.readAsArrayBuffer(file);
  }

  async onUpload(): Promise<void> {
    const file = this.selectedFile();
    if (!file || this.uploadForm.invalid) return;
    this.uploading.set(true);
    this.actionError.set(null);
    try {
      const { userId, organizationId } = this.session.requireAuth();
      const password = this.uploadForm.value.password;
      const applicationId = this.uploadForm.value.applicationId || null;
      await this.docService.uploadDocument(file, applicationId, userId, organizationId, password);
      this.actionSuccess.set('Document uploaded successfully');
      this.showUploadForm.set(false);
      this.uploadForm.reset();
      this.selectedFile.set(null);
      this.selectedFileName.set('');
      this.selectedFileSize.set(0);
      await this.loadDocuments();
      this.clearMessages();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Upload failed');
      this.clearMessages();
    } finally {
      this.uploading.set(false);
    }
  }

  /** Preview: decrypt → watermark (if enabled) → show in modal. Original file unchanged. */
  async onPreview(doc: TBDoc): Promise<void> {
    const password = prompt('Enter decryption password:');
    if (!password) return;

    this.previewDoc.set(doc);
    this.previewLoading.set(true);
    this.previewTimestamp.set(new Date().toLocaleString());
    this._revokeBlobUrl();

    try {
      const { userId, roles, organizationId } = this.session.requireAuth();
      const result = await this.docService.downloadDocument(doc.id, password, userId, roles, organizationId);

      // Apply watermark to a new in-memory blob — original encrypted file is unchanged
      let blob = result.blob;
      if (this.watermarkEnabled() && this.isImage(result.mimeType)) {
        const userName = this.session.currentUser()?.displayName ?? 'User';
        blob = await watermarkImage(blob, userName, this.previewTimestamp());
      }

      const rawUrl = URL.createObjectURL(blob);
      this._previewBlobUrl = rawUrl;

      if (this.isImage(result.mimeType)) {
        this.previewImgUrl.set(this.sanitizer.bypassSecurityTrustUrl(rawUrl));
        this.previewPdfUrl.set(null);
        this.previewType.set('image');
      } else {
        this.previewPdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(rawUrl));
        this.previewImgUrl.set(null);
        this.previewType.set('pdf');
      }
    } catch (e: any) {
      this.previewDoc.set(null);
      this._revokeBlobUrl();
      this.actionError.set(e.message ?? 'Preview failed');
      this.clearMessages();
    } finally {
      this.previewLoading.set(false);
    }
  }

  closePreview(): void {
    this._revokeBlobUrl();
    this.previewDoc.set(null);
    this.previewImgUrl.set(null);
    this.previewPdfUrl.set(null);
    this.previewType.set(null);
  }

  /** Download: decrypt → watermark (if enabled) → trigger browser download. Original encrypted file unchanged. */
  async onDownload(doc: TBDoc): Promise<void> {
    const password = prompt('Enter decryption password:');
    if (!password) return;
    this.actionError.set(null);
    try {
      const { userId, roles, organizationId } = this.session.requireAuth();
      const result = await this.docService.downloadDocument(doc.id, password, userId, roles, organizationId);
      const userName = this.session.currentUser()?.displayName ?? 'User';
      const ts = new Date().toLocaleString();

      let blob = result.blob;
      let fileName = result.fileName;

      if (this.watermarkEnabled()) {
        if (this.isImage(result.mimeType)) {
          // Image: watermark is pixel-embedded via canvas
          blob = await watermarkImage(blob, userName, ts);
        } else {
          // PDF: create a self-contained HTML page embedding the PDF with a watermark overlay.
          // The downloaded file is an HTML wrapper; the PDF bytes are embedded as a data URI.
          const dataUrl = await this._blobToDataUrl(result.blob);
          const html = this._buildWatermarkedPdfHtml(dataUrl, userName, ts, result.fileName);
          blob = new Blob([html], { type: 'text/html' });
          fileName = result.fileName.replace(/\.[^.]+$/, '') + '_watermarked.html';
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Download failed');
      this.clearMessages();
    }
  }

  private _blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private _buildWatermarkedPdfHtml(dataUrl: string, userName: string, ts: string, originalName: string): string {
    const label = `${userName} — ${ts}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${originalName} (watermarked)</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
    .container { position: relative; width: 100%; height: 100vh; }
    embed { width: 100%; height: 100%; border: none; display: block; }
    .watermark {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 28px; color: rgba(128,128,128,0.35);
      white-space: nowrap; pointer-events: none; z-index: 9999;
      font-family: sans-serif; font-weight: 600; user-select: none;
    }
    .watermark-corner {
      position: fixed; bottom: 12px; right: 16px;
      font-size: 11px; color: rgba(100,100,100,0.55);
      pointer-events: none; z-index: 9999; font-family: sans-serif;
    }
  </style>
</head>
<body>
  <div class="container">
    <embed src="${dataUrl}" type="application/pdf">
    <div class="watermark" aria-hidden="true">${label}</div>
    <div class="watermark-corner" aria-hidden="true">${label}</div>
  </div>
</body>
</html>`;
  }

  async onDelete(doc: TBDoc): Promise<void> {
    if (!confirm(`Delete "${doc.fileName}"? This cannot be undone.`)) return;
    this.actionError.set(null);
    try {
      const { userId, roles, organizationId } = this.session.requireAuth();
      await this.docService.deleteDocument(doc.id, userId, roles, organizationId);
      this.actionSuccess.set('Document deleted');
      await this.loadDocuments();
      this.clearMessages();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Delete failed');
      this.clearMessages();
    }
  }

  async onReview(doc: TBDoc): Promise<void> {
    this.actionError.set(null);
    try {
      const { userId, roles, organizationId } = this.session.requireAuth();
      await this.docService.reviewDocument(doc.id, userId, roles, organizationId);
      this.actionSuccess.set(`Document "${doc.fileName}" marked as reviewed`);
      await this.loadDocuments();
      this.clearMessages();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Review failed');
      this.clearMessages();
    }
  }

  isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private _revokeBlobUrl(): void {
    if (this._previewBlobUrl) {
      URL.revokeObjectURL(this._previewBlobUrl);
      this._previewBlobUrl = null;
    }
  }

  private clearMessages(): void {
    setTimeout(() => {
      this.actionSuccess.set(null);
      this.actionError.set(null);
    }, 3000);
  }
}
