import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SessionService } from '../../../core/services/session.service';
import { IntegrationService } from '../../../core/services/integration.service';
import { IntegrationResponse, WebhookQueueItem, IntegrationSecret } from '../../../core/models';
import { UserRole } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-integration-console',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent, DatePipe],
  template: `
    <div class="page">
      <header class="page-header">
        <h1>Integration Simulator</h1>
      </header>

      <div class="tabs">
        <button [class.active]="activeTab() === 'console'" (click)="activeTab.set('console')">Request Console</button>
        <button [class.active]="activeTab() === 'queue'" (click)="switchToQueue()">Webhook Queue</button>
        @if (isAdmin()) {
          <button [class.active]="activeTab() === 'secrets'" (click)="switchToSecrets()">Secrets</button>
        }
      </div>

      @if (actionSuccess()) {
        <div class="alert alert-success">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error">{{ actionError() }}</div>
      }

      @if (activeTab() === 'console') {
        <div class="form-panel">
          <h2>Send Request</h2>
          <form [formGroup]="requestForm" (ngSubmit)="onSendRequest()">
            <div class="form-row">
              <div class="field field-sm">
                <label for="method">Method</label>
                <select id="method" formControlName="method">
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              <div class="field field-lg">
                <label for="endpoint">Endpoint Path</label>
                <input id="endpoint" formControlName="endpoint" placeholder="/api/resource">
              </div>
            </div>
            <div class="field">
              <label for="integrationKey">Integration Key *</label>
              <input id="integrationKey" formControlName="integrationKey">
              @if (requestForm.get('integrationKey')?.touched && requestForm.get('integrationKey')?.invalid) {
                <span class="field-error">Integration key is required</span>
              }
            </div>
            <div class="field">
              <label for="headers">Headers (JSON)</label>
              <textarea id="headers" formControlName="headers" rows="3" placeholder='{"Content-Type": "application/json"}'></textarea>
            </div>
            <div class="field">
              <label for="body">Body (JSON)</label>
              <textarea id="body" formControlName="body" rows="4" placeholder='{"key": "value"}'></textarea>
            </div>
            <div class="form-row">
              <div class="field">
                <label for="idempotencyKey">Idempotency Key</label>
                <input id="idempotencyKey" formControlName="idempotencyKey">
              </div>
              <div class="field">
                <label for="hmacSignature">HMAC Signature</label>
                <input id="hmacSignature" formControlName="hmacSignature">
              </div>
              <div class="field field-sm">
                <label for="secretVersion">Secret Version</label>
                <input id="secretVersion" formControlName="secretVersion" type="number">
              </div>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-primary" [disabled]="requestForm.invalid || isSending()">
                {{ isSending() ? 'Sending...' : 'Send Request' }}
              </button>
            </div>
          </form>
        </div>

        @if (response()) {
          <div class="response-panel">
            <h2>Response</h2>
            <div class="response-status" [attr.data-ok]="response()!.status < 400">
              Status: {{ response()!.status }}
            </div>
            <div class="response-section">
              <h3>Headers</h3>
              <pre class="code-block">{{ formatJson(response()!.headers) }}</pre>
            </div>
            <div class="response-section">
              <h3>Body</h3>
              <pre class="code-block">{{ response()!.body }}</pre>
            </div>
          </div>
        }
      }

      @if (activeTab() === 'queue') {
        <div class="form-panel">
          <h2>Enqueue Webhook</h2>
          <form [formGroup]="enqueueForm" (ngSubmit)="onEnqueueWebhook()">
            <div class="form-row">
              <div class="field field-lg">
                <label for="targetName">Target Name *</label>
                <input id="targetName" formControlName="targetName" placeholder="e.g. crm-hook">
              </div>
              <div class="field field-lg">
                <label for="payload">Payload (JSON) *</label>
                <input id="payload" formControlName="payload" placeholder='{"event":"test"}'>
              </div>
              <div class="form-actions" style="align-items:flex-end; padding-bottom:1rem; gap:0.5rem;">
                <button type="submit" class="btn-primary" [disabled]="enqueueForm.invalid || isEnqueuing()">
                  {{ isEnqueuing() ? 'Enqueuing...' : 'Enqueue' }}
                </button>
                <button type="button" class="btn-secondary" (click)="onProcessRetries()" [disabled]="isProcessingRetries()">
                  {{ isProcessingRetries() ? 'Processing...' : 'Process Retries' }}
                </button>
              </div>
            </div>
          </form>
        </div>

        @if (isLoading()) {
          <app-loading-state message="Loading webhook queue..." />
        } @else if (error()) {
          <app-error-state [message]="error()!" [retryFn]="loadWebhookQueue.bind(this)" />
        } @else if (webhookQueue().length === 0) {
          <app-empty-state message="No webhook items in the queue" />
        } @else {
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Payload</th>
                  <th>Status</th>
                  <th>Retries</th>
                  <th>Next Retry</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                @for (item of webhookQueue(); track item.id) {
                  <tr>
                    <td>{{ item.targetName }}</td>
                    <td class="payload-cell" [title]="item.payload">{{ truncate(item.payload, 60) }}</td>
                    <td><span class="status-badge" [attr.data-status]="item.status">{{ item.status }}</span></td>
                    <td>{{ item.retryCount }}</td>
                    <td>{{ item.nextRetryAt | date:'short' }}</td>
                    <td>{{ item.createdAt | date:'short' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      @if (activeTab() === 'secrets' && isAdmin()) {
        <div class="form-panel">
          <h2>Create Secret</h2>
          <form [formGroup]="secretForm" (ngSubmit)="onCreateSecret()">
            <div class="form-row">
              <div class="field field-lg">
                <label for="secretIntegrationKey">Integration Key *</label>
                <input id="secretIntegrationKey" formControlName="integrationKey" placeholder="e.g. my-service-key">
                @if (secretForm.get('integrationKey')?.touched && secretForm.get('integrationKey')?.invalid) {
                  <span class="field-error">Integration key is required</span>
                }
              </div>
              <div class="form-actions" style="align-items:flex-end; padding-bottom:1rem;">
                <button type="submit" class="btn-primary" [disabled]="secretForm.invalid || isSecretLoading()">
                  {{ isSecretLoading() ? 'Creating...' : 'Create Secret' }}
                </button>
              </div>
            </div>
          </form>
        </div>

        @if (secretsLoadError()) {
          <app-error-state [message]="secretsLoadError()!" [retryFn]="loadSecrets.bind(this)" />
        } @else if (secrets().length === 0) {
          <app-empty-state message="No secrets configured" />
        } @else {
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Integration Key</th>
                  <th>Version</th>
                  <th>Active Since</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (s of secrets(); track s.id) {
                  <tr>
                    <td><code>{{ s.integrationKey }}</code></td>
                    <td>v{{ s.version }}</td>
                    <td>{{ s.activatedAt | date:'short' }}</td>
                    <td>
                      <span class="status-badge" [attr.data-status]="s.deactivatedAt ? 'deactivated' : 'active'">
                        {{ s.deactivatedAt ? 'deactivated' : 'active' }}
                      </span>
                    </td>
                    <td class="actions-cell">
                      @if (!s.deactivatedAt) {
                        <button class="btn-sm btn-secondary" (click)="onRotateSecret(s)" [disabled]="isSecretLoading()">Rotate</button>
                        <button class="btn-sm btn-danger" (click)="onDeactivateSecret(s)" [disabled]="isSecretLoading()">Deactivate</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .page { max-width: 1200px; }
    .page-header { margin-bottom: 1.5rem; }
    .page-header h1 { margin: 0; }
    .tabs { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
    .tabs button { padding: 0.5rem 1rem; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; }
    .tabs button.active { background: #4040ff; color: white; border-color: #4040ff; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
    .alert-success { background: #e8ffe8; color: #008000; border: 1px solid #b0e0b0; }
    .alert-error { background: #ffe8e8; color: #cc0000; border: 1px solid #e0b0b0; }
    .form-panel {
      background: white; padding: 1.5rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-bottom: 1.5rem;
    }
    .form-panel h2 { margin: 0 0 1rem; font-size: 1.1rem; }
    .form-row { display: flex; gap: 1rem; }
    .field { margin-bottom: 1rem; flex: 1; }
    .field-sm { flex: 0 0 140px; }
    .field-lg { flex: 2; }
    .field label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.9rem; }
    .field input, .field textarea, .field select {
      width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;
      font-size: 0.9rem; box-sizing: border-box; font-family: inherit;
    }
    .field-error { color: #cc0000; font-size: 0.8rem; }
    .form-actions { display: flex; gap: 0.5rem; }
    .btn-primary {
      padding: 0.5rem 1.25rem; background: #4040ff; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .response-panel {
      background: white; padding: 1.5rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-bottom: 1.5rem;
    }
    .response-panel h2 { margin: 0 0 1rem; font-size: 1.1rem; }
    .response-panel h3 { margin: 0.75rem 0 0.25rem; font-size: 0.95rem; color: #555; }
    .response-status { font-weight: 600; font-size: 1rem; margin-bottom: 0.5rem; }
    .response-status[data-ok="true"] { color: #008000; }
    .response-status[data-ok="false"] { color: #cc0000; }
    .code-block {
      background: #f5f5f5; padding: 0.75rem; border-radius: 4px; font-size: 0.85rem;
      overflow-x: auto; white-space: pre-wrap; word-break: break-word; margin: 0;
    }
    .table-container { overflow-x: auto; }
    .data-table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
    .data-table th, .data-table td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid #eee; font-size: 0.875rem; }
    .data-table th { background: #f8f8f8; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; color: #666; }
    .payload-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 0.8rem; }
    .status-badge {
      padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem;
      font-weight: 600; text-transform: capitalize; display: inline-block;
    }
    .status-badge[data-status="pending"] { background: #e0e8ff; color: #2040cc; }
    .status-badge[data-status="processing"] { background: #fff8e0; color: #b08000; }
    .status-badge[data-status="delivered"] { background: #e8ffe8; color: #008000; }
    .status-badge[data-status="failed"] { background: #ffe8e8; color: #cc0000; }
    .status-badge[data-status="active"] { background: #e8ffe8; color: #008000; }
    .status-badge[data-status="deactivated"] { background: #f0f0f0; color: #888; }
    .actions-cell { display: flex; gap: 0.4rem; }
    .btn-sm { padding: 0.25rem 0.65rem; font-size: 0.8rem; border-radius: 4px; cursor: pointer; border: none; }
    .btn-secondary {
      padding: 0.5rem 1.25rem; background: white; color: #333;
      border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-sm.btn-secondary { background: white; color: #333; border: 1px solid #ddd; }
    .btn-sm.btn-danger { background: #cc0000; color: white; }
    .btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }
  `]
})
export class IntegrationConsoleComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly integrationSvc = inject(IntegrationService);
  private readonly fb = inject(FormBuilder);

  activeTab = signal<string>('console');
  isLoading = signal(false);
  isSending = signal(false);
  isEnqueuing = signal(false);
  isProcessingRetries = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);
  response = signal<IntegrationResponse | null>(null);
  webhookQueue = signal<WebhookQueueItem[]>([]);

  // Secrets tab
  secrets = signal<IntegrationSecret[]>([]);
  isSecretLoading = signal(false);
  secretsLoadError = signal<string | null>(null);

  requestForm: FormGroup = this.fb.group({
    method: ['GET'],
    endpoint: [''],
    integrationKey: ['', Validators.required],
    headers: ['{}'],
    body: [''],
    idempotencyKey: [''],
    hmacSignature: [''],
    secretVersion: [null],
  });

  secretForm: FormGroup = this.fb.group({
    integrationKey: ['', Validators.required],
  });

  enqueueForm: FormGroup = this.fb.group({
    targetName: ['', Validators.required],
    payload: ['', Validators.required],
  });

  isAdmin(): boolean {
    try {
      return this.session.requireAuth().roles.includes(UserRole.Administrator);
    } catch {
      return false;
    }
  }

  ngOnInit(): void {
    this.loadWebhookQueue();
  }

  switchToQueue(): void {
    this.activeTab.set('queue');
    this.loadWebhookQueue();
  }

  switchToSecrets(): void {
    this.activeTab.set('secrets');
    this.loadSecrets();
  }

  async loadSecrets(): Promise<void> {
    this.secretsLoadError.set(null);
    try {
      const ctx = this.session.requireAuth();
      const list = await this.integrationSvc.listSecrets(ctx.userId, ctx.roles, ctx.organizationId);
      this.secrets.set(list);
    } catch (e: any) {
      this.secretsLoadError.set(e.message ?? 'Failed to load secrets');
    }
  }

  async onCreateSecret(): Promise<void> {
    if (this.secretForm.invalid) return;
    this.clearMessages();
    this.isSecretLoading.set(true);
    try {
      const ctx = this.session.requireAuth();
      const { integrationKey } = this.secretForm.value;
      await this.integrationSvc.createSecret(integrationKey, ctx.userId, ctx.roles, ctx.organizationId);
      this.secretForm.reset();
      this.actionSuccess.set('Secret created successfully');
      this.autoClearMessages();
      await this.loadSecrets();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to create secret');
      this.autoClearMessages();
    } finally {
      this.isSecretLoading.set(false);
    }
  }

  async onRotateSecret(secret: IntegrationSecret): Promise<void> {
    this.clearMessages();
    this.isSecretLoading.set(true);
    try {
      const ctx = this.session.requireAuth();
      await this.integrationSvc.rotateSecret(secret.id, ctx.userId, ctx.roles, ctx.organizationId);
      this.actionSuccess.set('Secret rotated — previous version deactivated');
      this.autoClearMessages();
      await this.loadSecrets();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to rotate secret');
      this.autoClearMessages();
    } finally {
      this.isSecretLoading.set(false);
    }
  }

  async onDeactivateSecret(secret: IntegrationSecret): Promise<void> {
    this.clearMessages();
    this.isSecretLoading.set(true);
    try {
      const ctx = this.session.requireAuth();
      await this.integrationSvc.deactivateSecret(secret.id, ctx.userId, ctx.roles, ctx.organizationId);
      this.actionSuccess.set('Secret deactivated');
      this.autoClearMessages();
      await this.loadSecrets();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to deactivate secret');
      this.autoClearMessages();
    } finally {
      this.isSecretLoading.set(false);
    }
  }

  async onEnqueueWebhook(): Promise<void> {
    if (this.enqueueForm.invalid) return;
    this.isEnqueuing.set(true);
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const { targetName, payload } = this.enqueueForm.value;
      await this.integrationSvc.enqueueWebhook(targetName.trim(), payload.trim(), ctx.organizationId);
      this.enqueueForm.reset();
      this.actionSuccess.set('Webhook enqueued successfully');
      this.autoClearMessages();
      await this.loadWebhookQueue();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to enqueue webhook');
      this.autoClearMessages();
    } finally {
      this.isEnqueuing.set(false);
    }
  }

  async onProcessRetries(): Promise<void> {
    this.isProcessingRetries.set(true);
    this.clearMessages();
    try {
      await this.integrationSvc.processWebhookRetries();
      this.actionSuccess.set('Retry pass complete');
      this.autoClearMessages();
      await this.loadWebhookQueue();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to process retries');
      this.autoClearMessages();
    } finally {
      this.isProcessingRetries.set(false);
    }
  }

  async loadWebhookQueue(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const ctx = this.session.requireAuth();
      const queue = await this.integrationSvc.getWebhookQueue(ctx.roles, ctx.organizationId);
      this.webhookQueue.set(queue);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load webhook queue');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onSendRequest(): Promise<void> {
    if (this.requestForm.invalid) return;
    this.clearMessages();
    this.isSending.set(true);
    this.response.set(null);
    try {
      const ctx = this.session.requireAuth();
      const { method, endpoint, integrationKey, headers, body, idempotencyKey, hmacSignature, secretVersion } = this.requestForm.value;

      let parsedHeaders: Record<string, string> = {};
      if (headers && headers.trim()) {
        parsedHeaders = JSON.parse(headers);
      }

      const parsedBody = body && body.trim() ? body : null;
      const parsedIdempotencyKey = idempotencyKey && idempotencyKey.trim() ? idempotencyKey.trim() : null;
      const parsedSignature = hmacSignature && hmacSignature.trim() ? hmacSignature.trim() : null;
      const parsedSecretVersion = secretVersion != null && secretVersion !== '' ? Number(secretVersion) : null;

      const result = await this.integrationSvc.processRequest(
        method,
        endpoint,
        parsedHeaders,
        parsedBody,
        parsedIdempotencyKey,
        parsedSignature,
        parsedSecretVersion,
        integrationKey,
        ctx.userId,
        ctx.roles,
        ctx.organizationId,
      );
      this.response.set(result);
      this.actionSuccess.set('Request sent successfully');
      this.autoClearMessages();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to send request');
      this.autoClearMessages();
    } finally {
      this.isSending.set(false);
    }
  }

  truncate(text: string, maxLen: number): string {
    return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
  }

  formatJson(obj: Record<string, string>): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  private clearMessages(): void {
    this.actionError.set(null);
    this.actionSuccess.set(null);
  }

  private autoClearMessages(): void {
    setTimeout(() => {
      this.actionError.set(null);
      this.actionSuccess.set(null);
    }, 3000);
  }
}
