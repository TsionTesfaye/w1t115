import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { SessionService } from '../../../core/services/session.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DigestService } from '../../../core/services/digest.service';
import { Notification, NotificationPreference, Digest } from '../../../core/models';
import { NotificationEventType, NotificationDeliveryMode } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-notification-center',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="header-left">
          <h1>Notifications</h1>
          @if (unreadCount() > 0) {
            <span class="unread-badge">{{ unreadCount() }} unread</span>
          }
        </div>
        <div class="header-actions">
          <button class="btn-secondary" (click)="showPreferences.set(!showPreferences())">
            {{ showPreferences() ? 'Hide Preferences' : 'Preferences' }}
          </button>
          @if (unreadCount() > 0) {
            <button class="btn-primary" (click)="onMarkAllRead()">Mark All Read</button>
          }
        </div>
      </header>

      @if (actionSuccess()) {
        <div class="alert alert-success">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error">{{ actionError() }}</div>
      }

      <div class="filter-tabs">
        <button class="tab" [class.active]="filter() === 'all'" (click)="filter.set('all')">All</button>
        <button class="tab" [class.active]="filter() === 'unread'" (click)="filter.set('unread')">Unread</button>
        <button class="tab" [class.active]="filter() === 'digest'" (click)="switchToDigest()">
          Digest @if (pendingDigestCount() > 0) { <span class="digest-badge">{{ pendingDigestCount() }}</span> }
        </button>
      </div>

      @if (showPreferences()) {
        <div class="form-panel">
          <h2>Notification Preferences</h2>
          <table class="pref-table">
            <thead>
              <tr>
                <th>Event Type</th>
                <th>Instant</th>
                <th>Digest</th>
                <th>DND Start</th>
                <th>DND End</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (eventType of eventTypes; track eventType) {
                <tr>
                  <td>{{ formatEventType(eventType) }}</td>
                  <td><input type="checkbox" [checked]="getPrefValue(eventType, 'instant')" (change)="onTogglePref(eventType, 'instant', $event)" /></td>
                  <td><input type="checkbox" [checked]="getPrefValue(eventType, 'digest')" (change)="onTogglePref(eventType, 'digest', $event)" /></td>
                  <td><input type="time" [value]="getPrefDND(eventType, 'start')" (change)="onDNDChange(eventType, 'start', $event)" /></td>
                  <td><input type="time" [value]="getPrefDND(eventType, 'end')" (change)="onDNDChange(eventType, 'end', $event)" /></td>
                  <td><button class="btn-secondary btn-sm" (click)="onSavePref(eventType)">Save</button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (isLoading()) {
        <app-loading-state message="Loading notifications..." />
      } @else if (error()) {
        <app-error-state [message]="error()!" [retryFn]="loadNotifications.bind(this)" />
      } @else if (filter() === 'digest') {
        <!-- Digest inbox: grouped summary of digest-mode notifications -->
        @if (digests().length === 0) {
          <app-empty-state message="No digest summaries yet" />
        } @else {
          <div class="digest-list">
            @for (digest of digests(); track digest.id) {
              <div class="digest-item" [class.undelivered]="!digest.deliveredAt" (click)="onViewDigest(digest)">
                <div class="digest-header">
                  <span class="digest-date">{{ digest.digestDate }}</span>
                  <span class="digest-count">{{ digest.itemIds.length }} notification{{ digest.itemIds.length !== 1 ? 's' : '' }}</span>
                  @if (!digest.deliveredAt) {
                    <span class="digest-new-badge">New</span>
                  } @else {
                    <span class="digest-delivered">Viewed {{ digest.deliveredAt | date:'shortDate' }}</span>
                  }
                </div>
                <div class="digest-body">
                  @for (notif of getDigestNotifications(digest); track notif.id) {
                    <div class="digest-notif-row">
                      <span class="type-badge type-{{ notif.type }}">{{ formatEventType(notif.type) }}</span>
                      <span class="digest-notif-msg">{{ notif.message }}</span>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }
      } @else if (filteredNotifications().length === 0) {
        <app-empty-state [message]="filter() === 'unread' ? 'No unread notifications' : 'No notifications'" />
      } @else {
        <div class="notification-list">
          @for (notif of filteredNotifications(); track notif.id) {
            <div class="notif-item" [class.unread]="!notif.isRead" (click)="onMarkRead(notif)">
              <div class="notif-header">
                <span class="type-badge type-{{ notif.type }}">{{ formatEventType(notif.type) }}</span>
                <span class="notif-time">{{ notif.createdAt | date:'medium' }}</span>
              </div>
              <p class="notif-message">{{ notif.message }}</p>
              <div class="notif-footer">
                @if (!notif.isRead) {
                  <span class="unread-dot"></span>
                  <span class="unread-label">Unread</span>
                } @else {
                  <span class="read-label">Read</span>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .header-left { display: flex; align-items: center; gap: 1rem; }
    .header-left h1 { margin: 0; }
    .header-actions { display: flex; gap: 0.5rem; }
    .unread-badge { background: #4040ff; color: white; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.8rem; }
    .btn-primary { padding: 0.5rem 1.5rem; background: #4040ff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .btn-secondary { padding: 0.5rem 1.5rem; border: 1px solid #4040ff; color: #4040ff; background: transparent; border-radius: 4px; cursor: pointer; }
    .btn-secondary.btn-sm { padding: 0.25rem 0.75rem; font-size: 0.8rem; }
    .alert { padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1rem; }
    .alert-success { background: #e8f5e9; color: #2e7d32; }
    .alert-error { background: #ffebee; color: #cc0000; }
    .filter-tabs { display: flex; gap: 0; margin-bottom: 1rem; }
    .tab { padding: 0.5rem 1.5rem; border: 1px solid #ddd; background: white; cursor: pointer; font-size: 0.9rem; }
    .tab:first-child { border-radius: 4px 0 0 4px; }
    .tab:last-child { border-radius: 0 4px 4px 0; }
    .tab.active { background: #4040ff; color: white; border-color: #4040ff; }
    .form-panel { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
    .form-panel h2 { margin-top: 0; }
    .pref-table { width: 100%; border-collapse: collapse; }
    .pref-table th, .pref-table td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #eee; }
    .pref-table th { font-size: 0.85rem; color: #666; }
    .pref-table input[type="time"] { padding: 0.25rem; border: 1px solid #ddd; border-radius: 4px; }
    .notification-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .notif-item { background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; transition: background 0.15s; }
    .notif-item:hover { background: #f8f8ff; }
    .notif-item.unread { border-left: 3px solid #4040ff; }
    .notif-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .type-badge { display: inline-block; background: #f0f0f0; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; }
    .notif-time { font-size: 0.8rem; color: #999; }
    .notif-message { margin: 0 0 0.5rem 0; }
    .notif-footer { display: flex; align-items: center; gap: 0.35rem; }
    .unread-dot { width: 8px; height: 8px; border-radius: 50%; background: #4040ff; display: inline-block; }
    .unread-label { font-size: 0.8rem; color: #4040ff; font-weight: 500; }
    .read-label { font-size: 0.8rem; color: #999; }
    .digest-badge { display: inline-block; background: #ff6600; color: white; border-radius: 10px; padding: 0 5px; font-size: 0.7rem; margin-left: 4px; }
    .digest-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .digest-item { background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; }
    .digest-item.undelivered { border-left: 3px solid #ff6600; }
    .digest-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
    .digest-date { font-weight: 600; font-size: 0.95rem; }
    .digest-count { color: #666; font-size: 0.85rem; }
    .digest-new-badge { background: #ff6600; color: white; padding: 0.1rem 0.5rem; border-radius: 10px; font-size: 0.75rem; font-weight: 600; }
    .digest-delivered { color: #999; font-size: 0.8rem; }
    .digest-body { display: flex; flex-direction: column; gap: 0.35rem; }
    .digest-notif-row { display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.88rem; }
    .digest-notif-msg { color: #444; }
  `]
})
export class NotificationCenterComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly notifService = inject(NotificationService);
  private readonly digestService = inject(DigestService);

  notifications = signal<Notification[]>([]);
  digests = signal<Digest[]>([]);
  preferences = signal<NotificationPreference[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);
  filter = signal<'all' | 'unread' | 'digest'>('all');
  showPreferences = signal(false);

  // Local editable state for preferences (keyed by event type)
  private prefEdits = new Map<string, { instant: boolean; digest: boolean; dndStart: string; dndEnd: string }>();

  readonly eventTypes = Object.values(NotificationEventType);

  unreadCount = computed(() => this.notifications().filter(n => !n.isRead).length);

  pendingDigestCount = computed(() => this.digests().filter(d => !d.deliveredAt).length);

  filteredNotifications = computed(() => {
    const all = this.notifications().filter(n => n.deliveryMode !== NotificationDeliveryMode.Digest);
    if (this.filter() === 'unread') return all.filter(n => !n.isRead);
    return all;
  });

  ngOnInit(): void {
    this.loadNotifications();
    this.loadDigests();
    this.loadPreferences();
  }

  async loadNotifications(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const { userId, organizationId } = this.session.requireAuth();
      const notifs = await this.notifService.getAllForUser(userId, userId, organizationId);
      this.notifications.set(notifs);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load notifications');
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadDigests(): Promise<void> {
    try {
      const { userId, organizationId } = this.session.requireAuth();
      const all = await this.digestService.getAllForUser(userId, userId, organizationId);
      this.digests.set(all.sort((a, b) => b.digestDate.localeCompare(a.digestDate)));
    } catch {
      // Non-critical
    }
  }

  switchToDigest(): void {
    this.filter.set('digest');
    this.loadDigests();
  }

  /** Mark a digest delivered and expand its notifications inline. */
  async onViewDigest(digest: Digest): Promise<void> {
    if (!digest.deliveredAt) {
      try {
        await this.digestService.markDelivered(digest.id);
        this.digests.update(list => list.map(d => d.id === digest.id ? { ...d, deliveredAt: new Date().toISOString() } : d));
      } catch {
        // Non-critical
      }
    }
  }

  /** Return the notification objects referenced by a digest's itemIds. */
  getDigestNotifications(digest: Digest): Notification[] {
    const ids = new Set(digest.itemIds);
    return this.notifications().filter(n => ids.has(n.id));
  }

  async loadPreferences(): Promise<void> {
    try {
      const { userId } = this.session.requireAuth();
      const prefs = await this.notifService.getUserPreferences(userId, userId);
      this.preferences.set(prefs);
      // Populate edit state
      for (const p of prefs) {
        this.prefEdits.set(p.eventType, {
          instant: p.instantEnabled,
          digest: p.digestEnabled,
          dndStart: p.dndStart ?? '',
          dndEnd: p.dndEnd ?? '',
        });
      }
    } catch {
      // Non-critical; preferences panel just shows defaults
    }
  }

  async onMarkRead(notif: Notification): Promise<void> {
    if (notif.isRead) return;
    try {
      const { userId, organizationId } = this.session.requireAuth();
      await this.notifService.markAsRead(notif.id, userId, organizationId);
      this.notifications.update(list =>
        list.map(n => n.id === notif.id ? { ...n, isRead: true } : n)
      );
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to mark as read');
      this.clearMessages();
    }
  }

  async onMarkAllRead(): Promise<void> {
    try {
      const { userId, organizationId } = this.session.requireAuth();
      const unread = this.notifications().filter(n => !n.isRead);
      for (const n of unread) {
        await this.notifService.markAsRead(n.id, userId, organizationId);
      }
      this.notifications.update(list => list.map(n => ({ ...n, isRead: true })));
      this.actionSuccess.set('All notifications marked as read');
      this.clearMessages();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to mark all as read');
      this.clearMessages();
    }
  }

  getPrefValue(eventType: string, field: 'instant' | 'digest'): boolean {
    const edit = this.prefEdits.get(eventType);
    if (edit) return field === 'instant' ? edit.instant : edit.digest;
    return true; // default enabled
  }

  getPrefDND(eventType: string, which: 'start' | 'end'): string {
    const edit = this.prefEdits.get(eventType);
    if (!edit) return '';
    return which === 'start' ? edit.dndStart : edit.dndEnd;
  }

  onTogglePref(eventType: string, field: 'instant' | 'digest', event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const current = this.prefEdits.get(eventType) ?? { instant: true, digest: true, dndStart: '', dndEnd: '' };
    if (field === 'instant') current.instant = checked;
    else current.digest = checked;
    this.prefEdits.set(eventType, current);
  }

  onDNDChange(eventType: string, which: 'start' | 'end', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const current = this.prefEdits.get(eventType) ?? { instant: true, digest: true, dndStart: '', dndEnd: '' };
    if (which === 'start') current.dndStart = value;
    else current.dndEnd = value;
    this.prefEdits.set(eventType, current);
  }

  async onSavePref(eventType: string): Promise<void> {
    const edit = this.prefEdits.get(eventType) ?? { instant: true, digest: true, dndStart: '', dndEnd: '' };
    try {
      const { userId, organizationId } = this.session.requireAuth();
      await this.notifService.updatePreference(
        userId, organizationId, eventType as NotificationEventType,
        edit.instant, edit.digest,
        edit.dndStart || null, edit.dndEnd || null,
        userId,
      );
      this.actionSuccess.set('Preference saved');
      await this.loadPreferences();
      this.clearMessages();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to save preference');
      this.clearMessages();
    }
  }

  formatEventType(type: string): string {
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  private clearMessages(): void {
    setTimeout(() => {
      this.actionSuccess.set(null);
      this.actionError.set(null);
    }, 3000);
  }
}
