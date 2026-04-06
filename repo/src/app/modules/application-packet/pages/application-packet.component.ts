import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SessionService } from '../../../core/services/session.service';
import { ApplicationPacketService } from '../../../core/services/application-packet.service';
import { DocumentService } from '../../../core/services/document.service';
import { ApplicationPacket, PacketSection, Document as TBDoc } from '../../../core/models';
import { PacketStatus } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-application-packet',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent],
  template: `
    <div class="page">
      <h1>Application Packet</h1>

      <div class="wizard-steps">
        <div class="step" [class.active]="currentStep() === 0" [class.complete]="currentStep() > 0" (click)="goToStep(0)">1. Personal Info</div>
        <div class="step" [class.active]="currentStep() === 1" [class.complete]="currentStep() > 1" (click)="goToStep(1)">2. Documents</div>
        <div class="step" [class.active]="currentStep() === 2" (click)="goToStep(2)">3. Review &amp; Submit</div>
      </div>

      @if (actionSuccess()) {
        <div class="alert alert-success">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error">{{ actionError() }}</div>
      }

      @if (isLoading()) {
        <app-loading-state message="Loading packet..." />
      } @else if (error()) {
        <app-error-state [message]="error()!" [retryFn]="loadPacket.bind(this)" />
      } @else if (packet()) {
        <div class="packet-status">
          Status: <span class="status-badge" [attr.data-status]="packet()!.status">{{ packet()!.status }}</span>
        </div>

        @if (currentStep() === 0) {
          <div class="form-panel">
            <h2>Personal Information</h2>
            <form [formGroup]="personalForm">
              <div class="field">
                <label for="fullName">Full Name *</label>
                <input id="fullName" formControlName="fullName">
              </div>
              <div class="field">
                <label for="email">Contact Email *</label>
                <input id="email" formControlName="email" type="email">
              </div>
              <div class="field">
                <label for="phone">Phone</label>
                <input id="phone" formControlName="phone">
              </div>
              <div class="field">
                <label for="address">Address</label>
                <textarea id="address" formControlName="address" rows="2"></textarea>
              </div>
              <div class="form-actions">
                <button class="btn-primary" (click)="savePersonalInfo()" [disabled]="personalForm.invalid || isReadOnly()">Save &amp; Continue</button>
              </div>
            </form>
          </div>
        }

        @if (currentStep() === 1) {
          <div class="form-panel">
            <h2>Documents</h2>
            <p class="hint">Upload your documents below. A <strong>Resume / CV</strong> is required before you can submit. Cover Letter and Transcript are optional.</p>

            @if (!isReadOnly()) {
              <div class="upload-section">
                <h3 class="upload-heading">Upload a Document</h3>

                <div class="field">
                  <label for="docLabel">Document Type</label>
                  <select id="docLabel" [value]="docLabel()" (change)="docLabel.set($any($event.target).value)" class="field-select">
                    <option value="Resume / CV">Resume / CV (Required)</option>
                    <option value="Cover Letter">Cover Letter</option>
                    <option value="Transcript">Transcript</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div class="field">
                  <label for="docFile">File <span class="required-star">*</span></label>
                  <input
                    id="docFile"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
                    (change)="onFileSelected($event)"
                    class="file-input"
                  >
                  @if (docUploadFile()) {
                    <span class="file-chosen">{{ docUploadFile()!.name }} ({{ formatBytes(docUploadFile()!.size) }})</span>
                  }
                </div>

                <div class="field">
                  <label for="docPassword">Encryption Password <span class="required-star">*</span></label>
                  <input
                    id="docPassword"
                    type="password"
                    placeholder="Password used to encrypt this document"
                    [value]="docPassword()"
                    (input)="docPassword.set($any($event.target).value)"
                    autocomplete="new-password"
                  >
                  <span class="field-hint">You will need this password to decrypt and download the file later.</span>
                </div>

                <div class="form-actions">
                  <button
                    class="btn-primary"
                    (click)="uploadDocument()"
                    [disabled]="!docUploadFile() || !docPassword() || uploadingDoc() || isReadOnly()"
                  >
                    @if (uploadingDoc()) { Uploading... } @else { Upload Document }
                  </button>
                </div>

                @if (uploadError()) {
                  <div class="alert alert-error" style="margin-top:0.75rem">{{ uploadError() }}</div>
                }
              </div>
            }

            <div class="uploaded-docs-section">
              <h3 class="upload-heading">Uploaded Documents</h3>
              @if (docsLoading()) {
                <p class="hint">Loading documents...</p>
              } @else if (uploadedDocs().length === 0) {
                <p class="hint no-docs-msg">No documents uploaded yet. Upload your Resume / CV to proceed.</p>
              } @else {
                <table class="docs-table">
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>Size</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (doc of uploadedDocs(); track doc.id) {
                      @if (doc.applicationId === applicationId()) {
                        <tr>
                          <td class="doc-filename">{{ doc.fileName }}</td>
                          <td>{{ formatBytes(doc.sizeBytes) }}</td>
                          <td><span class="doc-status" [attr.data-status]="doc.status">{{ doc.status }}</span></td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              }
            </div>

            <div class="form-actions" style="margin-top:1.5rem">
              <button class="btn-secondary" (click)="goToStep(0)">Back</button>
              <button class="btn-primary" (click)="saveDocChecklist()" [disabled]="isReadOnly()">Save &amp; Continue</button>
            </div>
          </div>
        }

        @if (currentStep() === 2) {
          <div class="form-panel">
            <h2>Review &amp; Submit</h2>

            <div class="review-section">
              <h3>Personal Info</h3>
              <div class="review-row"><span class="label">Name:</span> {{ getSection('personal_info')?.payload?.['fullName'] || 'Not provided' }}</div>
              <div class="review-row"><span class="label">Email:</span> {{ getSection('personal_info')?.payload?.['email'] || 'Not provided' }}</div>
              <div class="review-row"><span class="label">Phone:</span> {{ getSection('personal_info')?.payload?.['phone'] || 'N/A' }}</div>
            </div>

            <div class="review-section">
              <h3>Documents</h3>
              @if (docsLoading()) {
                <p class="hint">Loading documents...</p>
              } @else if (uploadedDocs().length === 0) {
                <div class="alert alert-error no-docs-review-error">
                  No documents uploaded. Please go back to step 2 and upload your Resume / CV before submitting.
                </div>
              } @else {
                <table class="docs-table">
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>Size</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (doc of uploadedDocs(); track doc.id) {
                      @if (doc.applicationId === applicationId()) {
                        <tr>
                          <td class="doc-filename">{{ doc.fileName }}</td>
                          <td>{{ formatBytes(doc.sizeBytes) }}</td>
                          <td><span class="doc-status" [attr.data-status]="doc.status">{{ doc.status }}</span></td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              }
            </div>

            <div class="form-actions">
              <button class="btn-secondary" (click)="goToStep(1)">Back</button>
              @if (canSubmit()) {
                <button class="btn-primary" (click)="onSubmitPacket()" [disabled]="!hasRequiredDocs()">
                  Submit Packet
                </button>
              }
              @if (canSubmit() && !hasRequiredDocs()) {
                <span class="submit-block-hint">A Resume / CV must be uploaded before submitting.</span>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .page { max-width: 800px; }
    .wizard-steps { display: flex; gap: 1rem; margin-bottom: 2rem; }
    .step {
      padding: 0.75rem 1.5rem; background: #e8e8f0; border-radius: 4px;
      font-size: 0.9rem; cursor: pointer; transition: background 0.2s;
    }
    .step.active { background: #4040ff; color: white; }
    .step.complete { background: #c0c0ff; color: #333; }
    .packet-status { margin-bottom: 1rem; font-size: 0.9rem; }
    .status-badge {
      padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem;
      font-weight: 600; text-transform: capitalize;
    }
    .status-badge[data-status="draft"] { background: #e8e8e8; color: #666; }
    .status-badge[data-status="in_progress"] { background: #e0e0ff; color: #4040ff; }
    .status-badge[data-status="submitted"] { background: #e8ffe8; color: #008000; }
    .status-badge[data-status="reopened"] { background: #fff3e0; color: #e65100; }
    .status-badge[data-status="locked"] { background: #f0f0f0; color: #999; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
    .alert-success { background: #e8ffe8; color: #008000; border: 1px solid #b0e0b0; }
    .alert-error { background: #ffe8e8; color: #cc0000; border: 1px solid #e0b0b0; }
    .form-panel {
      background: white; padding: 1.5rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-bottom: 1.5rem;
    }
    .form-panel h2 { margin: 0 0 1rem; font-size: 1.1rem; }
    .hint { color: #666; font-size: 0.85rem; margin-bottom: 1rem; }
    .field { margin-bottom: 1rem; }
    .field label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.9rem; }
    .field input, .field textarea, .field-select {
      width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;
      font-size: 0.9rem; box-sizing: border-box; font-family: inherit;
    }
    .file-input { padding: 0.3rem 0; border: none; }
    .file-chosen { display: block; font-size: 0.8rem; color: #555; margin-top: 0.25rem; }
    .field-hint { display: block; font-size: 0.78rem; color: #888; margin-top: 0.2rem; font-weight: 400; }
    .required-star { color: #cc0000; }
    .upload-section {
      background: #f8f8ff; border: 1px solid #e0e0ff;
      border-radius: 6px; padding: 1rem 1.25rem; margin-bottom: 1.5rem;
    }
    .upload-heading { margin: 0 0 0.75rem; font-size: 0.95rem; color: #333; }
    .uploaded-docs-section { margin-top: 0.5rem; }
    .no-docs-msg { font-style: italic; }
    .no-docs-review-error { margin-bottom: 0; }
    .docs-table {
      width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-top: 0.5rem;
    }
    .docs-table th {
      text-align: left; padding: 0.4rem 0.6rem;
      border-bottom: 2px solid #e0e0ff; font-size: 0.8rem; color: #555;
    }
    .docs-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #f0f0f0; }
    .doc-filename { word-break: break-all; }
    .doc-status {
      padding: 0.15rem 0.5rem; border-radius: 10px; font-size: 0.75rem;
      font-weight: 600; text-transform: capitalize; background: #e8e8e8; color: #555;
    }
    .doc-status[data-status="uploaded"] { background: #e0e0ff; color: #4040ff; }
    .doc-status[data-status="reviewed"] { background: #e8ffe8; color: #008000; }
    .doc-status[data-status="rejected"] { background: #ffe8e8; color: #cc0000; }
    .form-actions { display: flex; gap: 0.5rem; align-items: center; }
    .submit-block-hint { font-size: 0.82rem; color: #cc0000; margin-left: 0.25rem; }
    .review-section {
      padding: 1rem; background: #f8f8ff; border-radius: 6px;
      border: 1px solid #e0e0ff; margin-bottom: 1rem;
    }
    .review-section h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
    .review-row { padding: 0.25rem 0; font-size: 0.9rem; }
    .review-row .label { font-weight: 600; }
    .btn-primary {
      padding: 0.5rem 1.25rem; background: #4040ff; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      padding: 0.5rem 1.25rem; background: white; color: #333;
      border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
  `]
})
export class ApplicationPacketComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly packetSvc = inject(ApplicationPacketService);
  private readonly documentSvc = inject(DocumentService);
  private readonly fb = inject(FormBuilder);

  packet = signal<ApplicationPacket | null>(null);
  sections = signal<PacketSection[]>([]);
  currentStep = signal(0);
  isLoading = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);

  // Document upload signals
  uploadedDocs = signal<TBDoc[]>([]);
  uploadingDoc = signal(false);
  docsLoading = signal(false);
  docUploadFile = signal<{ name: string; type: string; size: number; data: ArrayBuffer } | null>(null);
  docPassword = signal('');
  docLabel = signal('Resume / CV');
  uploadError = signal<string | null>(null);
  applicationId = signal<string | null>(null);

  personalForm = this.fb.group({
    fullName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    address: [''],
  });

  ngOnInit(): void {
    this.applicationId.set(this.route.snapshot.paramMap.get('applicationId'));
    this.loadPacket();
  }

  isReadOnly(): boolean {
    const p = this.packet();
    if (!p) return true;
    return p.status === PacketStatus.Submitted || p.status === PacketStatus.Locked;
  }

  hasRequiredDocs(): boolean {
    const appId = this.applicationId();
    return this.uploadedDocs().some(d => d.applicationId === appId && d.documentType === 'Resume / CV');
  }

  canSubmit(): boolean {
    const p = this.packet();
    if (!p) return false;
    return p.status === PacketStatus.InProgress || p.status === PacketStatus.Reopened;
  }

  getSection(key: string): PacketSection | undefined {
    return this.sections().find(s => s.sectionKey === key);
  }

  goToStep(step: number): void {
    this.currentStep.set(step);
    // Refresh the doc list when navigating to the documents or review step
    if (step === 1 || step === 2) {
      this.loadUploadedDocs();
    }
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async loadPacket(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const ctx = this.session.requireAuth();
      const applicationId = this.applicationId() ?? this.route.snapshot.paramMap.get('applicationId')!;
      const packet = await this.packetSvc.getOrCreatePacket(applicationId, ctx.userId, ctx.organizationId);
      this.packet.set(packet);

      // Load sections
      const { sections } = await this.packetSvc.getPacketWithSections(packet.id, ctx.userId, ctx.roles, ctx.organizationId);
      this.sections.set(sections);

      // Populate personal info form from existing section
      const personalSection = sections.find(s => s.sectionKey === 'personal_info');
      if (personalSection) {
        this.personalForm.patchValue(personalSection.payload as Record<string, string>);
      }

      // Load uploaded documents for this application
      await this.loadUploadedDocs();
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load packet');
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadUploadedDocs(): Promise<void> {
    this.docsLoading.set(true);
    try {
      const ctx = this.session.requireAuth();
      const docs = await this.documentSvc.listByOwner(ctx.userId, ctx.userId, ctx.roles, ctx.organizationId);
      // Filter to only documents belonging to this application
      const appId = this.applicationId();
      this.uploadedDocs.set(appId ? docs.filter(d => d.applicationId === appId) : []);
    } catch {
      // Non-fatal: silently leave the list empty; the upload section remains functional
    } finally {
      this.docsLoading.set(false);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      this.docUploadFile.set(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.docUploadFile.set({
        name: file.name,
        type: file.type,
        size: file.size,
        data: reader.result as ArrayBuffer,
      });
    };
    reader.readAsArrayBuffer(file);
  }

  async uploadDocument(): Promise<void> {
    const file = this.docUploadFile();
    const password = this.docPassword();
    if (!file || !password || this.uploadingDoc() || this.isReadOnly()) return;

    this.uploadingDoc.set(true);
    this.uploadError.set(null);
    try {
      const ctx = this.session.requireAuth();
      const appId = this.applicationId();
      await this.documentSvc.uploadDocument(file, appId, ctx.userId, ctx.organizationId, password, this.docLabel());
      // Reset upload form
      this.docUploadFile.set(null);
      this.docPassword.set('');
      this.docLabel.set('Resume / CV');
      // Reset the file input element in the DOM
      const fileInput = document.getElementById('docFile') as HTMLInputElement | null;
      if (fileInput) fileInput.value = '';
      // Reload doc list
      await this.loadUploadedDocs();
      this.showSuccess('Document uploaded successfully');
    } catch (e: any) {
      this.uploadError.set(e.message ?? 'Upload failed');
    } finally {
      this.uploadingDoc.set(false);
    }
  }

  async savePersonalInfo(): Promise<void> {
    if (this.personalForm.invalid || this.isReadOnly()) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const p = this.packet()!;
      const payload = this.personalForm.value as Record<string, unknown>;
      await this.packetSvc.updateSection(p.id, 'personal_info', payload, ctx.userId, ctx.organizationId);
      // Reload to get updated packet status
      await this.loadPacket();
      this.currentStep.set(1);
      this.showSuccess('Personal info saved');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to save');
      this.autoClearMessages();
    }
  }

  async saveDocChecklist(): Promise<void> {
    if (this.isReadOnly()) return;
    this.clearMessages();
    // The document data is the actual uploaded doc list — just advance to review
    await this.loadUploadedDocs();
    this.currentStep.set(2);
  }

  async onSubmitPacket(): Promise<void> {
    const p = this.packet();
    if (!p || !this.canSubmit()) return;
    if (!this.hasRequiredDocs()) {
      this.actionError.set('Please upload at least one document (Resume / CV required) before submitting.');
      this.autoClearMessages();
      return;
    }
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const updated = await this.packetSvc.transitionStatus(
        p.id, PacketStatus.Submitted, ctx.userId, ctx.roles, ctx.organizationId, p.version,
      );
      this.packet.set(updated);
      this.showSuccess('Packet submitted successfully');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to submit packet');
      this.autoClearMessages();
    }
  }

  private clearMessages(): void {
    this.actionError.set(null);
    this.actionSuccess.set(null);
  }

  private showSuccess(msg: string): void {
    this.actionSuccess.set(msg);
    this.autoClearMessages();
  }

  private autoClearMessages(): void {
    setTimeout(() => {
      this.actionError.set(null);
      this.actionSuccess.set(null);
    }, 3000);
  }
}
