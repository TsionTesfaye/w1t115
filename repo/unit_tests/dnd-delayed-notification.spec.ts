/**
 * unit_tests/dnd-delayed-notification.spec.ts
 *
 * Delayed notifications (created during a DND window) must NOT be visible
 * via getUnreadForUser() or getAllForUser() until their DelayedDelivery
 * record is marked `released = true`.
 */

import { describe, it, expect } from 'vitest';
import { NotificationService } from '../src/app/core/services/notification.service';
import { NotificationDeliveryMode } from '../src/app/core/enums';
import {
  FakeNotificationRepo, FakeNotificationPreferenceRepo,
  FakeDelayedDeliveryRepo, makeFakeDnd, makeNotification,
} from '../src/app/core/services/__tests__/helpers';
import { generateId, now } from '../src/app/core/utils/id';

const ORG  = 'org1';
const USER = 'user1';

function makeService(
  notifRepo    = new FakeNotificationRepo(),
  prefRepo     = new FakeNotificationPreferenceRepo(),
  dnd          = makeFakeDnd(false),
  delayedRepo  = new FakeDelayedDeliveryRepo(),
) {
  return new NotificationService(notifRepo as any, prefRepo as any, dnd as any, delayedRepo as any);
}

describe('NotificationService — delayed notification visibility', () => {
  it('delayed notification is hidden before DelayedDelivery.released is true', async () => {
    const notif = makeNotification({
      userId: USER, organizationId: ORG, isRead: false, isCanceled: false,
      deliveryMode: NotificationDeliveryMode.Delayed,
    });
    const notifRepo = new FakeNotificationRepo().seed([notif]);
    // Delayed delivery record exists but is NOT yet released
    const delayedRepo = new FakeDelayedDeliveryRepo().seed([{
      id: generateId(), notificationId: notif.id, userId: USER,
      scheduledReleaseAt: new Date(Date.now() + 3600000).toISOString(),
      released: false, version: 1, createdAt: now(), updatedAt: now(),
    }]);
    const svc = makeService(notifRepo, undefined, undefined, delayedRepo);

    const unread = await svc.getUnreadForUser(USER, USER, ORG);
    expect(unread.find(n => n.id === notif.id)).toBeUndefined();
  });

  it('delayed notification becomes visible after DelayedDelivery.released is true', async () => {
    const notif = makeNotification({
      userId: USER, organizationId: ORG, isRead: false, isCanceled: false,
      deliveryMode: NotificationDeliveryMode.Delayed,
    });
    const notifRepo = new FakeNotificationRepo().seed([notif]);
    // Delayed delivery record is released
    const delayedRepo = new FakeDelayedDeliveryRepo().seed([{
      id: generateId(), notificationId: notif.id, userId: USER,
      scheduledReleaseAt: new Date(Date.now() - 1000).toISOString(),
      released: true, version: 1, createdAt: now(), updatedAt: now(),
    }]);
    const svc = makeService(notifRepo, undefined, undefined, delayedRepo);

    const unread = await svc.getUnreadForUser(USER, USER, ORG);
    expect(unread.find(n => n.id === notif.id)).toBeDefined();
  });

  it('instant notifications are always visible regardless of delayed delivery state', async () => {
    const instantNotif = makeNotification({
      userId: USER, organizationId: ORG, isRead: false, isCanceled: false,
      deliveryMode: NotificationDeliveryMode.Instant,
    });
    const notifRepo = new FakeNotificationRepo().seed([instantNotif]);
    const delayedRepo = new FakeDelayedDeliveryRepo(); // empty — no delays
    const svc = makeService(notifRepo, undefined, undefined, delayedRepo);

    const unread = await svc.getUnreadForUser(USER, USER, ORG);
    expect(unread).toHaveLength(1);
  });

  it('getAllForUser also excludes unreleased delayed notifications', async () => {
    const delayedNotif = makeNotification({
      userId: USER, organizationId: ORG, isRead: false, isCanceled: false,
      deliveryMode: NotificationDeliveryMode.Delayed,
    });
    const instantNotif = makeNotification({
      userId: USER, organizationId: ORG, isRead: true, isCanceled: false,
      deliveryMode: NotificationDeliveryMode.Instant,
    });
    const notifRepo = new FakeNotificationRepo().seed([delayedNotif, instantNotif]);
    const delayedRepo = new FakeDelayedDeliveryRepo().seed([{
      id: generateId(), notificationId: delayedNotif.id, userId: USER,
      scheduledReleaseAt: new Date(Date.now() + 3600000).toISOString(),
      released: false, version: 1, createdAt: now(), updatedAt: now(),
    }]);
    const svc = makeService(notifRepo, undefined, undefined, delayedRepo);

    const all = await svc.getAllForUser(USER, USER, ORG);
    expect(all.find(n => n.id === delayedNotif.id)).toBeUndefined();
    expect(all.find(n => n.id === instantNotif.id)).toBeDefined();
  });
});
