import { Injectable } from '@angular/core';
import { NotificationRepository, NotificationPreferenceRepository, DelayedDeliveryRepository } from '../repositories';
import { DNDService } from './dnd.service';
import { Notification, NotificationPreference } from '../models';
import { NotificationEventType, NotificationDeliveryMode } from '../enums';
import { NOTIFICATION_CONSTANTS } from '../constants';
import { generateId, now, today } from '../utils/id';
import { AuthorizationError, ValidationError } from '../errors';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  constructor(
    private readonly notifRepo: NotificationRepository,
    private readonly prefRepo: NotificationPreferenceRepository,
    private readonly dndService: DNDService,
    private readonly delayedRepo: DelayedDeliveryRepository,
  ) {}

  async createNotification(
    userId: string,
    organizationId: string,
    type: NotificationEventType,
    referenceType: string,
    referenceId: string,
    eventId: string,
    message: string,
  ): Promise<Notification | null> {
    // Runtime validation: reject arbitrary/spoofed event types
    const validTypes: string[] = Object.values(NotificationEventType);
    if (!validTypes.includes(type)) {
      throw new ValidationError(`Invalid notification event type: ${type}`);
    }
    // Deduplication: one notification per eventId per user
    const existing = await this.notifRepo.getByEventId(eventId);
    if (existing.find(n => n.userId === userId && !n.isCanceled)) return null;

    const pref = await this.prefRepo.getByUserAndType(userId, type);
    const instantEnabled = pref?.instantEnabled ?? true;
    const digestEnabled = pref?.digestEnabled ?? true;

    let deliveryMode: NotificationDeliveryMode;

    if (instantEnabled) {
      // Rate limit: max N instant notifications per type per day
      const todayStr = today();
      const userTypeNotifs = await this.notifRepo.getByUserAndType(userId, type);
      const todayInstant = userTypeNotifs.filter(
        n => n.deliveryMode === NotificationDeliveryMode.Instant && !n.isCanceled && n.createdAt.startsWith(todayStr),
      );
      if (todayInstant.length >= NOTIFICATION_CONSTANTS.MAX_INSTANT_PER_TYPE_PER_DAY) {
        if (digestEnabled) deliveryMode = NotificationDeliveryMode.Digest;
        else return null;
      } else {
        // DND check: delay instant delivery if user is in do-not-disturb window
        const inDnd = await this.dndService.isInDND(userId);
        deliveryMode = inDnd ? NotificationDeliveryMode.Delayed : NotificationDeliveryMode.Instant;
      }
    } else if (digestEnabled) {
      deliveryMode = NotificationDeliveryMode.Digest;
    } else {
      return null;
    }

    const notif: Notification = {
      id: generateId(), organizationId, userId, type, referenceType, referenceId,
      eventId, message, isRead: false, deliveryMode, isCanceled: false,
      version: 1, createdAt: now(), updatedAt: now(),
    };
    await this.notifRepo.add(notif);

    if (deliveryMode === NotificationDeliveryMode.Delayed) {
      await this.dndService.delayDelivery(notif.id, userId);
    }

    return notif;
  }

  async markAsRead(notificationId: string, actorId: string, actorOrgId: string): Promise<void> {
    // Pre-flight: RBAC/ABAC check for fast rejection before taking the write lock
    const n = await this.notifRepo.getById(notificationId);
    if (!n) return;
    if (n.userId !== actorId) throw new AuthorizationError('Cannot mark another user\'s notification as read');
    if (n.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    // Atomic: re-check ownership + write inside a single IDB readwrite transaction.
    // Prevents two concurrent markAsRead calls from both incrementing the version.
    await this.notifRepo.updateWithLock(notificationId, (current) => {
      if (current.userId !== actorId) throw new AuthorizationError('Cannot mark another user\'s notification as read');
      if (current.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
      if (current.isRead) return current; // already read — idempotent
      return { ...current, isRead: true, updatedAt: now(), version: current.version + 1 };
    });
  }

  /**
   * Get unread notifications for a user.
   * ABAC: actorId must equal userId (own notifications only).
   *       Results are filtered to actorOrgId.
   * Delayed notifications that have not yet been released by the DND scheduler
   * are excluded — they should only surface after the DND window ends.
   */
  async getUnreadForUser(userId: string, actorId: string, actorOrgId: string): Promise<Notification[]> {
    if (userId !== actorId) throw new AuthorizationError('Cannot access another user\'s notifications');
    const all = (await this.notifRepo.getByUser(userId)).filter(
      n => !n.isRead && !n.isCanceled && n.organizationId === actorOrgId,
    );
    return this.filterReleasedDelayed(all);
  }

  /**
   * Get all (non-canceled) notifications for a user.
   * ABAC: actorId must equal userId.
   *       Results are filtered to actorOrgId.
   * Unreleased delayed notifications are excluded (same logic as getUnreadForUser).
   */
  async getAllForUser(userId: string, actorId: string, actorOrgId: string): Promise<Notification[]> {
    if (userId !== actorId) throw new AuthorizationError('Cannot access another user\'s notifications');
    const all = (await this.notifRepo.getByUser(userId))
      .filter(n => !n.isCanceled && n.organizationId === actorOrgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return this.filterReleasedDelayed(all);
  }

  /**
   * Filter out Delayed notifications that have not yet been released.
   * Instant and Digest notifications always pass through.
   * A Delayed notification is visible only after its DelayedDelivery record is marked `released`.
   */
  private async filterReleasedDelayed(notifications: Notification[]): Promise<Notification[]> {
    const delayedIds = notifications
      .filter(n => n.deliveryMode === NotificationDeliveryMode.Delayed)
      .map(n => n.id);

    if (delayedIds.length === 0) return notifications;

    // Fetch released status for all delayed notifications in one query
    const allDelayed = await this.delayedRepo.getAll();
    const releasedSet = new Set(
      allDelayed.filter(d => d.released).map(d => d.notificationId),
    );

    return notifications.filter(n =>
      n.deliveryMode !== NotificationDeliveryMode.Delayed || releasedSet.has(n.id),
    );
  }

  /**
   * Get notification preferences for a user.
   * ABAC: actorId must equal userId (own preferences only).
   */
  async getUserPreferences(userId: string, actorId: string): Promise<NotificationPreference[]> {
    if (userId !== actorId) throw new AuthorizationError('Cannot access another user\'s notification preferences');
    return this.prefRepo.getByUser(userId);
  }

  async updatePreference(
    userId: string,
    organizationId: string,
    eventType: NotificationEventType,
    instantEnabled: boolean,
    digestEnabled: boolean,
    dndStart: string | null,
    dndEnd: string | null,
    actorId: string,
  ): Promise<NotificationPreference> {
    if (userId !== actorId) throw new AuthorizationError('Cannot update another user\'s notification preferences');
    const pref = await this.prefRepo.getByUserAndType(userId, eventType);
    if (pref) {
      // Atomic: update preference fields inside a single IDB readwrite transaction.
      // Prevents two concurrent updatePreference calls from producing inconsistent state.
      return this.prefRepo.updateWithLock(pref.id, (current) => ({
        ...current,
        instantEnabled, digestEnabled, dndStart, dndEnd,
        version: current.version + 1, updatedAt: now(),
      }));
    }
    // New preference record — first-time creation, no concurrent write risk for own preferences
    const newPref: NotificationPreference = { id: generateId(), userId, organizationId, eventType, instantEnabled, digestEnabled, dndStart, dndEnd, version: 1, createdAt: now(), updatedAt: now() };
    await this.prefRepo.add(newPref);
    return newPref;
  }
}
