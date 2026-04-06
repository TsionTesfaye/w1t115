import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { SessionService } from '../../../core/services/session.service';
import { ApplicationService } from '../../../core/services/application.service';
import { Application } from '../../../core/models';
import { ApplicationStage, ApplicationStatus, UserRole } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-application-detail',
  standalone: true,
  imports: [CommonModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent, DatePipe],
  template: `
    <div class="page">
      @if (actionSuccess()) {
        <div class="alert alert-success">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error">{{ actionError() }}</div>
      }

      @if (isLoading()) {
        <app-loading-state message="Loading application..." />
      } @else if (error()) {
        <app-error-state [message]="error()!" [retryFn]="loadApplication.bind(this)" />
      } @else if (app()) {
        <header class="page-header">
          <h1>Application Details</h1>
        </header>

        <div class="detail-card">
          <div class="detail-row">
            <span class="label">Application ID</span>
            <span class="mono">{{ app()!.id }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Job ID</span>
            <span class="mono">{{ app()!.jobId }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Stage</span>
            <span class="status-badge stage">{{ app()!.stage }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Status</span>
            <span class="status-badge" [attr.data-status]="app()!.status">{{ app()!.status }}</span>
          </div>
          @if (app()!.submittedAt) {
            <div class="detail-row">
              <span class="label">Submitted</span>
              <span>{{ app()!.submittedAt | date:'medium' }}</span>
            </div>
          }
          @if (app()!.offerExpiresAt) {
            <div class="detail-row">
              <span class="label">Offer Expires</span>
              <span>{{ app()!.offerExpiresAt | date:'medium' }}</span>
            </div>
          }
          <div class="detail-row">
            <span class="label">Created</span>
            <span>{{ app()!.createdAt | date:'medium' }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Updated</span>
            <span>{{ app()!.updatedAt | date:'medium' }}</span>
          </div>
        </div>

        <div class="actions">
          @if (isCandidate()) {
            @if (app()!.stage === 'draft' && app()!.status === 'active') {
              <button class="btn-primary" (click)="onSubmit()">Submit Application</button>
              <button class="btn-danger" (click)="onDeleteDraft()">Delete Draft</button>
            }
            @if (canWithdraw()) {
              <button class="btn-warn" (click)="onWithdraw()">Withdraw</button>
            }
            @if (app()!.stage === 'offer_extended' && app()!.status === 'active') {
              <button class="btn-primary" (click)="onAcceptOffer()">Accept Offer</button>
            }
            @if (app()!.status === 'active') {
              <button class="btn-secondary" (click)="goToPacket()">Application Packet</button>
            }
          }
          @if (isManagement()) {
            @if (app()!.status === 'active' && app()!.stage !== 'draft') {
              <button class="btn-primary" (click)="onAdvanceStage()">Advance Stage</button>
              <button class="btn-danger" (click)="onReject()">Reject</button>
            }
          }
          <button class="btn-secondary" (click)="goBack()">Back</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 900px; }
    .page-header { margin-bottom: 1.5rem; }
    .page-header h1 { margin: 0; }
    .detail-card {
      background: white; padding: 1.25rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-bottom: 1rem;
    }
    .detail-row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0; }
    .detail-row:last-child { border-bottom: none; }
    .label { font-weight: 600; color: #666; font-size: 0.9rem; }
    .mono { font-family: monospace; font-size: 0.85rem; }
    .status-badge {
      padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem;
      font-weight: 600; text-transform: capitalize;
    }
    .status-badge[data-status="active"] { background: #e8ffe8; color: #008000; }
    .status-badge[data-status="accepted"] { background: #e0e0ff; color: #4040ff; }
    .status-badge[data-status="rejected"] { background: #ffe8e8; color: #cc0000; }
    .status-badge[data-status="withdrawn"] { background: #fff3e0; color: #e65100; }
    .status-badge[data-status="expired"] { background: #f0f0f0; color: #999; }
    .status-badge.stage { background: #e0e0ff; color: #4040ff; }
    .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 1rem; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
    .alert-success { background: #e8ffe8; color: #008000; border: 1px solid #b0e0b0; }
    .alert-error { background: #ffe8e8; color: #cc0000; border: 1px solid #e0b0b0; }
    .btn-primary {
      padding: 0.5rem 1.25rem; background: #4040ff; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .btn-secondary {
      padding: 0.5rem 1.25rem; background: white; color: #333;
      border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .btn-warn {
      padding: 0.5rem 1.25rem; background: #ff6b35; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .btn-danger {
      padding: 0.5rem 1.25rem; background: #cc0000; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
  `]
})
export class ApplicationDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly appSvc = inject(ApplicationService);

  app = signal<Application | null>(null);
  isLoading = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);

  isManagement = computed(() => {
    const role = this.session.activeRole();
    return role === UserRole.Employer || role === UserRole.HRCoordinator || role === UserRole.Administrator;
  });

  isCandidate = computed(() => this.session.activeRole() === UserRole.Candidate);

  private static readonly WITHDRAWABLE: Set<string> = new Set([
    ApplicationStage.Submitted, ApplicationStage.UnderReview,
    ApplicationStage.InterviewScheduled, ApplicationStage.InterviewCompleted,
    ApplicationStage.OfferExtended,
  ]);

  canWithdraw = computed(() => {
    const a = this.app();
    if (!a || a.status !== ApplicationStatus.Active) return false;
    return ApplicationDetailComponent.WITHDRAWABLE.has(a.stage);
  });

  private static readonly STAGE_ORDER: string[] = [
    ApplicationStage.Draft, ApplicationStage.Submitted, ApplicationStage.UnderReview,
    ApplicationStage.InterviewScheduled, ApplicationStage.InterviewCompleted,
    ApplicationStage.OfferExtended,
  ];

  ngOnInit(): void {
    this.loadApplication();
  }

  async loadApplication(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const ctx = this.session.requireAuth();
      const applicationId = this.route.snapshot.paramMap.get('applicationId')!;
      const application = await this.appSvc.getApplication(applicationId, ctx.userId, ctx.roles, ctx.organizationId);
      this.app.set(application);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load application');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onSubmit(): Promise<void> {
    const current = this.app();
    if (!current) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const updated = await this.appSvc.transitionStage(
        current.id, ApplicationStage.Submitted, ctx.userId, ctx.roles, ctx.organizationId, current.version,
      );
      this.app.set(updated);
      this.showSuccess('Application submitted');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to submit');
      this.autoClearMessages();
    }
  }

  async onWithdraw(): Promise<void> {
    const current = this.app();
    if (!current) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const updated = await this.appSvc.withdraw(current.id, ctx.userId, ctx.organizationId, current.version);
      this.app.set(updated);
      this.showSuccess('Application withdrawn');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to withdraw');
      this.autoClearMessages();
    }
  }

  async onDeleteDraft(): Promise<void> {
    const current = this.app();
    if (!current) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.appSvc.deleteDraft(current.id, ctx.userId, ctx.organizationId, current.version);
      this.showSuccess('Draft deleted');
      this.router.navigate(['/applications']);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to delete draft');
      this.autoClearMessages();
    }
  }

  async onAcceptOffer(): Promise<void> {
    const current = this.app();
    if (!current) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const updated = await this.appSvc.acceptOffer(current.id, ctx.userId, ctx.organizationId, current.version);
      this.app.set(updated);
      this.showSuccess('Offer accepted');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to accept offer');
      this.autoClearMessages();
    }
  }

  async onAdvanceStage(): Promise<void> {
    const current = this.app();
    if (!current) return;
    this.clearMessages();
    const idx = ApplicationDetailComponent.STAGE_ORDER.indexOf(current.stage);
    if (idx < 0 || idx >= ApplicationDetailComponent.STAGE_ORDER.length - 1) {
      this.actionError.set('Cannot advance past the final stage');
      this.autoClearMessages();
      return;
    }
    const nextStage = ApplicationDetailComponent.STAGE_ORDER[idx + 1] as ApplicationStage;
    try {
      const ctx = this.session.requireAuth();
      const updated = await this.appSvc.transitionStage(
        current.id, nextStage, ctx.userId, ctx.roles, ctx.organizationId, current.version,
      );
      this.app.set(updated);
      this.showSuccess(`Stage advanced to ${nextStage}`);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to advance stage');
      this.autoClearMessages();
    }
  }

  async onReject(): Promise<void> {
    const current = this.app();
    if (!current) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const updated = await this.appSvc.reject(current.id, ctx.userId, ctx.roles, ctx.organizationId, current.version);
      this.app.set(updated);
      this.showSuccess('Application rejected');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to reject');
      this.autoClearMessages();
    }
  }

  goToPacket(): void {
    const current = this.app();
    if (current) this.router.navigate(['/application-packet', current.id]);
  }

  goBack(): void {
    this.router.navigate(['/applications']);
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
