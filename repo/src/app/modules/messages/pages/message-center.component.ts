import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, FormControl, Validators } from '@angular/forms';
import { SessionService } from '../../../core/services/session.service';
import { MessageService } from '../../../core/services/message.service';
import { Thread, Message } from '../../../core/models';
import { ThreadContextType } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-message-center',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent],
  template: `
    <div class="page">
      @if (actionError()) {
        <div class="alert alert-error">{{ actionError() }}</div>
      }

      @if (showNewThread()) {
        <div class="form-panel">
          <h2>New Conversation</h2>
          <form [formGroup]="newThreadForm" (ngSubmit)="onCreateThread()">
            <div class="field">
              <label for="contextType">Context Type *</label>
              <select id="contextType" formControlName="contextType">
                <option value="general">General</option>
                <option value="job">Job</option>
                <option value="application">Application</option>
                <option value="interview">Interview</option>
              </select>
            </div>
            <div class="field">
              <label for="contextId">Context ID *</label>
              <input id="contextId" type="text" formControlName="contextId" placeholder="Enter context ID" />
            </div>
            <div class="field">
              <label for="participantIds">Participant IDs (comma-separated) *</label>
              <input id="participantIds" type="text" formControlName="participantIds" placeholder="user1,user2" />
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-primary" [disabled]="newThreadForm.invalid">Create</button>
              <button type="button" class="btn-secondary" (click)="showNewThread.set(false)">Cancel</button>
            </div>
          </form>
        </div>
      }

      <div class="message-center">
        <div class="thread-list-panel">
          <div class="panel-header">
            <h2>Messages</h2>
            <button class="btn-primary btn-sm" (click)="showNewThread.set(!showNewThread())">New Thread</button>
          </div>

          @if (isLoading()) {
            <app-loading-state message="Loading threads..." />
          } @else if (error()) {
            <app-error-state [message]="error()!" [retryFn]="loadThreads.bind(this)" />
          } @else if (threads().length === 0) {
            <app-empty-state message="No conversations yet" />
          } @else {
            <div class="thread-list">
              @for (thread of threads(); track thread.id) {
                <div class="thread-item" [class.selected]="selectedThread()?.id === thread.id" (click)="onSelectThread(thread)">
                  <span class="context-badge">{{ thread.contextType }}</span>
                  <div class="thread-meta">
                    <span class="participant-count">{{ thread.participantIds.length }} participants</span>
                    <span class="thread-date">{{ thread.createdAt | date:'shortDate' }}</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <div class="message-panel">
          @if (selectedThread()) {
            <div class="panel-header">
              <h2>{{ selectedThread()!.contextType | titlecase }} Thread</h2>
              <span class="thread-id">{{ selectedThread()!.id }}</span>
            </div>

            <div class="messages-list">
              @if (messagesLoading()) {
                <app-loading-state message="Loading messages..." />
              } @else if (messages().length === 0) {
                <app-empty-state message="No messages in this thread" />
              } @else {
                @for (msg of messages(); track msg.id) {
                  <div class="message-bubble" [class.own-message]="msg.senderId === currentUserId()">
                    <div class="message-header">
                      <span class="sender">{{ msg.senderId === currentUserId() ? 'You' : msg.senderId }}</span>
                      <span class="timestamp">{{ msg.createdAt | date:'short' }}</span>
                    </div>
                    <p class="message-content">{{ msg.content }}</p>
                    <span class="read-status">{{ msg.readBy.length > 1 ? 'Read' : 'Sent' }}</span>
                  </div>
                }
              }
            </div>

            <div class="compose-form">
              <textarea [formControl]="messageControl" placeholder="Type a message..." rows="2"></textarea>
              <button class="btn-primary" (click)="onSendMessage()" [disabled]="!messageControl.value?.trim() || sending()">
                {{ sending() ? 'Sending...' : 'Send' }}
              </button>
            </div>
          } @else {
            <div class="empty-panel">
              <app-empty-state message="Select a conversation to view messages" />
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
    .alert { padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1rem; }
    .alert-error { background: #ffebee; color: #cc0000; }
    .form-panel { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
    .form-panel h2 { margin-top: 0; }
    .field { margin-bottom: 1rem; }
    .field label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
    .field input, .field select { width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
    .form-actions { display: flex; gap: 0.5rem; }
    .btn-primary { padding: 0.5rem 1.5rem; background: #4040ff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary.btn-sm { padding: 0.35rem 1rem; font-size: 0.85rem; }
    .btn-secondary { padding: 0.5rem 1.5rem; border: 1px solid #4040ff; color: #4040ff; background: transparent; border-radius: 4px; cursor: pointer; }
    .message-center { display: grid; grid-template-columns: 320px 1fr; gap: 1rem; min-height: 500px; }
    .thread-list-panel { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; display: flex; flex-direction: column; }
    .panel-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid #eee; }
    .panel-header h2 { margin: 0; font-size: 1.1rem; }
    .thread-list { overflow-y: auto; flex: 1; }
    .thread-item { padding: 0.75rem 1rem; border-bottom: 1px solid #f0f0f0; cursor: pointer; transition: background 0.15s; }
    .thread-item:hover { background: #f8f8ff; }
    .thread-item.selected { background: #e8e8ff; border-left: 3px solid #4040ff; }
    .context-badge { display: inline-block; background: #f0f0f0; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; margin-bottom: 0.25rem; }
    .thread-meta { display: flex; justify-content: space-between; font-size: 0.8rem; color: #666; }
    .message-panel { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; overflow: hidden; }
    .messages-list { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .message-bubble { padding: 0.75rem; border-radius: 8px; background: #f5f5f5; max-width: 80%; }
    .message-bubble.own-message { background: #e8e8ff; align-self: flex-end; }
    .message-header { display: flex; justify-content: space-between; margin-bottom: 0.25rem; font-size: 0.8rem; }
    .sender { font-weight: 600; }
    .timestamp { color: #999; }
    .message-content { margin: 0; }
    .read-status { font-size: 0.7rem; color: #999; }
    .compose-form { display: flex; gap: 0.5rem; padding: 1rem; border-top: 1px solid #eee; align-items: flex-end; }
    .compose-form textarea { flex: 1; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; resize: none; font-family: inherit; }
    .empty-panel { display: flex; align-items: center; justify-content: center; flex: 1; }
    .thread-id { font-size: 0.75rem; color: #999; }
  `]
})
export class MessageCenterComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly msgService = inject(MessageService);
  private readonly fb = inject(FormBuilder);

  threads = signal<Thread[]>([]);
  selectedThread = signal<Thread | null>(null);
  messages = signal<Message[]>([]);
  isLoading = signal(false);
  messagesLoading = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  showNewThread = signal(false);
  sending = signal(false);

  currentUserId = computed(() => this.session.userId());

  messageControl = new FormControl('');

  newThreadForm: FormGroup = this.fb.group({
    contextType: ['general', Validators.required],
    contextId: ['', Validators.required],
    participantIds: ['', Validators.required],
  });

  ngOnInit(): void {
    this.loadThreads();
  }

  async loadThreads(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const { userId, organizationId } = this.session.requireAuth();
      const threads = await this.msgService.getThreadsForUser(userId, organizationId);
      this.threads.set(threads);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load threads');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onSelectThread(thread: Thread): Promise<void> {
    this.selectedThread.set(thread);
    this.messagesLoading.set(true);
    try {
      const { userId, organizationId } = this.session.requireAuth();
      const msgs = await this.msgService.getMessages(thread.id, userId, organizationId);
      this.messages.set(msgs);
      // Mark unread messages as read
      for (const msg of msgs) {
        if (msg.senderId !== userId && !msg.readBy.includes(userId)) {
          await this.msgService.markAsRead(msg.id, userId, organizationId);
        }
      }
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to load messages');
      this.clearMessages();
    } finally {
      this.messagesLoading.set(false);
    }
  }

  async onSendMessage(): Promise<void> {
    const content = this.messageControl.value?.trim();
    const thread = this.selectedThread();
    if (!content || !thread) return;
    this.sending.set(true);
    this.actionError.set(null);
    try {
      const { userId, organizationId } = this.session.requireAuth();
      await this.msgService.sendMessage(thread.id, content, userId, organizationId);
      this.messageControl.reset();
      const msgs = await this.msgService.getMessages(thread.id, userId, organizationId);
      this.messages.set(msgs);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to send message');
      this.clearMessages();
    } finally {
      this.sending.set(false);
    }
  }

  async onCreateThread(): Promise<void> {
    if (this.newThreadForm.invalid) return;
    this.actionError.set(null);
    try {
      const { userId, roles, organizationId } = this.session.requireAuth();
      const { contextType, contextId, participantIds } = this.newThreadForm.value;
      const ids = participantIds.split(',').map((id: string) => id.trim()).filter((id: string) => id);
      const thread = await this.msgService.createThread(contextType as ThreadContextType, contextId, ids, userId, roles, organizationId);
      this.showNewThread.set(false);
      this.newThreadForm.reset({ contextType: 'general' });
      await this.loadThreads();
      this.onSelectThread(thread);
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to create thread');
      this.clearMessages();
    }
  }

  private clearMessages(): void {
    setTimeout(() => {
      this.actionError.set(null);
    }, 3000);
  }
}
