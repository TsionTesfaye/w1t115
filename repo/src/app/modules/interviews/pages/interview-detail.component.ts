import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { SessionService } from '../../../core/services/session.service';
import { InterviewService } from '../../../core/services/interview.service';
import { FeedbackService } from '../../../core/services/feedback.service';
import { Interview, InterviewFeedback } from '../../../core/models';
import { InterviewStatus, UserRole } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-interview-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent, DatePipe],
  template: `
    <div class="page">
      @if (actionSuccess()) {
        <div class="alert alert-success">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error">{{ actionError() }}</div>
      }

      @if (isLoading()) {
        <app-loading-state message="Loading interview..." />
      } @else if (error()) {
        <app-error-state [message]="error()!" [retryFn]="loadInterview.bind(this)" />
      } @else if (interview()) {
        <header class="page-header">
          <h1>Interview Details</h1>
        </header>

        <div class="detail-card">
          <div class="detail-row">
            <span class="label">Interview ID</span>
            <span class="mono">{{ interview()!.id }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Status</span>
            <span class="status-badge" [attr.data-status]="interview()!.status">{{ interview()!.status }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Application ID</span>
            <span class="mono">{{ interview()!.applicationId }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Interviewer ID</span>
            <span class="mono">{{ interview()!.interviewerId }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Candidate ID</span>
            <span class="mono">{{ interview()!.candidateId }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Start Time</span>
            <span>{{ interview()!.startTime | date:'medium' }}</span>
          </div>
          <div class="detail-row">
            <span class="label">End Time</span>
            <span>{{ interview()!.endTime | date:'medium' }}</span>
          </div>
          @if (interview()!.rescheduledAt) {
            <div class="detail-row">
              <span class="label">Rescheduled</span>
              <span>{{ interview()!.rescheduledAt | date:'medium' }}</span>
            </div>
          }
        </div>

        <div class="actions">
          @if (canComplete()) {
            <button class="btn-primary" (click)="onComplete()">Mark Complete</button>
          }
          @if (isManagement() && interview()!.status === 'scheduled') {
            <button class="btn-danger" (click)="onCancel()">Cancel Interview</button>
          }
          <button class="btn-secondary" (click)="goBack()">Back</button>
        </div>

        @if (showFeedbackForm()) {
          <div class="form-panel">
            <h2>Submit Feedback</h2>
            <form [formGroup]="feedbackForm" (ngSubmit)="onSubmitFeedback()">
              <div class="field">
                <label for="score">Score (1-10) *</label>
                <input id="score" type="number" formControlName="score" min="1" max="10">
              </div>
              <div class="field">
                <label for="notes">Notes</label>
                <textarea id="notes" formControlName="notes" rows="4"></textarea>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn-primary" [disabled]="feedbackForm.invalid">Submit Feedback</button>
              </div>
            </form>
          </div>
        }

        @if (feedbackList().length > 0) {
          <div class="feedback-section">
            <h2>Feedback</h2>
            @for (fb of feedbackList(); track fb.id) {
              <div class="feedback-card">
                <div class="feedback-header">
                  <span class="feedback-score">Score: {{ fb.score }}/10</span>
                  <span class="feedback-date">{{ fb.submittedAt | date:'medium' }}</span>
                </div>
                <p class="feedback-notes">{{ fb.notes }}</p>
                <span class="mono feedback-by">By: {{ fb.interviewerId }}</span>
              </div>
            }
          </div>
        }
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
    .status-badge[data-status="scheduled"] { background: #e0e0ff; color: #4040ff; }
    .status-badge[data-status="completed"] { background: #e8ffe8; color: #008000; }
    .status-badge[data-status="canceled"] { background: #ffe8e8; color: #cc0000; }
    .actions { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
    .form-panel {
      background: white; padding: 1.5rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-bottom: 1.5rem;
    }
    .form-panel h2 { margin: 0 0 1rem; font-size: 1.1rem; }
    .field { margin-bottom: 1rem; }
    .field label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.9rem; }
    .field input, .field textarea {
      width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;
      font-size: 0.9rem; box-sizing: border-box; font-family: inherit;
    }
    .form-actions { display: flex; gap: 0.5rem; }
    .feedback-section { margin-top: 1.5rem; }
    .feedback-section h2 { margin: 0 0 1rem; font-size: 1.1rem; }
    .feedback-card {
      background: white; padding: 1rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-bottom: 0.75rem;
    }
    .feedback-header { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
    .feedback-score { font-weight: 600; color: #4040ff; }
    .feedback-date { font-size: 0.85rem; color: #666; }
    .feedback-notes { margin: 0 0 0.5rem; color: #444; }
    .feedback-by { font-size: 0.8rem; color: #999; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
    .alert-success { background: #e8ffe8; color: #008000; border: 1px solid #b0e0b0; }
    .alert-error { background: #ffe8e8; color: #cc0000; border: 1px solid #e0b0b0; }
    .btn-primary {
      padding: 0.5rem 1.25rem; background: #4040ff; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      padding: 0.5rem 1.25rem; background: white; color: #333;
      border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .btn-danger {
      padding: 0.5rem 1.25rem; background: #cc0000; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
  `]
})
export class InterviewDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly interviewSvc = inject(InterviewService);
  private readonly feedbackSvc = inject(FeedbackService);
  private readonly fb = inject(FormBuilder);

  interview = signal<Interview | null>(null);
  feedbackList = signal<InterviewFeedback[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);

  feedbackForm = this.fb.group({
    score: [5, [Validators.required, Validators.min(1), Validators.max(10)]],
    notes: [''],
  });

  isManagement = computed(() => {
    const role = this.session.activeRole();
    return role === UserRole.Employer || role === UserRole.HRCoordinator || role === UserRole.Administrator;
  });

  isInterviewer = computed(() => this.session.activeRole() === UserRole.Interviewer);

  canComplete = computed(() => {
    const iv = this.interview();
    if (!iv || iv.status !== InterviewStatus.Scheduled) return false;
    if (this.isManagement()) return true;
    if (this.isInterviewer()) {
      const ctx = this.session.requireAuth();
      return iv.interviewerId === ctx.userId;
    }
    return false;
  });

  showFeedbackForm = computed(() => {
    const iv = this.interview();
    if (!iv || iv.status !== InterviewStatus.Completed) return false;
    if (!this.isInterviewer()) return false;
    const ctx = this.session.requireAuth();
    if (iv.interviewerId !== ctx.userId) return false;
    // Don't show if already submitted
    return !this.feedbackList().some(f => f.interviewerId === ctx.userId);
  });

  ngOnInit(): void {
    this.loadInterview();
  }

  async loadInterview(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const ctx = this.session.requireAuth();
      const interviewId = this.route.snapshot.paramMap.get('interviewId')!;
      // We need to get the interview - use getByInterviewer/getByCandidate and find it
      // Since there's no direct getById exposed on the service, we'll use the appropriate method
      let interviews: Interview[] = [];
      if (this.isManagement()) {
        interviews = await this.interviewSvc.listByOrganization(ctx.userId, ctx.roles, ctx.organizationId);
      } else if (ctx.activeRole === UserRole.Interviewer) {
        interviews = await this.interviewSvc.getByInterviewer(ctx.userId, ctx.userId, ctx.roles, ctx.organizationId);
      } else if (ctx.activeRole === UserRole.Candidate) {
        interviews = await this.interviewSvc.getByCandidate(ctx.userId, ctx.userId, ctx.roles, ctx.organizationId);
      }
      const found = interviews.find(i => i.id === interviewId);
      if (!found) throw new Error('Interview not found or not accessible');
      this.interview.set(found);

      // Load feedback if allowed
      await this.loadFeedback(interviewId, ctx);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load interview');
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadFeedback(interviewId: string, ctx: { userId: string; roles: UserRole[]; organizationId: string }): Promise<void> {
    try {
      const feedback = await this.feedbackSvc.getFeedbackForInterview(interviewId, ctx.userId, ctx.roles, ctx.organizationId);
      this.feedbackList.set(feedback);
    } catch {
      // Non-critical: candidates can't see feedback, that's expected
      this.feedbackList.set([]);
    }
  }

  async onComplete(): Promise<void> {
    const iv = this.interview();
    if (!iv) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const updated = await this.interviewSvc.completeInterview(iv.id, ctx.userId, ctx.roles, ctx.organizationId, iv.version);
      this.interview.set(updated);
      this.showSuccess('Interview marked as completed');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to complete interview');
      this.autoClearMessages();
    }
  }

  async onCancel(): Promise<void> {
    const iv = this.interview();
    if (!iv) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const updated = await this.interviewSvc.cancelInterview(iv.id, ctx.userId, ctx.roles, ctx.organizationId, iv.version);
      this.interview.set(updated);
      this.showSuccess('Interview canceled');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to cancel interview');
      this.autoClearMessages();
    }
  }

  async onSubmitFeedback(): Promise<void> {
    const iv = this.interview();
    if (!iv || this.feedbackForm.invalid) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const { score, notes } = this.feedbackForm.value;
      const feedback = await this.feedbackSvc.submitFeedback(
        iv.id, score!, notes ?? '', ctx.userId, ctx.roles, ctx.organizationId,
      );
      this.feedbackList.update(list => [...list, feedback]);
      this.feedbackForm.reset({ score: 5, notes: '' });
      this.showSuccess('Feedback submitted');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to submit feedback');
      this.autoClearMessages();
    }
  }

  goBack(): void {
    this.router.navigate(['/interviews']);
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
