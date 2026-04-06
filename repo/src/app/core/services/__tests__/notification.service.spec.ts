import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationService } from '../notification.service';
import { NotificationEventType, NotificationDeliveryMode } from '../../enums';
import { AuthorizationError } from '../../errors';
import { NOTIFICATION_CONSTANTS } from '../../constants';
import {
  FakeNotificationRepo, FakeNotificationPreferenceRepo, FakeDelayedDeliveryRepo,
  makeFakeDnd, makeNotification,
} from './helpers';
import { now, today } from '../../utils/id';

const ORG  = 'org1';
const USER = 'user1';
const OTHER_USER = 'user2';
const TYPE = NotificationEventType.ApplicationReceived;

function makeService(
  notifRepo    = new FakeNotificationRepo(),
  prefRepo     = new FakeNotificationPreferenceRepo(),
  dnd          = makeFakeDnd(false),
  delayedRepo  = new FakeDelayedDeliveryRepo(),
) {
  return new NotificationService(notifRepo as any, prefRepo as any, dnd as any, delayedRepo as any);
}

// ── Deduplication ──────────────────────────────────────────────────────────

describe('NotificationService — deduplication', () => {
  it('returns null when the same eventId already has a live notification for the user', async () => {
    const existing = makeNotification({ userId: USER, eventId: 'evt-1', isCanceled: false });
    const notifRepo = new FakeNotificationRepo().seed([existing]);
    const svc = makeService(notifRepo);

    const result = await svc.createNotification(
      USER, ORG, TYPE, 'application', 'app1', 'evt-1', 'Duplicate',
    );
    expect(result).toBeNull();
    // No new record was added
    expect(notifRepo.snapshot()).toHaveLength(1);
  });

  it('allows a new notification if the previous one with the same eventId is canceled', async () => {
    const canceled = makeNotification({ userId: USER, eventId: 'evt-1', isCanceled: true });
    const notifRepo = new FakeNotificationRepo().seed([canceled]);
    const svc = makeService(notifRepo);

    const result = await svc.createNotification(
      USER, ORG, TYPE, 'application', 'app1', 'evt-1', 'New delivery',
    );
    expect(result).not.toBeNull();
    expect(notifRepo.snapshot()).toHaveLength(2);
  });

  it('different users can each receive a notification for the same eventId', async () => {
    const svc = makeService();
    const n1 = await svc.createNotification(USER,       ORG, TYPE, 'application', 'app1', 'evt-shared', 'Msg');
    const n2 = await svc.createNotification(OTHER_USER, ORG, TYPE, 'application', 'app1', 'evt-shared', 'Msg');
    expect(n1).not.toBeNull();
    expect(n2).not.toBeNull();
  });
});

// ── Rate limiting ──────────────────────────────────────────────────────────

describe('NotificationService — instant delivery rate limit', () => {
  it('falls back to Digest mode after MAX_INSTANT_PER_TYPE_PER_DAY instant notifications', async () => {
    const todayStr = today();
    // Pre-seed MAX already-sent instant notifications for today
    const prior = Array.from({ length: NOTIFICATION_CONSTANTS.MAX_INSTANT_PER_TYPE_PER_DAY }, (_, i) =>
      makeNotification({
        userId: USER, type: TYPE,
        deliveryMode: NotificationDeliveryMode.Instant,
        isCanceled: false,
        createdAt: `${todayStr}T10:0${i}:00.000Z`,
        eventId: `prior-${i}`,
      }),
    );
    const notifRepo = new FakeNotificationRepo().seed(prior);
    const svc = makeService(notifRepo);

    const result = await svc.createNotification(
      USER, ORG, TYPE, 'application', 'app1', 'new-evt', 'Rate limited',
    );
    // Digest is enabled by default (pref not set) → should fall back to Digest
    expect(result).not.toBeNull();
    expect(result!.deliveryMode).toBe(NotificationDeliveryMode.Digest);
  });

  it('returns null when rate-limited AND digest is disabled', async () => {
    const todayStr = today();
    const prior = Array.from({ length: NOTIFICATION_CONSTANTS.MAX_INSTANT_PER_TYPE_PER_DAY }, (_, i) =>
      makeNotification({
        userId: USER, type: TYPE,
        deliveryMode: NotificationDeliveryMode.Instant,
        isCanceled: false,
        createdAt: `${todayStr}T10:0${i}:00.000Z`,
        eventId: `prior-${i}`,
      }),
    );
    const notifRepo = new FakeNotificationRepo().seed(prior);

    // Disable both instant (rate limit takes care of instant) and digest
    const prefRepo = new FakeNotificationPreferenceRepo().seed([{
      id: 'pref1', userId: USER, organizationId: ORG, eventType: TYPE,
      instantEnabled: true, digestEnabled: false, // digest off
      dndStart: null, dndEnd: null,
      version: 1, createdAt: now(), updatedAt: now(),
    } as any]);
    const svc = makeService(notifRepo, prefRepo);

    const result = await svc.createNotification(
      USER, ORG, TYPE, 'application', 'app1', 'new-evt-2', 'Silenced',
    );
    expect(result).toBeNull();
  });

  it('rate limit counter only counts today\'s notifications (not yesterday\'s)', async () => {
    const yesterday = `${new Date(Date.now() - 86_400_000).toISOString().split('T')[0]}T10:00:00.000Z`;
    const stale = Array.from({ length: NOTIFICATION_CONSTANTS.MAX_INSTANT_PER_TYPE_PER_DAY }, (_, i) =>
      makeNotification({
        userId: USER, type: TYPE,
        deliveryMode: NotificationDeliveryMode.Instant,
        isCanceled: false,
        createdAt: yesterday,
        eventId: `stale-${i}`,
      }),
    );
    const notifRepo = new FakeNotificationRepo().seed(stale);
    const svc = makeService(notifRepo);

    const result = await svc.createNotification(
      USER, ORG, TYPE, 'application', 'app1', 'fresh-evt', 'Fresh',
    );
    // Yesterday's notifications don't count — should be Instant today
    expect(result).not.toBeNull();
    expect(result!.deliveryMode).toBe(NotificationDeliveryMode.Instant);
  });

  it('silences notification when both instant and digest are disabled', async () => {
    const prefRepo = new FakeNotificationPreferenceRepo().seed([{
      id: 'pref1', userId: USER, organizationId: ORG, eventType: TYPE,
      instantEnabled: false, digestEnabled: false,
      dndStart: null, dndEnd: null,
      version: 1, createdAt: now(), updatedAt: now(),
    } as any]);
    const svc = makeService(new FakeNotificationRepo(), prefRepo);

    const result = await svc.createNotification(
      USER, ORG, TYPE, 'application', 'app1', 'silent-evt', 'Silent',
    );
    expect(result).toBeNull();
  });
});

// ── DND (do-not-disturb) ───────────────────────────────────────────────────

describe('NotificationService — DND mode', () => {
  it('delivers as Delayed when user is in DND window', async () => {
    const dnd = makeFakeDnd(true); // always in DND
    const svc = makeService(new FakeNotificationRepo(), new FakeNotificationPreferenceRepo(), dnd);

    const result = await svc.createNotification(
      USER, ORG, TYPE, 'application', 'app1', 'dnd-evt', 'DND delivery',
    );
    expect(result).not.toBeNull();
    expect(result!.deliveryMode).toBe(NotificationDeliveryMode.Delayed);
  });
});

// ── Authorization ──────────────────────────────────────────────────────────

describe('NotificationService — authorization', () => {
  it("cannot read another user's unread notifications", async () => {
    const svc = makeService();
    await expect(
      svc.getUnreadForUser(OTHER_USER, USER, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it("cannot read another user's full notification list", async () => {
    const svc = makeService();
    await expect(
      svc.getAllForUser(OTHER_USER, USER, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it("cannot mark another user's notification as read", async () => {
    const notif = makeNotification({ id: 'n1', userId: OTHER_USER, organizationId: ORG });
    const svc = makeService(new FakeNotificationRepo().seed([notif]));
    await expect(
      svc.markAsRead('n1', USER, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it("cannot access another user's notification preferences", async () => {
    const svc = makeService();
    await expect(
      svc.getUserPreferences(OTHER_USER, USER),
    ).rejects.toThrow(AuthorizationError);
  });

  it("cannot update another user's notification preferences", async () => {
    const svc = makeService();
    await expect(
      svc.updatePreference(OTHER_USER, ORG, TYPE, true, true, null, null, USER),
    ).rejects.toThrow(AuthorizationError);
  });

  it("markAsRead is silently ignored for a notification from a different org", async () => {
    const notif = makeNotification({ id: 'n1', userId: USER, organizationId: 'other-org' });
    const svc = makeService(new FakeNotificationRepo().seed([notif]));
    // Should throw org mismatch
    await expect(svc.markAsRead('n1', USER, ORG)).rejects.toThrow(AuthorizationError);
  });
});

// ── Event type validation ────────────────────────────────────────────────────

describe('NotificationService — event type validation', () => {
  it('rejects notification with invalid event type', async () => {
    const svc = makeService();
    await expect(
      svc.createNotification(USER, ORG, 'totally_fake_event' as any, 'application', 'app1', 'evt1', 'Hello'),
    ).rejects.toThrow();
  });
});
