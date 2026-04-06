import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { SessionService } from '../../../core/services/session.service';
import { ModerationService } from '../../../core/services/moderation.service';
import { Comment } from '../../../core/models';
import { ModerationDecision } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-moderation-panel',
  standalone: true,
  imports: [CommonModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent, DatePipe],
  template: `
    <div class="page">
      <header class="page-header">
        <h1>Moderation Panel</h1>
        @if (pendingComments().length > 0) {
          <span class="queue-badge">{{ pendingComments().length }} pending</span>
        }
      </header>

      @if (actionSuccess()) {
        <div class="alert alert-success" role="status">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error" role="alert">{{ actionError() }}</div>
      }

      <div class="panel-layout" [class.drawer-open]="!!selectedComment()">
        <!-- ── Queue list ─────────────────────────────────────────────── -->
        <div class="queue-panel">
          @if (isLoading()) {
            <app-loading-state message="Loading moderation queue..." />
          } @else if (error()) {
            <app-error-state [message]="error()!" [retryFn]="loadPending.bind(this)" />
          } @else if (pendingComments().length === 0) {
            <app-empty-state message="No items pending moderation" />
          } @else {
            <div class="list">
              @for (comment of pendingComments(); track comment.id) {
                <div
                  class="mod-card"
                  [class.selected]="selectedComment()?.id === comment.id"
                  (click)="onOpenDrawer(comment)"
                  role="button"
                  tabindex="0"
                  (keydown.enter)="onOpenDrawer(comment)"
                  (keydown.space)="onOpenDrawer(comment)"
                  [attr.aria-label]="'Review comment from author ' + comment.authorId"
                >
                  <div class="mod-header">
                    <span class="comment-id mono">{{ comment.id | slice:0:8 }}…</span>
                    <span class="comment-date">{{ comment.createdAt | date:'short' }}</span>
                  </div>
                  <div class="comment-content">{{ comment.content | slice:0:160 }}{{ comment.content.length > 160 ? '…' : '' }}</div>
                  <div class="comment-meta">
                    <span>Author: <strong>{{ comment.authorId | slice:0:8 }}</strong></span>
                    <span>Post: <strong>{{ comment.postId | slice:0:8 }}</strong></span>
                  </div>
                  <div class="card-quick-actions" (click)="$event.stopPropagation()">
                    <button class="btn-sm btn-approve" (click)="onApprove(comment)">Approve</button>
                    <button class="btn-sm btn-reject" (click)="onReject(comment)">Reject</button>
                    <button class="btn-sm btn-review" (click)="onOpenDrawer(comment)">Review →</button>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- ── Review drawer ──────────────────────────────────────────── -->
        @if (selectedComment()) {
          <aside class="review-drawer" role="complementary" aria-label="Comment review drawer">
            <div class="drawer-header">
              <h2>Review Comment</h2>
              <button class="close-btn" (click)="onCloseDrawer()" aria-label="Close review drawer">✕</button>
            </div>

            <div class="drawer-body">
              <div class="detail-section">
                <h3 class="section-label">Comment Content</h3>
                <div class="comment-full">{{ selectedComment()!.content }}</div>
              </div>

              <div class="detail-grid">
                <div class="detail-row">
                  <span class="detail-label">Author ID</span>
                  <span class="detail-value mono">{{ selectedComment()!.authorId }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Post ID</span>
                  <span class="detail-value mono">{{ selectedComment()!.postId }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Submitted</span>
                  <span class="detail-value">{{ selectedComment()!.createdAt | date:'medium' }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Status</span>
                  <span class="detail-value status-chip">{{ selectedComment()!.status }}</span>
                </div>
              </div>

              <div class="reason-section">
                <label for="drawerReason" class="section-label">Decision Reason</label>
                <textarea
                  id="drawerReason"
                  class="reason-textarea"
                  rows="3"
                  placeholder="Reason for approval or rejection…"
                  [value]="drawerReason()"
                  (input)="drawerReason.set($any($event.target).value)"
                ></textarea>
              </div>

              <div class="drawer-actions">
                <button
                  class="btn-full btn-approve-full"
                  (click)="onApproveSelected()"
                  [disabled]="drawerSubmitting()"
                >
                  {{ drawerSubmitting() ? 'Processing…' : 'Approve' }}
                </button>
                <button
                  class="btn-full btn-reject-full"
                  (click)="onRejectSelected()"
                  [disabled]="drawerSubmitting()"
                >
                  {{ drawerSubmitting() ? 'Processing…' : 'Reject' }}
                </button>
              </div>
            </div>
          </aside>
        }
      </div>
    </div>
  `,
  styles: [`
    .page { max-width: 1400px; }
    .page-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
    .page-header h1 { margin: 0; }
    .queue-badge {
      background: #ff9800; color: white; padding: 0.2rem 0.75rem;
      border-radius: 12px; font-size: 0.8rem; font-weight: 700;
    }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
    .alert-success { background: #e8ffe8; color: #008000; border: 1px solid #b0e0b0; }
    .alert-error { background: #ffe8e8; color: #cc0000; border: 1px solid #e0b0b0; }

    /* Layout */
    .panel-layout { display: flex; gap: 1.5rem; align-items: flex-start; }
    .queue-panel { flex: 1; min-width: 0; }
    .panel-layout.drawer-open .queue-panel { max-width: calc(100% - 400px - 1.5rem); }

    /* Comment cards */
    .list { display: flex; flex-direction: column; gap: 0.75rem; }
    .mod-card {
      background: white; padding: 1.25rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); border-left: 4px solid #ff9800;
      cursor: pointer; transition: box-shadow 0.15s, border-color 0.15s;
    }
    .mod-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .mod-card:focus { outline: 2px solid #4040ff; outline-offset: 2px; }
    .mod-card.selected { border-left-color: #4040ff; box-shadow: 0 2px 8px rgba(64,64,255,0.15); }
    .mod-header { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
    .comment-id { font-size: 0.8rem; color: #999; }
    .comment-date { font-size: 0.85rem; color: #666; }
    .comment-content {
      padding: 0.75rem; background: #f8f8f8; border-radius: 4px;
      margin-bottom: 0.5rem; font-size: 0.9rem; line-height: 1.5;
    }
    .comment-meta { color: #999; font-size: 0.8rem; display: flex; gap: 1rem; margin-bottom: 0.75rem; }
    .comment-meta strong { color: #555; }
    .mono { font-family: monospace; }
    .card-quick-actions { display: flex; gap: 0.5rem; }
    .btn-sm { padding: 0.4rem 1rem; font-size: 0.85rem; border-radius: 4px; cursor: pointer; border: none; font-weight: 600; }
    .btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-approve { background: #e8ffe8; color: #008000; }
    .btn-approve:hover { background: #d0ffd0; }
    .btn-reject { background: #ffe8e8; color: #cc0000; }
    .btn-reject:hover { background: #ffd0d0; }
    .btn-review { background: #e8e8ff; color: #4040ff; }
    .btn-review:hover { background: #d0d0ff; }

    /* Review drawer */
    .review-drawer {
      width: 400px; flex-shrink: 0;
      background: white; border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
      border: 1px solid #eee; position: sticky; top: 1rem;
      max-height: 85vh; overflow-y: auto;
    }
    .drawer-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 1rem 1.25rem; border-bottom: 1px solid #eee;
      position: sticky; top: 0; background: white; z-index: 1;
    }
    .drawer-header h2 { margin: 0; font-size: 1rem; }
    .close-btn {
      width: 28px; height: 28px; border: none; background: #f5f5f5;
      border-radius: 50%; cursor: pointer; font-size: 0.9rem;
      display: flex; align-items: center; justify-content: center;
    }
    .close-btn:hover { background: #eee; }
    .drawer-body { padding: 1.25rem; display: flex; flex-direction: column; gap: 1.25rem; }
    .detail-section h3.section-label { margin: 0 0 0.5rem; font-size: 0.85rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
    .comment-full {
      background: #f8f8f8; border-radius: 6px; padding: 0.75rem;
      font-size: 0.9rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
    }
    .detail-grid { display: flex; flex-direction: column; gap: 0.5rem; }
    .detail-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; font-size: 0.85rem; }
    .detail-label { color: #888; flex-shrink: 0; }
    .detail-value { color: #333; text-align: right; word-break: break-all; }
    .status-chip {
      background: #fff3e0; color: #e65100;
      padding: 0.15rem 0.5rem; border-radius: 10px; font-size: 0.75rem; font-weight: 600;
    }
    .reason-section label.section-label { display: block; margin-bottom: 0.5rem; font-size: 0.85rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
    .reason-textarea {
      width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;
      font-size: 0.9rem; font-family: inherit; resize: vertical; box-sizing: border-box;
    }
    .drawer-actions { display: flex; flex-direction: column; gap: 0.5rem; }
    .btn-full {
      width: 100%; padding: 0.65rem; border: none; border-radius: 6px;
      font-size: 0.95rem; font-weight: 600; cursor: pointer;
    }
    .btn-full:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-approve-full { background: #2e7d32; color: white; }
    .btn-approve-full:hover:not(:disabled) { background: #1b5e20; }
    .btn-reject-full { background: #cc0000; color: white; }
    .btn-reject-full:hover:not(:disabled) { background: #9a0000; }
  `]
})
export class ModerationPanelComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly modSvc = inject(ModerationService);

  pendingComments = signal<Comment[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);

  // Per-card reason input (used by quick-action approve/reject from the list)
  private reasons = new Map<string, string>();

  // Review drawer state
  selectedComment = signal<Comment | null>(null);
  drawerReason = signal('');
  drawerSubmitting = signal(false);

  ngOnInit(): void {
    this.loadPending();
  }

  async loadPending(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const ctx = this.session.requireAuth();
      const comments = await this.modSvc.getPendingComments(ctx.roles, ctx.organizationId);
      this.pendingComments.set(comments);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load moderation queue');
    } finally {
      this.isLoading.set(false);
    }
  }

  onOpenDrawer(comment: Comment): void {
    this.selectedComment.set(comment);
    this.drawerReason.set('');
  }

  onCloseDrawer(): void {
    this.selectedComment.set(null);
    this.drawerReason.set('');
  }

  /** Set the reason for a per-card quick-action decision. Called by the reason input in the card list. */
  setReason(commentId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.reasons.set(commentId, value);
  }

  // ── Quick-action approve/reject from the card list ──────────────────────────

  async onApprove(comment: Comment): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const reason = this.reasons.get(comment.id) || 'Approved by moderator';
      await this.modSvc.decide(comment.id, ModerationDecision.Approved, reason, ctx.userId, ctx.roles, ctx.organizationId);
      this.reasons.delete(comment.id);
      this._removeFromQueue(comment.id);
      this.showSuccess('Comment approved');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to approve');
      this.autoClearMessages();
    }
  }

  async onReject(comment: Comment): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const reason = this.reasons.get(comment.id) || 'Rejected by moderator';
      await this.modSvc.decide(comment.id, ModerationDecision.Rejected, reason, ctx.userId, ctx.roles, ctx.organizationId);
      this.reasons.delete(comment.id);
      this._removeFromQueue(comment.id);
      this.showSuccess('Comment rejected');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to reject');
      this.autoClearMessages();
    }
  }

  // ── Drawer approve/reject (with user-provided reason) ──────────────────────

  async onApproveSelected(): Promise<void> {
    const comment = this.selectedComment();
    if (!comment) return;
    this.drawerSubmitting.set(true);
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const reason = this.drawerReason().trim() || 'Approved by moderator';
      await this.modSvc.decide(comment.id, ModerationDecision.Approved, reason, ctx.userId, ctx.roles, ctx.organizationId);
      this._removeFromQueue(comment.id);
      this.onCloseDrawer();
      this.showSuccess('Comment approved');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to approve');
      this.autoClearMessages();
    } finally {
      this.drawerSubmitting.set(false);
    }
  }

  async onRejectSelected(): Promise<void> {
    const comment = this.selectedComment();
    if (!comment) return;
    this.drawerSubmitting.set(true);
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const reason = this.drawerReason().trim() || 'Rejected by moderator';
      await this.modSvc.decide(comment.id, ModerationDecision.Rejected, reason, ctx.userId, ctx.roles, ctx.organizationId);
      this._removeFromQueue(comment.id);
      this.onCloseDrawer();
      this.showSuccess('Comment rejected');
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to reject');
      this.autoClearMessages();
    } finally {
      this.drawerSubmitting.set(false);
    }
  }

  private _removeFromQueue(commentId: string): void {
    this.pendingComments.update(list => list.filter(c => c.id !== commentId));
    if (this.selectedComment()?.id === commentId) {
      this.onCloseDrawer();
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
