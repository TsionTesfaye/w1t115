import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { SessionService } from '../../../core/services/session.service';
import { JobService } from '../../../core/services/job.service';
import { ApplicationService } from '../../../core/services/application.service';
import { Job } from '../../../core/models';
import { JobStatus, UserRole } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-job-detail',
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
        <app-loading-state message="Loading job details..." />
      } @else if (error()) {
        <app-error-state [message]="error()!" [retryFn]="loadJob.bind(this)" />
      } @else if (job()) {
        <header class="page-header">
          <div class="header-top">
            <h1>{{ job()!.title }}</h1>
            <span class="status-badge" [attr.data-status]="job()!.status">{{ job()!.status }}</span>
          </div>
          <div class="meta">
            <span>Created: {{ job()!.createdAt | date:'medium' }}</span>
            <span>Updated: {{ job()!.updatedAt | date:'medium' }}</span>
          </div>
        </header>

        <div class="detail-card">
          <h2>Description</h2>
          <p class="description">{{ job()!.description }}</p>
        </div>

        @if (job()!.tags.length > 0) {
          <div class="detail-card">
            <h2>Tags</h2>
            <div class="tags-row">
              @for (tag of job()!.tags; track tag) {
                <span class="tag">{{ tag }}</span>
              }
            </div>
          </div>
        }

        @if (job()!.topics.length > 0) {
          <div class="detail-card">
            <h2>Topics</h2>
            <div class="tags-row">
              @for (topic of job()!.topics; track topic) {
                <span class="tag topic">{{ topic }}</span>
              }
            </div>
          </div>
        }

        <div class="actions">
          @if (isManagement()) {
            @if (job()!.status === 'draft') {
              <button class="btn-primary" (click)="onTransition('active')">Publish</button>
            }
            @if (job()!.status === 'active') {
              <button class="btn-warn" (click)="onTransition('closed')">Close</button>
            }
            @if (job()!.status === 'closed') {
              <button class="btn-secondary" (click)="onTransition('archived')">Archive</button>
            }
          }
          @if (isCandidate() && job()!.status === 'active') {
            <button class="btn-primary" (click)="onApply()">Apply</button>
          }
          <button class="btn-secondary" (click)="goBack()">Back to Jobs</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 900px; }
    .page-header { margin-bottom: 1.5rem; }
    .header-top { display: flex; justify-content: space-between; align-items: center; }
    .header-top h1 { margin: 0; }
    .meta { color: #666; font-size: 0.85rem; display: flex; gap: 1.5rem; margin-top: 0.5rem; }
    .status-badge {
      padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem;
      font-weight: 600; text-transform: capitalize;
    }
    .status-badge[data-status="draft"] { background: #e8e8e8; color: #666; }
    .status-badge[data-status="active"] { background: #e8ffe8; color: #008000; }
    .status-badge[data-status="closed"] { background: #ffe8e8; color: #cc0000; }
    .status-badge[data-status="archived"] { background: #f0f0f0; color: #999; }
    .detail-card {
      background: white; padding: 1.25rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-bottom: 1rem;
    }
    .detail-card h2 { margin: 0 0 0.75rem; font-size: 1rem; }
    .description { margin: 0; color: #444; line-height: 1.6; white-space: pre-wrap; }
    .tags-row { display: flex; gap: 0.25rem; flex-wrap: wrap; }
    .tag { padding: 0.15rem 0.5rem; background: #e0e0ff; color: #4040ff; border-radius: 12px; font-size: 0.75rem; }
    .tag.topic { background: #e0ffe0; color: #008000; }
    .actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
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
  `]
})
export class JobDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly jobSvc = inject(JobService);
  private readonly appSvc = inject(ApplicationService);

  job = signal<Job | null>(null);
  isLoading = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);

  isManagement = computed(() => {
    const role = this.session.activeRole();
    return role === UserRole.Employer || role === UserRole.HRCoordinator || role === UserRole.Administrator;
  });

  isCandidate = computed(() => this.session.activeRole() === UserRole.Candidate);

  ngOnInit(): void {
    this.loadJob();
  }

  async loadJob(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const ctx = this.session.requireAuth();
      const jobId = this.route.snapshot.paramMap.get('jobId')!;
      const job = await this.jobSvc.getJob(jobId, ctx.organizationId);
      this.job.set(job);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load job');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onTransition(newStatus: string): Promise<void> {
    const current = this.job();
    if (!current) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const updated = await this.jobSvc.transitionJobStatus(
        current.id, newStatus as JobStatus, ctx.userId, ctx.roles, ctx.organizationId, current.version,
      );
      this.job.set(updated);
      this.showSuccess(`Job status changed to ${newStatus}`);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to change status');
      this.autoClearMessages();
    }
  }

  async onApply(): Promise<void> {
    const current = this.job();
    if (!current) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.appSvc.createApplication(current.id, ctx.userId, ctx.organizationId, ctx.roles);
      this.showSuccess('Application created successfully');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to apply');
      this.autoClearMessages();
    }
  }

  goBack(): void {
    this.router.navigate(['/jobs']);
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
