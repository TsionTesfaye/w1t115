import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { SessionService } from '../../../core/services/session.service';
import { ContentService } from '../../../core/services/content.service';
import { ModerationService } from '../../../core/services/moderation.service';
import { ContentPost, Comment } from '../../../core/models';
import { ContentPostStatus, UserRole } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-content-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent, DatePipe],
  template: `
    <div class="page">
      <header class="page-header">
        <h1>Content Publishing</h1>
        @if (isManagement()) {
          <button class="btn-primary" (click)="showCreateForm.set(!showCreateForm())">
            {{ showCreateForm() ? 'Cancel' : 'Create Post' }}
          </button>
        }
      </header>

      @if (actionSuccess()) {
        <div class="alert alert-success" role="status">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error" role="alert">{{ actionError() }}</div>
      }

      @if (showCreateForm() && isManagement()) {
        <div class="form-panel">
          <h2>Create Post</h2>
          <form [formGroup]="postForm" (ngSubmit)="onCreatePost()">
            <div class="field">
              <label for="title">Title *</label>
              <input id="title" formControlName="title">
            </div>
            <div class="field">
              <label for="body">Body</label>
              <textarea id="body" formControlName="body" rows="6"></textarea>
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
              <button type="submit" class="btn-primary" [disabled]="postForm.invalid">Create Draft</button>
            </div>
          </form>
        </div>
      }

      @if (isManagement()) {
        <div class="filter-tabs">
          <button [class.active]="statusFilter() === 'all'" (click)="setFilter('all')">All</button>
          <button [class.active]="statusFilter() === 'draft'" (click)="setFilter('draft')">Draft</button>
          <button [class.active]="statusFilter() === 'scheduled'" (click)="setFilter('scheduled')">Scheduled</button>
          <button [class.active]="statusFilter() === 'published'" (click)="setFilter('published')">Published</button>
          <button [class.active]="statusFilter() === 'archived'" (click)="setFilter('archived')">Archived</button>
        </div>
      }

      @if (isLoading()) {
        <app-loading-state message="Loading content..." />
      } @else if (error()) {
        <app-error-state [message]="error()!" [retryFn]="loadPosts.bind(this)" />
      } @else if (filteredPosts().length === 0) {
        <app-empty-state message="No content published yet" />
      } @else {
        <div class="list">
          @for (post of filteredPosts(); track post.id) {
            <div class="post-card">
              <div class="post-header">
                <h3>{{ post.title }}</h3>
                <div class="post-badges">
                  <span class="status-badge" [attr.data-status]="post.status">{{ post.status }}</span>
                  @if (post.pinnedUntil && isPinActive(post.pinnedUntil)) {
                    <span class="pin-badge">Pinned</span>
                  }
                </div>
              </div>
              <p class="post-body">{{ post.body | slice:0:200 }}{{ post.body.length > 200 ? '...' : '' }}</p>
              @if (post.tags.length > 0) {
                <div class="tags-row">
                  @for (tag of post.tags; track tag) {
                    <span class="tag">{{ tag }}</span>
                  }
                </div>
              }
              <div class="post-meta">
                <span>Created: {{ post.createdAt | date:'short' }}</span>
                @if (post.scheduledPublishAt) {
                  <span>Scheduled: {{ post.scheduledPublishAt | date:'short' }}</span>
                }
              </div>

              @if (isManagement()) {
                <div class="post-actions">
                  @if (post.status === 'draft') {
                    <button class="btn-sm btn-primary" (click)="onPublish(post)">Publish</button>

                    <!-- Inline schedule picker — replaces the Schedule button -->
                    @if (schedulingPostId() === post.id) {
                      <div class="schedule-picker">
                        <input
                          type="datetime-local"
                          [min]="minScheduleTime()"
                          (input)="scheduleInputValue.set($any($event.target).value)"
                          aria-label="Schedule date and time"
                        >
                        <button
                          class="btn-sm btn-primary"
                          (click)="onConfirmSchedule(post)"
                          [disabled]="!scheduleInputValue()"
                        >Confirm</button>
                        <button class="btn-sm btn-secondary" (click)="onCancelSchedule()">Cancel</button>
                      </div>
                    } @else {
                      <button class="btn-sm btn-secondary" (click)="onOpenSchedulePicker(post)">Schedule</button>
                    }
                  }
                  @if (post.status === 'scheduled') {
                    <button class="btn-sm btn-primary" (click)="onPublish(post)">Publish Now</button>
                  }
                  @if (post.status === 'published') {
                    <button class="btn-sm btn-warn" (click)="onArchive(post)">Archive</button>
                    @if (!post.pinnedUntil || !isPinActive(post.pinnedUntil)) {
                      <button class="btn-sm btn-secondary" (click)="onPin(post)">Pin (7 days)</button>
                    }
                  }
                </div>
              }

              <!-- ── Comments section (published posts) ──────────────── -->
              @if (post.status === 'published') {
                <div class="comments-section">
                  <button
                    class="btn-sm btn-secondary comments-toggle"
                    (click)="onToggleComments(post)"
                    [attr.aria-expanded]="expandedPostId() === post.id"
                  >
                    {{ expandedPostId() === post.id ? 'Hide Comments' : 'Comments' }}
                    @if (commentCounts()[post.id] !== undefined) {
                      <span class="comment-count">{{ commentCounts()[post.id] }}</span>
                    }
                  </button>

                  @if (expandedPostId() === post.id) {
                    <div class="comments-panel">
                      @if (commentsLoading()) {
                        <p class="comments-meta">Loading comments…</p>
                      } @else {
                        @if ((postComments()[post.id] ?? []).length === 0) {
                          <p class="comments-meta">No comments yet.</p>
                        } @else {
                          <div class="comments-list">
                            @for (c of postComments()[post.id]; track c.id) {
                              <div class="comment-item">
                                <div class="comment-meta-row">
                                  <span class="comment-author">{{ formatAuthorId(c.authorId) }}</span>
                                  <span class="comment-date">{{ c.createdAt | date:'short' }}</span>
                                </div>
                                <p class="comment-text">{{ c.content }}</p>
                              </div>
                            }
                          </div>
                        }
                      }

                      <!-- Submit comment form -->
                      <div class="comment-form">
                        <textarea
                          class="comment-input"
                          [value]="commentDraft()"
                          (input)="commentDraft.set($any($event.target).value)"
                          placeholder="Write a comment…"
                          rows="2"
                          [disabled]="submittingPostId() === post.id"
                        ></textarea>
                        <button
                          class="btn-sm btn-primary"
                          (click)="onSubmitComment(post)"
                          [disabled]="!commentDraft().trim() || submittingPostId() === post.id"
                        >
                          {{ submittingPostId() === post.id ? 'Posting…' : 'Post Comment' }}
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 1200px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .page-header h1 { margin: 0; }
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
      font-size: 0.9rem; box-sizing: border-box; font-family: inherit;
    }
    .form-actions { display: flex; gap: 0.5rem; }
    .list { display: flex; flex-direction: column; gap: 0.75rem; }
    .post-card {
      background: white; padding: 1.25rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .post-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .post-header h3 { margin: 0; }
    .post-badges { display: flex; gap: 0.25rem; }
    .status-badge {
      padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem;
      font-weight: 600; text-transform: capitalize;
    }
    .status-badge[data-status="draft"] { background: #e8e8e8; color: #666; }
    .status-badge[data-status="scheduled"] { background: #fff3e0; color: #e65100; }
    .status-badge[data-status="published"] { background: #e8ffe8; color: #008000; }
    .status-badge[data-status="archived"] { background: #f0f0f0; color: #999; }
    .pin-badge { padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; background: #fff8e1; color: #f57f17; }
    .post-body { margin: 0 0 0.5rem; color: #666; font-size: 0.9rem; line-height: 1.5; }
    .tags-row { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .tag { padding: 0.15rem 0.5rem; background: #e0e0ff; color: #4040ff; border-radius: 12px; font-size: 0.75rem; }
    .post-meta { color: #999; font-size: 0.8rem; display: flex; gap: 1rem; margin-bottom: 0.5rem; }
    .post-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-bottom: 0.5rem; }

    /* Schedule picker */
    .schedule-picker {
      display: flex; gap: 0.4rem; align-items: center;
      background: #f8f8ff; border: 1px solid #ddd; border-radius: 6px;
      padding: 0.4rem 0.6rem;
    }
    .schedule-picker input[type="datetime-local"] {
      border: 1px solid #ddd; border-radius: 4px; padding: 0.3rem 0.5rem;
      font-size: 0.85rem; color: #333;
    }

    /* Comments section */
    .comments-section { border-top: 1px solid #f0f0f0; padding-top: 0.75rem; margin-top: 0.5rem; }
    .comments-toggle { display: inline-flex; align-items: center; gap: 0.4rem; }
    .comment-count {
      background: #4040ff; color: white; border-radius: 10px;
      padding: 0.1rem 0.4rem; font-size: 0.7rem; font-weight: 700;
    }
    .comments-panel { margin-top: 0.75rem; }
    .comments-meta { color: #999; font-size: 0.85rem; margin: 0.25rem 0; }
    .comments-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
    .comment-item {
      background: #f9f9f9; border-radius: 6px; padding: 0.5rem 0.75rem;
      border-left: 3px solid #e0e0ff;
    }
    .comment-meta-row { display: flex; gap: 1rem; font-size: 0.8rem; color: #999; margin-bottom: 0.2rem; }
    .comment-author { color: #4040ff; font-weight: 600; }
    .comment-text { margin: 0; font-size: 0.9rem; color: #333; line-height: 1.4; }
    .comment-form { display: flex; flex-direction: column; gap: 0.5rem; }
    .comment-input {
      width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;
      font-size: 0.9rem; font-family: inherit; resize: vertical; box-sizing: border-box;
    }
    .comment-input:disabled { background: #f5f5f5; cursor: not-allowed; }

    /* Buttons */
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
    .btn-sm { padding: 0.3rem 0.75rem; font-size: 0.8rem; border-radius: 4px; cursor: pointer; }
    .btn-sm.btn-primary { background: #4040ff; color: white; border: none; }
    .btn-sm.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-sm.btn-secondary { background: white; color: #333; border: 1px solid #ddd; }
    .btn-sm.btn-warn { background: #ff6b35; color: white; border: none; }
  `]
})
export class ContentListComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly contentSvc = inject(ContentService);
  private readonly modSvc = inject(ModerationService);
  private readonly fb = inject(FormBuilder);

  posts = signal<ContentPost[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);
  showCreateForm = signal(false);
  statusFilter = signal<string>('all');
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);

  // Scheduling
  schedulingPostId = signal<string | null>(null);
  scheduleInputValue = signal('');

  // Comments
  expandedPostId = signal<string | null>(null);
  postComments = signal<Record<string, Comment[]>>({});
  commentCounts = signal<Record<string, number>>({});
  commentsLoading = signal(false);
  commentDraft = signal('');
  submittingPostId = signal<string | null>(null);

  isManagement = computed(() => {
    const role = this.session.activeRole();
    return role === UserRole.Employer || role === UserRole.HRCoordinator || role === UserRole.Administrator;
  });

  filteredPosts = computed(() => {
    const filter = this.statusFilter();
    const all = this.posts();
    if (filter === 'all') return all;
    return all.filter(p => p.status === filter);
  });

  postForm = this.fb.group({
    title: ['', Validators.required],
    body: [''],
    tags: [''],
    topics: [''],
  });

  ngOnInit(): void {
    this.loadPosts();
  }

  setFilter(filter: string): void {
    this.statusFilter.set(filter);
  }

  isPinActive(pinnedUntil: string): boolean {
    return new Date(pinnedUntil).getTime() > Date.now();
  }

  /** Returns the current local datetime formatted for a datetime-local input min attribute. */
  minScheduleTime(): string {
    const now = new Date();
    // Adjust for local timezone offset so the min matches the user's local time
    const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return localNow.toISOString().slice(0, 16);
  }

  async loadPosts(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const ctx = this.session.requireAuth();
      const posts = await this.contentSvc.listPosts(ctx.roles, ctx.organizationId);
      this.posts.set(posts);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load content');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onCreatePost(): Promise<void> {
    if (this.postForm.invalid) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const { title, body, tags, topics } = this.postForm.value;
      const tagList = tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      const topicList = topics ? topics.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      await this.contentSvc.createPost(title!, body ?? '', tagList, topicList, ctx.userId, ctx.roles, ctx.organizationId);
      this.showSuccess('Post created as draft');
      this.showCreateForm.set(false);
      this.postForm.reset();
      await this.loadPosts();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to create post');
      this.autoClearMessages();
    }
  }

  async onPublish(post: ContentPost): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.contentSvc.transitionStatus(
        post.id, ContentPostStatus.Published, ctx.userId, ctx.roles, ctx.organizationId, post.version,
      );
      this.showSuccess('Post published');
      await this.loadPosts();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to publish');
      this.autoClearMessages();
    }
  }

  /** Open the inline scheduling picker for a post (replaces the old hardcoded +24h approach). */
  onOpenSchedulePicker(post: ContentPost): void {
    this.schedulingPostId.set(post.id);
    this.scheduleInputValue.set('');
  }

  onCancelSchedule(): void {
    this.schedulingPostId.set(null);
    this.scheduleInputValue.set('');
  }

  /** Confirm schedule with the user-selected date/time. */
  async onConfirmSchedule(post: ContentPost): Promise<void> {
    const timeValue = this.scheduleInputValue();
    if (!timeValue) return;

    // datetime-local gives "YYYY-MM-DDTHH:MM" in local time; parse to UTC ISO string
    const scheduledAt = new Date(timeValue).toISOString();
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      this.actionError.set('Scheduled time must be in the future');
      this.autoClearMessages();
      return;
    }

    this.schedulingPostId.set(null);
    this.scheduleInputValue.set('');
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.contentSvc.transitionStatus(
        post.id, ContentPostStatus.Scheduled, ctx.userId, ctx.roles, ctx.organizationId, post.version, scheduledAt,
      );
      this.showSuccess(`Post scheduled for ${new Date(scheduledAt).toLocaleString()}`);
      await this.loadPosts();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to schedule');
      this.autoClearMessages();
    }
  }

  async onArchive(post: ContentPost): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.contentSvc.transitionStatus(
        post.id, ContentPostStatus.Archived, ctx.userId, ctx.roles, ctx.organizationId, post.version,
      );
      this.showSuccess('Post archived');
      await this.loadPosts();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to archive');
      this.autoClearMessages();
    }
  }

  async onPin(post: ContentPost): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.contentSvc.pinPost(post.id, ctx.userId, ctx.roles, ctx.organizationId, post.version);
      this.showSuccess('Post pinned for 7 days');
      await this.loadPosts();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to pin');
      this.autoClearMessages();
    }
  }

  // ── Comments ────────────────────────────────────────────────────────────────

  async onToggleComments(post: ContentPost): Promise<void> {
    if (this.expandedPostId() === post.id) {
      this.expandedPostId.set(null);
      this.commentDraft.set('');
      return;
    }
    this.expandedPostId.set(post.id);
    this.commentDraft.set('');
    await this._loadComments(post.id);
  }

  async onSubmitComment(post: ContentPost): Promise<void> {
    const content = this.commentDraft().trim();
    if (!content) return;
    this.submittingPostId.set(post.id);
    try {
      const ctx = this.session.requireAuth();
      await this.modSvc.submitComment(post.id, content, ctx.userId, ctx.organizationId);
      this.commentDraft.set('');
      // Reload comments to show the new one (if it auto-approved) or show pending notice
      await this._loadComments(post.id);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to post comment');
      this.autoClearMessages();
    } finally {
      this.submittingPostId.set(null);
    }
  }

  formatAuthorId(authorId: string): string {
    // Show a short readable identifier rather than the raw UUID
    return `User #${authorId.slice(0, 6)}`;
  }

  private async _loadComments(postId: string): Promise<void> {
    this.commentsLoading.set(true);
    try {
      const ctx = this.session.requireAuth();
      const comments = await this.modSvc.getCommentsForPost(postId, ctx.organizationId, ctx.roles);
      this.postComments.update(prev => ({ ...prev, [postId]: comments }));
      this.commentCounts.update(prev => ({ ...prev, [postId]: comments.length }));
    } catch {
      // Non-fatal — leave previous comment state intact
    } finally {
      this.commentsLoading.set(false);
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
