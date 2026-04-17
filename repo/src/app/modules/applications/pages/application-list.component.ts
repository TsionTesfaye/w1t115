import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SessionService } from '../../../core/services/session.service';
import { ApplicationService } from '../../../core/services/application.service';
import { JobService } from '../../../core/services/job.service';
import { Application, Job } from '../../../core/models';
import { ApplicationStage, ApplicationStatus, UserRole } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-application-list',
  standalone: true,
  imports: [CommonModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <h1>Applications</h1>
        @if (isManagement()) {
          <div class="filter-tabs">
            <button [class.active]="stageFilter() === 'all'" (click)="stageFilter.set('all')">All</button>
            <button [class.active]="stageFilter() === 'draft'" (click)="stageFilter.set('draft')">Draft</button>
            <button [class.active]="stageFilter() === 'submitted'" (click)="stageFilter.set('submitted')">Submitted</button>
            <button [class.active]="stageFilter() === 'under_review'" (click)="stageFilter.set('under_review')">Under Review</button>
            <button [class.active]="stageFilter() === 'interview_scheduled'" (click)="stageFilter.set('interview_scheduled')">Interview Scheduled</button>
            <button [class.active]="stageFilter() === 'interview_completed'" (click)="stageFilter.set('interview_completed')">Interview Completed</button>
            <button [class.active]="stageFilter() === 'offer_extended'" (click)="stageFilter.set('offer_extended')">Offer Extended</button>
          </div>
        }
      </header>

      @if (actionSuccess()) {
        <div class="alert alert-success">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error">{{ actionError() }}</div>
      }

      @if (isLoading()) {
        <app-loading-state message="Loading applications..." />
      } @else if (error()) {
        <app-error-state [message]="error()!" [retryFn]="loadApps.bind(this)" />
      } @else if (filteredApps().length === 0) {
        <app-empty-state message="No applications found" />
      } @else {
        <table class="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (app of filteredApps(); track app.id) {
              <tr>
                <td>{{ jobTitleMap().get(app.jobId) ?? app.jobId }}</td>
                <td><span class="stage-badge" [attr.data-stage]="app.stage">{{ formatStage(app.stage) }}</span></td>
                <td><span class="status-badge" [attr.data-status]="app.status">{{ app.status }}</span></td>
                <td>{{ app.submittedAt ? (app.submittedAt | date:'short') : '-' }}</td>
                <td class="actions">
                  <button class="btn-sm btn-secondary" (click)="goToDetail(app)">View</button>
                  @if (isCandidate()) {
                    @if (app.status === 'active') {
                      <button class="btn-sm btn-packet" (click)="goToPacket(app)">Packet</button>
                    }
                    @if (app.stage === 'draft' && app.status === 'active') {
                      <button class="btn-sm btn-primary" (click)="onSubmit(app)">Submit</button>
                      <button class="btn-sm btn-danger" (click)="onDeleteDraft(app)">Delete</button>
                    }
                    @if (app.stage !== 'draft' && app.status === 'active') {
                      <button class="btn-sm btn-warn" (click)="onWithdraw(app)">Withdraw</button>
                    }
                  }
                  @if (isManagement()) {
                    @if (app.status === 'active' && nextStage(app.stage); as next) {
                      <button class="btn-sm btn-primary" (click)="onAdvance(app, next)">Advance</button>
                    }
                    @if (app.status === 'active' && app.stage !== 'draft') {
                      <button class="btn-sm btn-danger" (click)="onReject(app)">Reject</button>
                    }
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 1200px; }
    .page-header { margin-bottom: 1.5rem; }
    .page-header h1 { margin: 0 0 1rem; }
    .filter-tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .filter-tabs button {
      padding: 0.4rem 0.75rem; border: 1px solid #ddd; background: white;
      border-radius: 4px; cursor: pointer; font-size: 0.8rem;
    }
    .filter-tabs button.active { background: #4040ff; color: white; border-color: #4040ff; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
    .alert-success { background: #e8ffe8; color: #008000; border: 1px solid #b0e0b0; }
    .alert-error { background: #ffe8e8; color: #cc0000; border: 1px solid #e0b0b0; }
    .table {
      width: 100%; border-collapse: collapse; background: white;
      border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .table th, .table td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #eee; }
    .table th { background: #f8f8ff; font-weight: 600; font-size: 0.85rem; }
    .stage-badge, .status-badge {
      padding: 0.2rem 0.5rem; border-radius: 12px; font-size: 0.75rem;
      font-weight: 600; text-transform: capitalize;
    }
    .stage-badge { background: #e0e0ff; color: #4040ff; }
    .status-badge[data-status="active"] { background: #e8ffe8; color: #008000; }
    .status-badge[data-status="accepted"] { background: #e8ffe8; color: #006600; }
    .status-badge[data-status="rejected"] { background: #ffe8e8; color: #cc0000; }
    .status-badge[data-status="withdrawn"] { background: #fff3e0; color: #cc6600; }
    .status-badge[data-status="expired"] { background: #f0f0f0; color: #999; }
    .status-badge[data-status="deleted"] { background: #f0f0f0; color: #999; }
    .actions { display: flex; gap: 0.25rem; }
    .btn-sm { padding: 0.3rem 0.75rem; font-size: 0.8rem; border-radius: 4px; cursor: pointer; border: none; }
    .btn-sm.btn-primary { background: #4040ff; color: white; }
    .btn-sm.btn-secondary { background: white; color: #333; border: 1px solid #ddd; }
    .btn-sm.btn-packet { background: #6060ff; color: white; }
    .btn-sm.btn-warn { background: #ff6b35; color: white; }
    .btn-sm.btn-danger { background: #cc0000; color: white; }
  `]
})
export class ApplicationListComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly appSvc = inject(ApplicationService);
  private readonly jobSvc = inject(JobService);
  private readonly router = inject(Router);

  apps = signal<Application[]>([]);
  jobTitleMap = signal<Map<string, string>>(new Map());
  isLoading = signal(false);
  error = signal<string | null>(null);
  stageFilter = signal<string>('all');
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);

  isManagement = computed(() => {
    const role = this.session.activeRole();
    return role === UserRole.Employer || role === UserRole.HRCoordinator || role === UserRole.Administrator;
  });

  isCandidate = computed(() => {
    return this.session.activeRole() === UserRole.Candidate;
  });

  filteredApps = computed(() => {
    const filter = this.stageFilter();
    const all = this.apps();
    if (filter === 'all') return all;
    return all.filter(a => a.stage === filter);
  });

  private readonly stageOrder: string[] = [
    ApplicationStage.Draft,
    ApplicationStage.Submitted,
    ApplicationStage.UnderReview,
    ApplicationStage.InterviewScheduled,
    ApplicationStage.InterviewCompleted,
    ApplicationStage.OfferExtended,
  ];

  ngOnInit(): void {
    this.loadApps();
  }

  async loadApps(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const ctx = this.session.requireAuth();
      let applications: Application[];
      if (this.isCandidate()) {
        applications = await this.appSvc.listByCandidate(ctx.userId, ctx.userId, ctx.organizationId);
      } else {
        applications = await this.appSvc.listByOrganization(ctx.userId, ctx.roles, ctx.organizationId);
      }
      this.apps.set(applications);

      // Resolve job titles
      try {
        const jobs = await this.jobSvc.listJobs(ctx.userId, ctx.roles, ctx.organizationId);
        const map = new Map<string, string>();
        for (const j of jobs) {
          map.set(j.id, j.title);
        }
        this.jobTitleMap.set(map);
      } catch {
        // Non-critical — fall back to showing job IDs
      }
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load applications');
    } finally {
      this.isLoading.set(false);
    }
  }

  formatStage(stage: string): string {
    return stage.replace(/_/g, ' ');
  }

  nextStage(currentStage: string): ApplicationStage | null {
    const idx = this.stageOrder.indexOf(currentStage);
    if (idx >= 0 && idx < this.stageOrder.length - 1) {
      return this.stageOrder[idx + 1] as ApplicationStage;
    }
    return null;
  }

  goToDetail(app: Application): void {
    this.router.navigate(['/applications', app.id]);
  }

  goToPacket(app: Application): void {
    this.router.navigate(['/application-packet', app.id]);
  }

  async onSubmit(app: Application): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.appSvc.transitionStage(app.id, ApplicationStage.Submitted, ctx.userId, ctx.roles, ctx.organizationId, app.version);
      this.showSuccess('Application submitted successfully');
      await this.loadApps();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to submit application');
      this.autoClearMessages();
    }
  }

  async onWithdraw(app: Application): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.appSvc.withdraw(app.id, ctx.userId, ctx.organizationId, app.version);
      this.showSuccess('Application withdrawn');
      await this.loadApps();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to withdraw application');
      this.autoClearMessages();
    }
  }

  async onDeleteDraft(app: Application): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.appSvc.deleteDraft(app.id, ctx.userId, ctx.organizationId, app.version);
      this.showSuccess('Draft application deleted');
      await this.loadApps();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to delete application');
      this.autoClearMessages();
    }
  }

  async onAdvance(app: Application, nextStage: ApplicationStage): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.appSvc.transitionStage(app.id, nextStage, ctx.userId, ctx.roles, ctx.organizationId, app.version);
      this.showSuccess(`Application advanced to ${this.formatStage(nextStage)}`);
      await this.loadApps();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to advance application');
      this.autoClearMessages();
    }
  }

  async onReject(app: Application): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.appSvc.reject(app.id, ctx.userId, ctx.roles, ctx.organizationId, app.version);
      this.showSuccess('Application rejected');
      await this.loadApps();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to reject application');
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
