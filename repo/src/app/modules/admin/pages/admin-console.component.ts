import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { SessionService } from '../../../core/services/session.service';
import { UserService } from '../../../core/services/user.service';
import { ImportExportService } from '../../../core/services/import-export.service';
import { ModerationService } from '../../../core/services/moderation.service';
import { User, SensitiveWord } from '../../../core/models';
import { ImportStrategy, UserRole } from '../../../core/enums';
import { maskEmail } from '../../../core/utils/masking';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-admin-console',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent, DatePipe],
  template: `
    <div class="page">
      <header class="page-header">
        <h1>Admin Console</h1>
      </header>

      <div class="tabs">
        <button [class.active]="activeTab() === 'users'" (click)="switchTab('users')">Users</button>
        <button [class.active]="activeTab() === 'import'" (click)="activeTab.set('import')">Import/Export</button>
        @if (isAdmin()) {
          <button [class.active]="activeTab() === 'blocklist'" (click)="switchTab('blocklist')">Blocklist</button>
        }
      </div>

      @if (actionSuccess()) {
        <div class="alert alert-success">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error">{{ actionError() }}</div>
      }

      @if (activeTab() === 'users') {
        @if (isLoading()) {
          <app-loading-state message="Loading users..." />
        } @else if (error()) {
          <app-error-state [message]="error()!" [retryFn]="loadUsers.bind(this)" />
        } @else if (users().length === 0) {
          <app-empty-state message="No users found" />
        } @else {
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Display Name</th>
                  <th>Username</th>
                  <th>Roles</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (user of users(); track user.id) {
                  <tr [class.deactivated]="user.deactivatedAt">
                    <td>{{ user.displayName }}</td>
                    <td class="mono">{{ maskedUsername(user.username!) }}</td>
                    <td>
                      @for (role of user.roles; track role) {
                        <span class="role-badge">{{ role }}</span>
                      }
                    </td>
                    <td>{{ user.createdAt | date:'short' }}</td>
                    <td class="action-cell">
                      @if (!user.deactivatedAt) {
                        <select class="role-select" (change)="onRoleChange(user, $event)">
                          <option value="">Change Role...</option>
                          <option value="candidate">Candidate</option>
                          <option value="employer">Employer</option>
                          <option value="hr_coordinator">HR Coordinator</option>
                          <option value="interviewer">Interviewer</option>
                          <option value="administrator">Administrator</option>
                        </select>
                        <button class="btn-sm btn-danger" (click)="onDeactivate(user)">Deactivate</button>
                      } @else {
                        <span class="deactivated-label">Deactivated</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      @if (activeTab() === 'import') {
        <div class="form-panel">
          <h2>Export Data</h2>
          <div class="form-row">
            <div class="field">
              <label for="exportEntity">Entity Type</label>
              <select id="exportEntity" [formControl]="exportEntityType">
                <option value="jobs">Jobs</option>
                <option value="applications">Applications</option>
                <option value="interviews">Interviews</option>
                <option value="contentPosts">Content Posts</option>
              </select>
            </div>
          </div>
          <div class="form-actions">
            <button class="btn-primary" (click)="onExportJson()" [disabled]="isExporting()">Export JSON</button>
            <button class="btn-secondary" (click)="onExportCsv()" [disabled]="isExporting()">Export CSV</button>
          </div>
        </div>

        <div class="form-panel">
          <h2>Import Data</h2>
          <div class="form-row">
            <div class="field">
              <label for="importEntity">Entity Type</label>
              <select id="importEntity" [formControl]="importEntityType">
                <option value="jobs">Jobs</option>
                <option value="applications">Applications</option>
                <option value="interviews">Interviews</option>
                <option value="contentPosts">Content Posts</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label for="importFile">JSON or CSV File</label>
            <input id="importFile" type="file" accept=".json,.csv" (change)="onFileSelected($event)">
          </div>
          <div class="form-actions">
            <button class="btn-primary" (click)="onPreviewImport()" [disabled]="!importFileData() || isImporting()">Preview Import</button>
          </div>

          @if (importPreview()) {
            <div class="preview-panel">
              <h3>Import Preview</h3>
              <div class="preview-stats">
                <div class="stat"><span class="stat-label">Total:</span> {{ importPreview()!.total }}</div>
                <div class="stat"><span class="stat-label">New:</span> {{ importPreview()!.newCount }}</div>
                <div class="stat"><span class="stat-label">Existing:</span> {{ importPreview()!.existingCount }}</div>
              </div>
              @if (importPreview()!.conflicts.length > 0) {
                <div class="conflicts">
                  <h4>Conflicts</h4>
                  <ul>
                    @for (conflict of importPreview()!.conflicts; track conflict) {
                      <li class="conflict-item">{{ conflict }}</li>
                    }
                  </ul>
                </div>
              }
              <div class="form-row">
                <div class="field">
                  <label for="strategy">Import Strategy</label>
                  <select id="strategy" [formControl]="importStrategy">
                    <option [value]="strategies.Skip">Skip</option>
                    <option [value]="strategies.Merge">Merge</option>
                    <option [value]="strategies.Overwrite">Overwrite</option>
                  </select>
                </div>
              </div>
              <div class="form-actions">
                <button class="btn-primary" (click)="onApplyImport()" [disabled]="isImporting()">Apply Import</button>
              </div>
            </div>
          }

          @if (importResult()) {
            <div class="import-result">
              <h3>Import Result</h3>
              <div class="preview-stats">
                <div class="stat"><span class="stat-label">Imported:</span> {{ importResult()!.imported }}</div>
                <div class="stat"><span class="stat-label">Skipped:</span> {{ importResult()!.skipped }}</div>
              </div>
            </div>
          }
        </div>
      }

      @if (activeTab() === 'blocklist' && isAdmin()) {
        <div class="form-panel">
          <h2>Sensitive Word Blocklist</h2>
          <div class="blocklist-add-row">
            <input
              class="blocklist-input"
              type="text"
              placeholder="Enter a word to block..."
              [value]="newWord()"
              (input)="newWord.set($any($event.target).value)"
              (keydown.enter)="onAddWord()"
            />
            <button class="btn-primary" (click)="onAddWord()" [disabled]="isBlocklistBusy() || !newWord().trim()">Add Term</button>
          </div>

          @if (isBlocklistLoading()) {
            <app-loading-state message="Loading blocklist..." />
          } @else if (blocklistError()) {
            <app-error-state [message]="blocklistError()!" [retryFn]="loadBlocklist.bind(this)" />
          } @else if (sensitiveWords().length === 0) {
            <app-empty-state message="No blocked words yet" />
          } @else {
            <table class="data-table" style="margin-top:1rem">
              <thead>
                <tr>
                  <th>Word</th>
                  <th>Added</th>
                  <th>Added By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (sw of sensitiveWords(); track sw.id) {
                  <tr>
                    <td class="mono">{{ sw.word }}</td>
                    <td>{{ sw.createdAt | date:'short' }}</td>
                    <td class="mono">{{ sw.createdBy }}</td>
                    <td>
                      <button class="btn-sm btn-danger" (click)="onRemoveWord(sw)" [disabled]="isBlocklistBusy()">Remove</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
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
    .form-row { display: flex; gap: 1rem; flex-wrap: wrap; }
    .field { margin-bottom: 1rem; flex: 1; min-width: 180px; }
    .field label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.9rem; }
    .field input, .field textarea, .field select {
      width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;
      font-size: 0.9rem; box-sizing: border-box; font-family: inherit;
    }
    .field input[type="file"] { padding: 0.35rem; }
    .form-actions { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .btn-primary {
      padding: 0.5rem 1.25rem; background: #4040ff; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      padding: 0.5rem 1.25rem; background: white; color: #333;
      border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .table-container { overflow-x: auto; }
    .data-table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
    .data-table th, .data-table td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid #eee; font-size: 0.875rem; }
    .data-table th { background: #f8f8f8; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; color: #666; }
    .mono { font-family: monospace; font-size: 0.8rem; }
    .role-badge {
      padding: 0.15rem 0.5rem; background: #e0e0ff; color: #4040ff;
      border-radius: 12px; font-size: 0.75rem; font-weight: 600;
      display: inline-block; margin-right: 0.25rem;
    }
    .preview-panel {
      margin-top: 1rem; padding: 1rem; background: #f8f8ff;
      border-radius: 6px; border: 1px solid #e0e0ff;
    }
    .preview-panel h3 { margin: 0 0 0.75rem; font-size: 1rem; }
    .preview-stats { display: flex; gap: 1.5rem; margin-bottom: 1rem; }
    .stat { font-size: 0.9rem; }
    .stat-label { font-weight: 600; }
    .conflicts { margin-bottom: 1rem; }
    .conflicts h4 { margin: 0 0 0.5rem; font-size: 0.9rem; color: #cc0000; }
    .conflict-item { font-size: 0.85rem; color: #cc0000; margin-bottom: 0.25rem; }
    .import-result {
      margin-top: 1rem; padding: 1rem; background: #f0fff0;
      border-radius: 6px; border: 1px solid #b0e0b0;
    }
    .import-result h3 { margin: 0 0 0.75rem; font-size: 1rem; }
    .deactivated td { opacity: 0.5; }
    .deactivated-label { color: #999; font-size: 0.8rem; font-style: italic; }
    .action-cell { display: flex; gap: 0.35rem; align-items: center; }
    .role-select { padding: 0.25rem; font-size: 0.8rem; border: 1px solid #ddd; border-radius: 4px; }
    .btn-sm { padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: 4px; cursor: pointer; border: none; }
    .btn-danger { background: #cc0000; color: white; }
    .btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }
    .blocklist-add-row { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; align-items: center; }
    .blocklist-input { flex: 1; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; font-family: inherit; }
  `]
})
export class AdminConsoleComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly userSvc = inject(UserService);
  private readonly importExportSvc = inject(ImportExportService);
  private readonly moderationSvc = inject(ModerationService);
  private readonly fb = inject(FormBuilder);

  activeTab = signal<string>('users');
  isLoading = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);
  isExporting = signal(false);
  isImporting = signal(false);

  users = signal<Partial<User>[]>([]);

  // Blocklist
  sensitiveWords = signal<SensitiveWord[]>([]);
  isBlocklistLoading = signal(false);
  isBlocklistBusy = signal(false);
  blocklistError = signal<string | null>(null);
  newWord = signal('');

  get isAdmin(): () => boolean {
    return () => {
      try {
        const ctx = this.session.requireAuth();
        return ctx.roles.includes(UserRole.Administrator);
      } catch {
        return false;
      }
    };
  }

  // Import/Export
  importFileData = signal<unknown[] | null>(null);
  importPreview = signal<{ entityType: string; total: number; newCount: number; existingCount: number; conflicts: string[]; importToken: string } | null>(null);
  importResult = signal<{ imported: number; skipped: number } | null>(null);

  exportEntityType = this.fb.control('jobs');
  importEntityType = this.fb.control('jobs');
  importStrategy = this.fb.control(ImportStrategy.Skip);

  strategies = ImportStrategy;

  ngOnInit(): void {
    this.loadUsers();
  }

  switchTab(tab: string): void {
    this.activeTab.set(tab);
    if (tab === 'users') this.loadUsers();
    if (tab === 'blocklist') this.loadBlocklist();
  }

  async loadUsers(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const ctx = this.session.requireAuth();
      const result = await this.userSvc.listByOrganization(ctx.roles, ctx.organizationId);
      this.users.set(result);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load users');
    } finally {
      this.isLoading.set(false);
    }
  }

  maskedUsername(username: string): string {
    if (!username) return '';
    return maskEmail(username.includes('@') ? username : username + '@local');
  }

  async onRoleChange(user: Partial<User>, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const newRole = select.value;
    if (!newRole || !user.id) return;
    select.value = ''; // reset dropdown
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.userSvc.changeRoles(user.id, [newRole as UserRole], ctx.userId, ctx.roles, ctx.organizationId);
      this.showSuccess(`Role changed to ${newRole}`);
      await this.loadUsers();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to change role');
      this.autoClearMessages();
    }
  }

  async onDeactivate(user: Partial<User>): Promise<void> {
    if (!user.id) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.userSvc.deactivateUser(user.id, ctx.userId, ctx.roles, ctx.organizationId);
      this.showSuccess('User deactivated');
      await this.loadUsers();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to deactivate user');
      this.autoClearMessages();
    }
  }

  async onExportJson(): Promise<void> {
    this.clearMessages();
    this.isExporting.set(true);
    try {
      const ctx = this.session.requireAuth();
      const entityType = this.exportEntityType.value!;
      const result = await this.importExportSvc.exportJson(entityType, ctx.userId, ctx.roles, ctx.organizationId);
      const content = JSON.stringify(result, null, 2);
      this.downloadFile(content, `${entityType}-export.json`, 'application/json');
      this.showSuccess(`Exported ${result.data.length} ${entityType} records as JSON`);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to export JSON');
      this.autoClearMessages();
    } finally {
      this.isExporting.set(false);
    }
  }

  async onExportCsv(): Promise<void> {
    this.clearMessages();
    this.isExporting.set(true);
    try {
      const ctx = this.session.requireAuth();
      const entityType = this.exportEntityType.value!;
      const csvContent = await this.importExportSvc.exportCsv(entityType, ctx.userId, ctx.roles, ctx.organizationId);
      this.downloadFile(csvContent, `${entityType}-export.csv`, 'text/csv');
      this.showSuccess(`Exported ${entityType} records as CSV`);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to export CSV');
      this.autoClearMessages();
    } finally {
      this.isExporting.set(false);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      this.importFileData.set(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      try {
        if (file.name.toLowerCase().endsWith('.csv')) {
          const records = this.importExportSvc.parseCsv(text);
          this.importFileData.set(records);
        } else {
          const parsed = JSON.parse(text);
          const data = Array.isArray(parsed) ? parsed : (parsed.data ?? [parsed]);
          this.importFileData.set(data);
        }
      } catch (e: any) {
        this.actionError.set(e.message ?? 'Invalid file');
        this.autoClearMessages();
        this.importFileData.set(null);
      }
    };
    reader.readAsText(file);
  }

  async onPreviewImport(): Promise<void> {
    const data = this.importFileData();
    if (!data) return;
    this.clearMessages();
    this.isImporting.set(true);
    this.importPreview.set(null);
    this.importResult.set(null);
    try {
      const ctx = this.session.requireAuth();
      const entityType = this.importEntityType.value!;
      const preview = await this.importExportSvc.previewImport(entityType, data, ctx.roles, ctx.organizationId);
      this.importPreview.set(preview);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to preview import');
      this.autoClearMessages();
    } finally {
      this.isImporting.set(false);
    }
  }

  async onApplyImport(): Promise<void> {
    const data = this.importFileData();
    const preview = this.importPreview();
    if (!data || !preview) return;
    this.clearMessages();
    this.isImporting.set(true);
    try {
      const ctx = this.session.requireAuth();
      const entityType = this.importEntityType.value!;
      const strategy = this.importStrategy.value!;
      const result = await this.importExportSvc.applyImport(entityType, data, strategy, preview.importToken, ctx.userId, ctx.roles, ctx.organizationId);
      this.importResult.set(result);
      this.importPreview.set(null);
      this.showSuccess(`Import complete: ${result.imported} imported, ${result.skipped} skipped`);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to apply import');
      this.autoClearMessages();
    } finally {
      this.isImporting.set(false);
    }
  }

  async loadBlocklist(): Promise<void> {
    this.isBlocklistLoading.set(true);
    this.blocklistError.set(null);
    try {
      const ctx = this.session.requireAuth();
      const words = await this.moderationSvc.listSensitiveWords(ctx.roles, ctx.organizationId);
      this.sensitiveWords.set(words);
    } catch (e: any) {
      this.blocklistError.set(e.message ?? 'Failed to load blocklist');
    } finally {
      this.isBlocklistLoading.set(false);
    }
  }

  async onAddWord(): Promise<void> {
    const word = this.newWord().trim();
    if (!word) return;
    this.clearMessages();
    this.isBlocklistBusy.set(true);
    try {
      const ctx = this.session.requireAuth();
      await this.moderationSvc.addSensitiveWord(word, ctx.userId, ctx.roles);
      this.newWord.set('');
      this.showSuccess(`"${word}" added to blocklist`);
      await this.loadBlocklist();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to add word');
      this.autoClearMessages();
    } finally {
      this.isBlocklistBusy.set(false);
    }
  }

  async onRemoveWord(sw: SensitiveWord): Promise<void> {
    this.clearMessages();
    this.isBlocklistBusy.set(true);
    try {
      const ctx = this.session.requireAuth();
      await this.moderationSvc.removeSensitiveWord(sw.id, ctx.userId, ctx.roles);
      this.showSuccess(`"${sw.word}" removed from blocklist`);
      await this.loadBlocklist();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to remove word');
      this.autoClearMessages();
    } finally {
      this.isBlocklistBusy.set(false);
    }
  }

  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
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
