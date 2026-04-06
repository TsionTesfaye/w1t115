import { Component, inject, signal, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../../core/services/session.service';
import { ApplicationService } from '../../../core/services/application.service';
import { InterviewService } from '../../../core/services/interview.service';
import { JobService } from '../../../core/services/job.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UserService } from '../../../core/services/user.service';
import { ModerationService } from '../../../core/services/moderation.service';
import { DocumentService } from '../../../core/services/document.service';
import { ContentService } from '../../../core/services/content.service';
import { UserRole, InterviewStatus, JobStatus, ApplicationStatus, ApplicationStage, ContentPostStatus } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent } from '../../../shared/components/page-states.component';

interface DashboardCard {
  label: string;
  value: string | number;
  sub?: string;
  route: string;
  action: string;
  color: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, LoadingStateComponent, ErrorStateComponent],
  template: `
    <div class="dashboard">
      <header class="dash-header">
        <div>
          <h1 class="dash-title">Dashboard</h1>
          <p class="dash-welcome">
            Welcome back, <strong>{{ session.currentUser()?.displayName }}</strong>
            <span class="dash-role">— {{ formatRole(session.activeRole() ?? '') }}</span>
          </p>
        </div>
      </header>

      @if (isLoading()) {
        <app-loading-state message="Loading your dashboard…" />
      } @else if (error()) {
        <app-error-state [message]="error()!" [retryFn]="loadDashboard.bind(this)" />
      } @else {
        <div class="card-grid">
          @for (card of cards(); track card.route) {
            <div class="dash-card" [attr.data-color]="card.color">
              <div class="card-value" [attr.aria-label]="card.label + ': ' + card.value">
                {{ card.value }}
              </div>
              <div class="card-label">{{ card.label }}</div>
              @if (card.sub) {
                <div class="card-sub">{{ card.sub }}</div>
              }
              <a [routerLink]="card.route" class="card-action">{{ card.action }} →</a>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .dashboard { max-width: 1100px; }
    .dash-header { margin-bottom: 1.5rem; }
    .dash-title { margin: 0; font-size: 1.5rem; }
    .dash-welcome { color: #666; margin: 0.25rem 0 0; font-size: 0.95rem; }
    .dash-role { color: #888; font-weight: 400; }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1rem;
    }
    .dash-card {
      background: white;
      border-radius: 10px;
      padding: 1.5rem;
      box-shadow: 0 1px 6px rgba(0,0,0,0.06);
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      border-top: 3px solid #e0e0e0;
      transition: box-shadow 0.15s;
    }
    .dash-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .dash-card[data-color="blue"] { border-top-color: #4040ff; }
    .dash-card[data-color="green"] { border-top-color: #22aa44; }
    .dash-card[data-color="orange"] { border-top-color: #ff8800; }
    .dash-card[data-color="purple"] { border-top-color: #9040ff; }
    .dash-card[data-color="teal"] { border-top-color: #00aaaa; }
    .dash-card[data-color="red"] { border-top-color: #cc2222; }
    .card-value { font-size: 2rem; font-weight: 700; color: #1a1a2e; line-height: 1; }
    .card-label { font-size: 0.85rem; color: #666; font-weight: 500; }
    .card-sub { font-size: 0.78rem; color: #999; }
    .card-action {
      margin-top: 0.75rem;
      font-size: 0.82rem;
      color: #4040ff;
      text-decoration: none;
      font-weight: 500;
    }
    .card-action:hover { text-decoration: underline; }
  `],
})
export class DashboardComponent implements OnInit {
  readonly session = inject(SessionService);
  private readonly appSvc = inject(ApplicationService);
  private readonly interviewSvc = inject(InterviewService);
  private readonly jobSvc = inject(JobService);
  private readonly notifSvc = inject(NotificationService);
  private readonly userSvc = inject(UserService);
  private readonly modSvc = inject(ModerationService);
  private readonly docSvc = inject(DocumentService);
  private readonly contentSvc = inject(ContentService);

  isLoading = signal(false);
  error = signal<string | null>(null);
  cards = signal<DashboardCard[]>([]);

  /**
   * Monotonically increasing request version.
   * Prevents stale async results from overwriting newer data when the user
   * switches roles faster than the async loads complete.
   */
  private _loadVersion = 0;

  constructor() {
    effect(() => {
      const role = this.session.activeRole();
      if (role && this.session.isAuthenticated()) {
        void this.loadDashboard();
      }
    });
  }

  ngOnInit(): void {
    // Initial load is handled by the effect above.
  }

  async loadDashboard(): Promise<void> {
    if (!this.session.isAuthenticated()) return;
    const version = ++this._loadVersion;
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const { userId, organizationId, roles, activeRole } = this.session.requireAuth();
      const newCards = await this.buildCards(activeRole, userId, organizationId, roles);
      // Guard: if another load started while we were awaiting, discard this result.
      if (version !== this._loadVersion) return;
      this.cards.set(newCards);
    } catch (e: any) {
      if (version !== this._loadVersion) return;
      this.error.set(e.message ?? 'Failed to load dashboard');
    } finally {
      if (version === this._loadVersion) {
        this.isLoading.set(false);
      }
    }
  }

  private async buildCards(
    role: UserRole,
    userId: string,
    orgId: string,
    roles: UserRole[],
  ): Promise<DashboardCard[]> {
    switch (role) {
      case UserRole.Candidate: {
        const [apps, interviews, unread, docs] = await Promise.all([
          this.appSvc.listByCandidate(userId, userId, orgId).catch(() => []),
          this.interviewSvc.getByCandidate(userId, userId, roles, orgId).catch(() => []),
          this.notifSvc.getUnreadForUser(userId, userId, orgId).catch(() => []),
          this.docSvc.listByOwner(userId, userId, roles, orgId).catch(() => []),
        ]);
        const upcoming = interviews.filter(i => i.status === InterviewStatus.Scheduled);
        const active = apps.filter(a => a.status === ApplicationStatus.Active);
        return [
          { label: 'Active Applications', value: active.length, sub: `${apps.length} total`, route: '/applications', action: 'View applications', color: 'blue' },
          { label: 'Upcoming Interviews', value: upcoming.length, sub: upcoming.length === 0 ? 'None scheduled' : 'Scheduled', route: '/interviews', action: 'View interviews', color: 'green' },
          { label: 'Unread Notifications', value: unread.length, route: '/notifications', action: 'View all', color: 'orange' },
          { label: 'My Documents', value: docs.length, sub: docs.length === 0 ? 'No documents yet' : `${docs.length} uploaded`, route: '/documents', action: 'Manage documents', color: 'purple' },
        ];
      }

      case UserRole.Employer: {
        const [jobs, orgApps, unread, posts] = await Promise.all([
          this.jobSvc.listJobsByOwner(userId, userId, roles, orgId).catch(() => []),
          this.appSvc.listByOrganization(userId, roles, orgId).catch(() => []),
          this.notifSvc.getUnreadForUser(userId, userId, orgId).catch(() => []),
          this.contentSvc.listPosts(roles, orgId).catch(() => []),
        ]);
        const activeJobs = jobs.filter(j => j.status === JobStatus.Active);
        // Scope applications to this employer's jobs only
        const jobIds = new Set(jobs.map(j => j.id));
        const myApps = orgApps.filter(a => jobIds.has(a.jobId));
        const activeApps = myApps.filter(a => a.status === ApplicationStatus.Active);
        const submitted = activeApps.filter(a => a.stage === ApplicationStage.Submitted).length;
        const reviewing = activeApps.filter(a => a.stage === ApplicationStage.UnderReview).length;
        const interviewing = activeApps.filter(a =>
          a.stage === ApplicationStage.InterviewScheduled || a.stage === ApplicationStage.InterviewCompleted
        ).length;
        const stageSummary = [
          submitted > 0 ? `${submitted} submitted` : null,
          reviewing > 0 ? `${reviewing} reviewing` : null,
          interviewing > 0 ? `${interviewing} interviewing` : null,
        ].filter(Boolean).join(', ') || 'No active applications';

        return [
          { label: 'Active Job Postings', value: activeJobs.length, sub: `${jobs.length} total`, route: '/jobs', action: 'Manage jobs', color: 'blue' },
          { label: 'Applications Pipeline', value: activeApps.length, sub: stageSummary, route: '/applications', action: 'Review applications', color: 'green' },
          { label: 'Unread Notifications', value: unread.length, route: '/notifications', action: 'View all', color: 'orange' },
          { label: 'Content & Posts', value: posts.length, sub: posts.length === 0 ? 'No posts yet' : `${posts.length} total`, route: '/content', action: 'Manage content', color: 'teal' },
        ];
      }

      case UserRole.HRCoordinator: {
        const [jobs, interviews, unread, pending] = await Promise.all([
          this.jobSvc.listJobs(userId, roles, orgId).catch(() => []),
          this.interviewSvc.listByOrganization(userId, roles, orgId).catch(() => []),
          this.notifSvc.getUnreadForUser(userId, userId, orgId).catch(() => []),
          this.modSvc.getPendingComments(roles, orgId).catch(() => []),
        ]);
        const activeJobs = jobs.filter(j => j.status === JobStatus.Active);
        const scheduledInterviews = interviews.filter(i => i.status === InterviewStatus.Scheduled);
        return [
          { label: 'Active Jobs', value: activeJobs.length, sub: `${jobs.length} total in org`, route: '/jobs', action: 'View jobs', color: 'blue' },
          { label: 'Scheduled Interviews', value: scheduledInterviews.length, sub: `${interviews.length} total`, route: '/interviews', action: 'View interviews', color: 'green' },
          { label: 'Moderation Queue', value: pending.length, sub: pending.length > 0 ? 'Items pending review' : 'Queue clear', route: '/moderation', action: 'Review queue', color: pending.length > 0 ? 'red' : 'green' },
          { label: 'Unread Notifications', value: unread.length, route: '/notifications', action: 'View all', color: 'orange' },
        ];
      }

      case UserRole.Interviewer: {
        const [interviews, unread] = await Promise.all([
          this.interviewSvc.getByInterviewer(userId, userId, roles, orgId).catch(() => []),
          this.notifSvc.getUnreadForUser(userId, userId, orgId).catch(() => []),
        ]);
        const upcoming = interviews.filter(i => i.status === InterviewStatus.Scheduled);
        const needFeedback = interviews.filter(i => i.status === InterviewStatus.Completed);
        return [
          { label: 'Upcoming Interviews', value: upcoming.length, sub: upcoming.length === 0 ? 'None scheduled' : 'Requires your attendance', route: '/interviews', action: 'View schedule', color: 'blue' },
          { label: 'Awaiting Feedback', value: needFeedback.length, sub: needFeedback.length > 0 ? 'Please submit feedback' : 'All caught up', route: '/interviews', action: 'Submit feedback', color: needFeedback.length > 0 ? 'red' : 'green' },
          { label: 'Unread Notifications', value: unread.length, route: '/notifications', action: 'View all', color: 'orange' },
          { label: 'Messages', value: '—', sub: 'Inbox & conversations', route: '/message-center', action: 'Open messages', color: 'teal' },
        ];
      }

      case UserRole.Administrator: {
        const [users, jobs, unread] = await Promise.all([
          this.userSvc.listByOrganization(roles, orgId).catch(() => []),
          this.jobSvc.listJobs(userId, roles, orgId).catch(() => []),
          this.notifSvc.getUnreadForUser(userId, userId, orgId).catch(() => []),
        ]);
        return [
          { label: 'Org Users', value: users.length, sub: 'In your organization', route: '/admin', action: 'Manage users', color: 'blue' },
          { label: 'Total Job Postings', value: jobs.length, sub: `${jobs.filter(j => j.status === JobStatus.Active).length} active`, route: '/jobs', action: 'View jobs', color: 'green' },
          { label: 'Unread Notifications', value: unread.length, route: '/notifications', action: 'View all', color: 'orange' },
          { label: 'Governance & Audit', value: '—', sub: 'Logs, lineage, snapshots', route: '/governance', action: 'Open governance', color: 'purple' },
        ];
      }

      default:
        return [];
    }
  }

  formatRole(role: string): string {
    return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
