import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SessionService } from '../../../core/services/session.service';
import { JobService } from '../../../core/services/job.service';
import { ApplicationService } from '../../../core/services/application.service';
import { Job } from '../../../core/models';
import { JobStatus, UserRole } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-job-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <h1>Jobs</h1>
        @if (isManagement()) {
          <div class="header-actions">
            <button class="btn-primary" (click)="showCreateForm.set(true)">Create Job</button>
          </div>
          <div class="filter-tabs">
            <button [class.active]="statusFilter() === 'all'" (click)="setFilter('all')">All</button>
            <button [class.active]="statusFilter() === 'draft'" (click)="setFilter('draft')">Draft</button>
            <button [class.active]="statusFilter() === 'active'" (click)="setFilter('active')">Active</button>
            <button [class.active]="statusFilter() === 'closed'" (click)="setFilter('closed')">Closed</button>
          </div>
        }
      </header>

      @if (actionSuccess()) {
        <div class="alert alert-success">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error">{{ actionError() }}</div>
      }

      @if (showCreateForm() || editingJob()) {
        <div class="form-panel">
          <h2>{{ editingJob() ? 'Edit Job' : 'Create Job' }}</h2>
          <form [formGroup]="jobForm" (ngSubmit)="editingJob() ? onUpdateJob() : onCreateJob()">
            <div class="field">
              <label for="title">Title *</label>
              <input id="title" formControlName="title">
              @if (jobForm.get('title')?.touched && jobForm.get('title')?.invalid) {
                <span class="field-error">Title is required</span>
              }
            </div>
            <div class="field">
              <label for="description">Description *</label>
              <textarea id="description" formControlName="description" rows="4"></textarea>
              @if (jobForm.get('description')?.touched && jobForm.get('description')?.invalid) {
                <span class="field-error">Description is required</span>
              }
            </div>
            <div class="field">
              <label for="tags">Tags (comma-separated)</label>
              <input id="tags" formControlName="tags">
            </div>
            <div class="field">
              <label for="topics">Topics (comma-separated)</label>
              <input id="topics" formControlName="topics">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-primary" [disabled]="jobForm.invalid">
                {{ editingJob() ? 'Save Changes' : 'Create Draft' }}
              </button>
              <button type="button" class="btn-secondary" (click)="cancelForm()">Cancel</button>
            </div>
          </form>
        </div>
      }

      @if (isLoading()) {
        <app-loading-state message="Loading jobs..." />
      } @else if (error()) {
        <app-error-state [message]="error()!" [retryFn]="loadJobs.bind(this)" />
      } @else if (filteredJobs().length === 0) {
        <app-empty-state message="No jobs found" />
      } @else {
        <div class="list">
          @for (job of filteredJobs(); track job.id) {
            <div class="job-card" [attr.data-status]="job.status">
              <div class="job-header">
                <h3>{{ job.title }}</h3>
                <span class="status-badge" [attr.data-status]="job.status">{{ job.status }}</span>
              </div>
              <p class="job-desc">{{ job.description }}</p>
              @if (job.tags.length > 0) {
                <div class="job-tags">
                  @for (tag of job.tags; track tag) {
                    <span class="tag">{{ tag }}</span>
                  }
                </div>
              }
              <div class="job-actions">
                @if (isManagement()) {
                  @if (job.status === 'draft') {
                    <button class="btn-sm btn-primary" (click)="onPublish(job)">Publish</button>
                    <button class="btn-sm btn-secondary" (click)="startEdit(job)">Edit</button>
                  }
                  @if (job.status === 'active') {
                    <button class="btn-sm btn-warn" (click)="onClose(job)">Close</button>
                  }
                }
                @if (isCandidate() && job.status === 'active') {
                  <button class="btn-sm btn-primary" (click)="onApply(job)">Apply</button>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 1200px; }
    .page-header { margin-bottom: 1.5rem; }
    .page-header h1 { margin: 0 0 1rem; }
    .header-actions { margin-bottom: 0.75rem; }
    .filter-tabs { display: flex; gap: 0.25rem; margin-bottom: 1rem; }
    .filter-tabs button {
      padding: 0.4rem 1rem; border: 1px solid #ddd; background: white;
      border-radius: 4px; cursor: pointer; font-size: 0.85rem;
    }
    .filter-tabs button.active { background: #4040ff; color: white; border-color: #4040ff; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
    .alert-success { background: #e8ffe8; color: #008000; border: 1px solid #b0e0b0; }
    .alert-error { background: #ffe8e8; color: #cc0000; border: 1px solid #e0b0b0; }
    .form-panel {
      background: white; padding: 1.5rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-bottom: 1.5rem;
    }
    .form-panel h2 { margin: 0 0 1rem; font-size: 1.1rem; }
    .field { margin-bottom: 1rem; }
    .field label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.9rem; }
    .field input, .field textarea {
      width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;
      font-size: 0.9rem; box-sizing: border-box;
    }
    .field-error { color: #cc0000; font-size: 0.8rem; }
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
    .btn-warn {
      padding: 0.5rem 1.25rem; background: #ff6b35; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .list { display: flex; flex-direction: column; gap: 0.75rem; }
    .job-card {
      background: white; padding: 1.25rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .job-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .job-header h3 { margin: 0; }
    .status-badge {
      padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem;
      font-weight: 600; text-transform: capitalize;
    }
    .status-badge[data-status="draft"] { background: #e8e8e8; color: #666; }
    .status-badge[data-status="active"] { background: #e8ffe8; color: #008000; }
    .status-badge[data-status="closed"] { background: #ffe8e8; color: #cc0000; }
    .status-badge[data-status="archived"] { background: #f0f0f0; color: #999; }
    .job-desc { margin: 0 0 0.5rem; color: #666; font-size: 0.9rem; }
    .job-tags { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .tag { padding: 0.15rem 0.5rem; background: #e0e0ff; color: #4040ff; border-radius: 12px; font-size: 0.75rem; }
    .job-actions { display: flex; gap: 0.5rem; }
    .btn-sm { padding: 0.3rem 0.75rem; font-size: 0.8rem; border-radius: 4px; cursor: pointer; }
    .btn-sm.btn-primary { background: #4040ff; color: white; border: none; }
    .btn-sm.btn-secondary { background: white; color: #333; border: 1px solid #ddd; }
    .btn-sm.btn-warn { background: #ff6b35; color: white; border: none; }
  `]
})
export class JobListComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly jobSvc = inject(JobService);
  private readonly appSvc = inject(ApplicationService);
  private readonly fb = inject(FormBuilder);

  jobs = signal<Job[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);
  showCreateForm = signal(false);
  editingJob = signal<Job | null>(null);
  statusFilter = signal<string>('all');
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);

  isManagement = computed(() => {
    const role = this.session.activeRole();
    return role === UserRole.Employer || role === UserRole.HRCoordinator || role === UserRole.Administrator;
  });

  isCandidate = computed(() => {
    return this.session.activeRole() === UserRole.Candidate;
  });

  filteredJobs = computed(() => {
    const filter = this.statusFilter();
    const all = this.jobs();
    if (filter === 'all') return all;
    return all.filter(j => j.status === filter);
  });

  jobForm: FormGroup = this.fb.group({
    title: ['', Validators.required],
    description: ['', Validators.required],
    tags: [''],
    topics: [''],
  });

  ngOnInit(): void {
    this.loadJobs();
  }

  setFilter(filter: string): void {
    this.statusFilter.set(filter);
  }

  async loadJobs(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const ctx = this.session.requireAuth();
      if (ctx.activeRole === UserRole.Employer) {
        this.jobs.set(await this.jobSvc.listJobsByOwner(ctx.userId, ctx.userId, ctx.roles, ctx.organizationId));
      } else if (ctx.activeRole === UserRole.Candidate) {
        this.jobs.set(await this.jobSvc.listJobs(ctx.userId, ctx.roles, ctx.organizationId));
      } else {
        this.jobs.set(await this.jobSvc.listJobs(ctx.userId, ctx.roles, ctx.organizationId));
      }
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load jobs');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onCreateJob(): Promise<void> {
    if (this.jobForm.invalid) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const { title, description, tags, topics } = this.jobForm.value;
      const tagList = tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      const topicList = topics ? topics.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      await this.jobSvc.createJob(title, description, tagList, topicList, ctx.userId, ctx.roles, ctx.organizationId);
      this.showSuccess('Job created successfully');
      this.cancelForm();
      await this.loadJobs();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to create job');
      this.autoClearMessages();
    }
  }

  async onUpdateJob(): Promise<void> {
    const job = this.editingJob();
    if (!job || this.jobForm.invalid) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const { title, description, tags, topics } = this.jobForm.value;
      const tagList = tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      const topicList = topics ? topics.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      await this.jobSvc.updateJob(
        job.id, { title, description, tags: tagList, topics: topicList },
        ctx.userId, ctx.roles, ctx.organizationId, job.version,
      );
      this.showSuccess('Job updated successfully');
      this.cancelForm();
      await this.loadJobs();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to update job');
      this.autoClearMessages();
    }
  }

  async onPublish(job: Job): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.jobSvc.transitionJobStatus(job.id, JobStatus.Active, ctx.userId, ctx.roles, ctx.organizationId, job.version);
      this.showSuccess('Job published successfully');
      await this.loadJobs();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to publish job');
      this.autoClearMessages();
    }
  }

  async onClose(job: Job): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.jobSvc.transitionJobStatus(job.id, JobStatus.Closed, ctx.userId, ctx.roles, ctx.organizationId, job.version);
      this.showSuccess('Job closed successfully');
      await this.loadJobs();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to close job');
      this.autoClearMessages();
    }
  }

  async onApply(job: Job): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.appSvc.createApplication(job.id, ctx.userId, ctx.organizationId, ctx.roles);
      this.showSuccess('Application submitted successfully');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to apply');
      this.autoClearMessages();
    }
  }

  startEdit(job: Job): void {
    this.editingJob.set(job);
    this.showCreateForm.set(false);
    this.jobForm.patchValue({
      title: job.title,
      description: job.description,
      tags: job.tags.join(', '),
      topics: job.topics.join(', '),
    });
  }

  cancelForm(): void {
    this.editingJob.set(null);
    this.showCreateForm.set(false);
    this.jobForm.reset();
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
