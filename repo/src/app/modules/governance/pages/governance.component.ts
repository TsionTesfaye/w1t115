import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { SessionService } from '../../../core/services/session.service';
import { AuditService } from '../../../core/services/audit.service';
import { GovernanceService } from '../../../core/services/governance.service';
import { AuditLog, AuditSearchParams, DataDictionaryEntry, LineageLink, MetricDefinition, DatasetSnapshot } from '../../../core/models';
import { AuditAction } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-governance',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent, DatePipe],
  template: `
    <div class="page">
      <header class="page-header">
        <h1>Governance</h1>
      </header>

      <div class="tabs">
        <button [class.active]="activeTab() === 'audit'" (click)="activeTab.set('audit')">Audit Logs</button>
        <button [class.active]="activeTab() === 'dictionary'" (click)="switchTab('dictionary')">Data Dictionary</button>
        <button [class.active]="activeTab() === 'lineage'" (click)="activeTab.set('lineage')">Lineage</button>
        <button [class.active]="activeTab() === 'metrics'" (click)="switchTab('metrics')">Metrics</button>
        <button [class.active]="activeTab() === 'snapshots'" (click)="switchTab('snapshots')">Snapshots</button>
      </div>

      @if (actionSuccess()) {
        <div class="alert alert-success">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error">{{ actionError() }}</div>
      }

      @if (activeTab() === 'audit') {
        <div class="form-panel">
          <h2>Search Audit Logs</h2>
          <form [formGroup]="auditSearchForm" (ngSubmit)="onSearchAudit()">
            <div class="form-row">
              <div class="field">
                <label for="startDate">Start Date (MM/DD/YYYY)</label>
                <input id="startDate" formControlName="startDate" type="text" placeholder="MM/DD/YYYY" pattern="\\d{2}/\\d{2}/\\d{4}">
              </div>
              <div class="field">
                <label for="endDate">End Date (MM/DD/YYYY)</label>
                <input id="endDate" formControlName="endDate" type="text" placeholder="MM/DD/YYYY" pattern="\\d{2}/\\d{2}/\\d{4}">
              </div>
              <div class="field">
                <label for="actorId">Actor ID</label>
                <input id="actorId" formControlName="actorId">
              </div>
            </div>
            <div class="form-row">
              <div class="field">
                <label for="action">Action</label>
                <select id="action" formControlName="action">
                  <option value="">All Actions</option>
                  @for (action of auditActions; track action) {
                    <option [value]="action">{{ action }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label for="entityType">Entity Type</label>
                <input id="entityType" formControlName="entityType">
              </div>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-primary" [disabled]="isLoading()">Search</button>
              <button type="button" class="btn-secondary" (click)="onVerifyIntegrity()" [disabled]="isLoading()">Verify Integrity</button>
            </div>
          </form>
        </div>

        @if (integrityResult()) {
          <div class="alert" [class.alert-success]="integrityResult()!.valid" [class.alert-error]="!integrityResult()!.valid">
            {{ integrityResult()!.valid ? 'Audit chain integrity verified - all hashes valid' : 'Audit chain BROKEN at entry: ' + integrityResult()!.brokenAt }}
          </div>
        }

        @if (isLoading()) {
          <app-loading-state message="Searching audit logs..." />
        } @else if (auditLogs().length === 0 && auditSearched()) {
          <app-empty-state message="No audit logs found matching your criteria" />
        } @else if (auditLogs().length > 0) {
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity Type</th>
                  <th>Entity ID</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                @for (log of auditLogs(); track log.id) {
                  <tr>
                    <td>{{ log.timestamp | date:'short' }}</td>
                    <td class="mono">{{ log.actorId }}</td>
                    <td><span class="action-badge">{{ log.action }}</span></td>
                    <td>{{ log.entityType }}</td>
                    <td class="mono">{{ log.entityId }}</td>
                    <td class="meta-cell"><pre class="meta-json">{{ formatJson(log.metadata) }}</pre></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      @if (activeTab() === 'dictionary') {
        <div class="form-panel compact">
          <div class="form-row">
            <div class="field">
              <label for="dictFilter">Filter by Entity Type</label>
              <select id="dictFilter" (change)="onDictFilterChange($event)">
                <option value="">All Entity Types</option>
                @for (et of dictEntityTypes(); track et) {
                  <option [value]="et">{{ et }}</option>
                }
              </select>
            </div>
          </div>
        </div>

        @if (isLoading()) {
          <app-loading-state message="Loading data dictionary..." />
        } @else if (dictEntries().length === 0) {
          <app-empty-state message="No data dictionary entries found" />
        } @else {
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Entity Type</th>
                  <th>Field Name</th>
                  <th>Description</th>
                  <th>Data Type</th>
                  <th>Sensitivity</th>
                </tr>
              </thead>
              <tbody>
                @for (entry of filteredDictEntries(); track entry.id) {
                  <tr>
                    <td>{{ entry.entityType }}</td>
                    <td class="mono">{{ entry.fieldName }}</td>
                    <td>{{ entry.description }}</td>
                    <td>{{ entry.dataType }}</td>
                    <td><span class="sensitivity-badge" [attr.data-level]="entry.sensitivity">{{ entry.sensitivity }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      @if (activeTab() === 'lineage') {
        <div class="form-panel">
          <h2>Lineage Explorer</h2>
          <form [formGroup]="lineageForm" (ngSubmit)="onResolveLineage()">
            <div class="form-row">
              <div class="field">
                <label for="lineageEntityType">Entity Type</label>
                <select id="lineageEntityType" formControlName="entityType">
                  <option value="job">Job</option>
                  <option value="application">Application</option>
                  <option value="interview">Interview</option>
                  <option value="document">Document</option>
                </select>
              </div>
              <div class="field">
                <label for="lineageEntityId">Entity ID</label>
                <input id="lineageEntityId" formControlName="entityId">
              </div>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-primary" [disabled]="isLoading()">Resolve Lineage</button>
            </div>
          </form>
        </div>

        @if (isLoading()) {
          <app-loading-state message="Resolving lineage..." />
        } @else if (lineageLinks().length === 0 && lineageSearched()) {
          <app-empty-state message="No lineage links found for this entity" />
        } @else if (lineageLinks().length > 0) {
          <div class="lineage-list">
            @for (link of lineageLinks(); track link.id) {
              <div class="lineage-card">
                <span class="lineage-from">{{ link.fromEntityType }}:{{ link.fromEntityId }}</span>
                <span class="lineage-arrow">--></span>
                <span class="lineage-to">{{ link.toEntityType }}:{{ link.toEntityId }}</span>
              </div>
            }
          </div>
        }
      }

      @if (activeTab() === 'metrics') {
        @if (isLoading()) {
          <app-loading-state message="Loading metrics..." />
        } @else if (metrics().length === 0) {
          <app-empty-state message="No metric definitions found" />
        } @else {
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Label</th>
                  <th>Formula Description</th>
                </tr>
              </thead>
              <tbody>
                @for (m of metrics(); track m.id) {
                  <tr>
                    <td class="mono">{{ m.key }}</td>
                    <td>{{ m.label }}</td>
                    <td>{{ m.formulaDescription }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      @if (activeTab() === 'snapshots') {
        <div class="form-panel">
          <h2>Create Snapshot</h2>
          <form [formGroup]="snapshotForm" (ngSubmit)="onCreateSnapshot()">
            <div class="field">
              <label for="snapLabel">Label</label>
              <input id="snapLabel" formControlName="label">
            </div>
            <div class="field">
              <label for="snapNotes">Query Notes</label>
              <textarea id="snapNotes" formControlName="queryNotes" rows="3"></textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-primary" [disabled]="isLoading()">Create Snapshot</button>
            </div>
          </form>
        </div>

        @if (isLoading()) {
          <app-loading-state message="Loading snapshots..." />
        } @else if (snapshots().length === 0) {
          <app-empty-state message="No snapshots created yet" />
        } @else {
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Created By</th>
                  <th>Created At</th>
                  <th>Entity Counts</th>
                </tr>
              </thead>
              <tbody>
                @for (snap of snapshots(); track snap.id) {
                  <tr>
                    <td>{{ snap.label }}</td>
                    <td class="mono">{{ snap.createdBy }}</td>
                    <td>{{ snap.createdAt | date:'short' }}</td>
                    <td>{{ formatEntityCounts(snap.manifest.entityCounts) }}</td>
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
    .tabs { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .tabs button { padding: 0.5rem 1rem; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; }
    .tabs button.active { background: #4040ff; color: white; border-color: #4040ff; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
    .alert-success { background: #e8ffe8; color: #008000; border: 1px solid #b0e0b0; }
    .alert-error { background: #ffe8e8; color: #cc0000; border: 1px solid #e0b0b0; }
    .form-panel {
      background: white; padding: 1.5rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-bottom: 1.5rem;
    }
    .form-panel.compact { padding: 1rem; }
    .form-panel h2 { margin: 0 0 1rem; font-size: 1.1rem; }
    .form-row { display: flex; gap: 1rem; flex-wrap: wrap; }
    .field { margin-bottom: 1rem; flex: 1; min-width: 180px; }
    .field label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.9rem; }
    .field input, .field textarea, .field select {
      width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;
      font-size: 0.9rem; box-sizing: border-box; font-family: inherit;
    }
    .form-actions { display: flex; gap: 0.5rem; }
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
    .action-badge {
      padding: 0.15rem 0.5rem; background: #e0e0ff; color: #4040ff;
      border-radius: 12px; font-size: 0.75rem; font-weight: 600;
    }
    .meta-cell { max-width: 250px; }
    .meta-json { margin: 0; font-size: 0.75rem; white-space: pre-wrap; word-break: break-word; background: #f8f8f8; padding: 0.25rem 0.5rem; border-radius: 4px; }
    .sensitivity-badge {
      padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem;
      font-weight: 600; text-transform: capitalize; display: inline-block;
    }
    .sensitivity-badge[data-level="public"] { background: #e8ffe8; color: #008000; }
    .sensitivity-badge[data-level="internal"] { background: #e0e8ff; color: #2040cc; }
    .sensitivity-badge[data-level="sensitive"] { background: #fff8e0; color: #b08000; }
    .sensitivity-badge[data-level="restricted"] { background: #ffe8e8; color: #cc0000; }
    .lineage-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .lineage-card {
      background: white; padding: 0.75rem 1rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); display: flex; align-items: center; gap: 0.75rem;
      font-family: monospace; font-size: 0.85rem;
    }
    .lineage-arrow { color: #4040ff; font-weight: bold; }
    .lineage-from { color: #555; }
    .lineage-to { color: #333; font-weight: 600; }
  `]
})
export class GovernanceComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly auditSvc = inject(AuditService);
  private readonly govSvc = inject(GovernanceService);
  private readonly fb = inject(FormBuilder);

  activeTab = signal<string>('audit');
  isLoading = signal(false);
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);

  // Audit
  auditLogs = signal<AuditLog[]>([]);
  auditSearched = signal(false);
  integrityResult = signal<{ valid: boolean; brokenAt?: string } | null>(null);
  auditActions = Object.values(AuditAction);

  // Dictionary
  dictEntries = signal<DataDictionaryEntry[]>([]);
  dictEntityTypes = signal<string[]>([]);
  dictFilter = signal<string>('');

  // Lineage
  lineageLinks = signal<LineageLink[]>([]);
  lineageSearched = signal(false);

  // Metrics
  metrics = signal<MetricDefinition[]>([]);

  // Snapshots
  snapshots = signal<DatasetSnapshot[]>([]);

  auditSearchForm: FormGroup = this.fb.group({
    startDate: [''],
    endDate: [''],
    actorId: [''],
    action: [''],
    entityType: [''],
  });

  lineageForm: FormGroup = this.fb.group({
    entityType: ['job'],
    entityId: [''],
  });

  snapshotForm: FormGroup = this.fb.group({
    label: [''],
    queryNotes: [''],
  });

  ngOnInit(): void {
    // Load data dictionary and metrics eagerly for tab switching
  }

  filteredDictEntries(): DataDictionaryEntry[] {
    const filter = this.dictFilter();
    const entries = this.dictEntries();
    if (!filter) return entries;
    return entries.filter(e => e.entityType === filter);
  }

  switchTab(tab: string): void {
    this.activeTab.set(tab);
    if (tab === 'dictionary') this.loadDataDictionary();
    if (tab === 'metrics') this.loadMetrics();
    if (tab === 'snapshots') this.loadSnapshots();
  }

  async onSearchAudit(): Promise<void> {
    this.clearMessages();
    this.isLoading.set(true);
    this.auditSearched.set(false);
    try {
      const ctx = this.session.requireAuth();
      const formVal = this.auditSearchForm.value;
      const params: AuditSearchParams = {};
      if (formVal.startDate) params.startDate = this.parseDateToIso(formVal.startDate, '00:00:00.000Z');
      if (formVal.endDate) params.endDate = this.parseDateToIso(formVal.endDate, '23:59:59.999Z');
      if (formVal.actorId) params.actorId = formVal.actorId;
      if (formVal.action) params.action = formVal.action;
      if (formVal.entityType) params.entityType = formVal.entityType;

      const results = await this.auditSvc.search(params, ctx.userId, ctx.roles, ctx.organizationId);
      this.auditLogs.set(results);
      this.auditSearched.set(true);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to search audit logs');
      this.autoClearMessages();
    } finally {
      this.isLoading.set(false);
    }
  }

  async onVerifyIntegrity(): Promise<void> {
    this.clearMessages();
    this.isLoading.set(true);
    this.integrityResult.set(null);
    try {
      const ctx = this.session.requireAuth();
      const result = await this.auditSvc.verifyIntegrity(ctx.roles);
      this.integrityResult.set(result);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to verify integrity');
      this.autoClearMessages();
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadDataDictionary(): Promise<void> {
    this.isLoading.set(true);
    try {
      const ctx = this.session.requireAuth();
      const entries = await this.govSvc.getDataDictionary(ctx.roles);
      this.dictEntries.set(entries);
      const types = [...new Set(entries.map(e => e.entityType))];
      this.dictEntityTypes.set(types);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to load data dictionary');
      this.autoClearMessages();
    } finally {
      this.isLoading.set(false);
    }
  }

  onDictFilterChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.dictFilter.set(val);
  }

  async onResolveLineage(): Promise<void> {
    this.clearMessages();
    this.isLoading.set(true);
    this.lineageSearched.set(false);
    try {
      const ctx = this.session.requireAuth();
      const { entityType, entityId } = this.lineageForm.value;
      const links = await this.govSvc.resolveLineage(entityType, entityId, ctx.roles, ctx.organizationId);
      this.lineageLinks.set(links);
      this.lineageSearched.set(true);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to resolve lineage');
      this.autoClearMessages();
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadMetrics(): Promise<void> {
    this.isLoading.set(true);
    try {
      const ctx = this.session.requireAuth();
      const defs = await this.govSvc.getMetricDefinitions(ctx.roles);
      this.metrics.set(defs);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to load metrics');
      this.autoClearMessages();
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadSnapshots(): Promise<void> {
    this.isLoading.set(true);
    try {
      const ctx = this.session.requireAuth();
      const snaps = await this.govSvc.listSnapshots(ctx.roles, ctx.organizationId);
      this.snapshots.set(snaps);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to load snapshots');
      this.autoClearMessages();
    } finally {
      this.isLoading.set(false);
    }
  }

  async onCreateSnapshot(): Promise<void> {
    this.clearMessages();
    this.isLoading.set(true);
    try {
      const ctx = this.session.requireAuth();
      const { label, queryNotes } = this.snapshotForm.value;
      await this.govSvc.createSnapshot(label || 'Untitled', queryNotes || '', ctx.userId, ctx.roles, ctx.organizationId);
      this.actionSuccess.set('Snapshot created successfully');
      this.autoClearMessages();
      this.snapshotForm.reset();
      await this.loadSnapshots();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to create snapshot');
      this.autoClearMessages();
    } finally {
      this.isLoading.set(false);
    }
  }

  formatJson(obj: Record<string, unknown>): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  formatEntityCounts(counts: Record<string, number>): string {
    return Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ');
  }

  /**
   * Parse a MM/DD/YYYY user input string to an ISO 8601 timestamp string.
   * Falls back to treating the input as a raw YYYY-MM-DD value (native date picker)
   * so the field is backward-compatible with both input types.
   */
  private parseDateToIso(input: string, timeSuffix: string): string {
    const mmddyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.trim());
    if (mmddyyyy) {
      const [, mm, dd, yyyy] = mmddyyyy;
      return `${yyyy}-${mm}-${dd}T${timeSuffix}`;
    }
    // Fallback: already YYYY-MM-DD (e.g. from a native date picker)
    return input + 'T' + timeSuffix;
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
