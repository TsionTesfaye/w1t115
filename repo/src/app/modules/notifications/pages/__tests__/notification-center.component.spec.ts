/**
 * NotificationCenterComponent tests — real NotificationService and DigestService
 * backed by in-memory repos from helpers.ts.
 *
 * Boundary stubs kept:
 *  - SessionService → plain stub (no crypto/IDB)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';

import { NotificationCenterComponent } from '../notification-center.component';
import { SessionService } from '../../../../core/services/session.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { DigestService } from '../../../../core/services/digest.service';
import { DNDService } from '../../../../core/services/dnd.service';

import { UserRole, NotificationDeliveryMode } from '../../../../core/enums';
import { Notification, NotificationPreference } from '../../../../core/models';
import { now } from '../../../../core/utils/id';

import {
  FakeNotificationRepo, FakeNotificationPreferenceRepo,
  FakeDelayedDeliveryRepo, FakeDigestRepo,
  fakeAudit, makeNotification,
} from '../../../../core/services/__tests__/helpers';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Session stub ──────────────────────────────────────────────────────────────

function makeSessionStub(userId = 'user1', orgId = 'org1') {
  return {
    activeRole: signal(UserRole.Candidate),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test User' }),
    organizationId: computed(() => orgId),
    userId: computed(() => userId),
    userRoles: computed(() => [UserRole.Candidate]),
    requireAuth: () => ({
      userId, organizationId: orgId,
      roles: [UserRole.Candidate], activeRole: UserRole.Candidate,
    }),
  };
}

// ── Service factories ─────────────────────────────────────────────────────────

function makeNotifSvc(
  notifRepo = new FakeNotificationRepo(),
  prefRepo = new FakeNotificationPreferenceRepo(),
  delayedRepo = new FakeDelayedDeliveryRepo(),
) {
  const dnd = new DNDService(prefRepo as any, delayedRepo as any);
  return new NotificationService(notifRepo as any, prefRepo as any, dnd as any, delayedRepo as any);
}

function makeDigestSvc(
  digestRepo = new FakeDigestRepo(),
  notifRepo = new FakeNotificationRepo(),
) {
  return new DigestService(digestRepo as any, notifRepo as any);
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const unreadNotif: Notification = {
  id: 'n1', organizationId: 'org1', userId: 'user1',
  type: 'application_received', referenceType: 'application', referenceId: 'app1',
  eventId: 'ev1', message: 'You received an application', isRead: false,
  deliveryMode: NotificationDeliveryMode.Instant, isCanceled: false,
  version: 1, createdAt: now(), updatedAt: now(),
};

const readNotif: Notification = {
  id: 'n2', organizationId: 'org1', userId: 'user1',
  type: 'interview_confirmed', referenceType: 'interview', referenceId: 'int1',
  eventId: 'ev2', message: 'Interview confirmed', isRead: true,
  deliveryMode: NotificationDeliveryMode.Instant, isCanceled: false,
  version: 1, createdAt: now(), updatedAt: now(),
};

const samplePref: NotificationPreference = {
  id: 'pref1', userId: 'user1', organizationId: 'org1',
  eventType: 'application_received', instantEnabled: true, digestEnabled: false,
  dndStart: null, dndEnd: null,
  version: 1, createdAt: now(), updatedAt: now(),
};

// ── Configure helper ─────────────────────────────────────────────────────────

function configure(
  seedNotifs: Notification[] = [],
  seedPrefs: NotificationPreference[] = [],
) {
  const notifRepo = new FakeNotificationRepo();
  if (seedNotifs.length) notifRepo.seed(seedNotifs);

  const prefRepo = new FakeNotificationPreferenceRepo();
  if (seedPrefs.length) prefRepo.seed(seedPrefs);

  const delayedRepo = new FakeDelayedDeliveryRepo();
  const digestRepo = new FakeDigestRepo();

  const realNotifSvc = makeNotifSvc(notifRepo, prefRepo, delayedRepo);
  const realDigestSvc = makeDigestSvc(digestRepo, notifRepo);

  const sessionStub = makeSessionStub();

  TestBed.configureTestingModule({
    imports: [NotificationCenterComponent],
    providers: [
      { provide: SessionService, useValue: sessionStub },
      { provide: NotificationService, useValue: realNotifSvc },
      { provide: DigestService, useValue: realDigestSvc },
    ],
  });

  const fixture = TestBed.createComponent(NotificationCenterComponent);
  return { component: fixture.componentInstance, notifRepo, prefRepo };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationCenterComponent', () => {
  it('loads all notifications via real NotificationService', async () => {
    const { component } = configure([unreadNotif, readNotif]);

    await component.loadNotifications();

    expect(component.notifications()).toHaveLength(2);
    expect(component.unreadCount()).toBe(1);
  });

  it('filters to show only unread', async () => {
    const { component } = configure([unreadNotif, readNotif]);

    await component.loadNotifications();
    component.filter.set('unread');

    expect(component.filteredNotifications()).toHaveLength(1);
    expect(component.filteredNotifications()[0].id).toBe('n1');
  });

  it('marks individual notification as read via real service', async () => {
    const { component, notifRepo } = configure([unreadNotif, readNotif]);

    await component.loadNotifications();
    await component.onMarkRead(unreadNotif);

    // Local state updated
    expect(component.notifications().find(n => n.id === 'n1')?.isRead).toBe(true);
    // Repo also updated
    const updated = await notifRepo.getById('n1');
    expect(updated?.isRead).toBe(true);
  });

  it('marks all as read via real service', async () => {
    const { component, notifRepo } = configure([unreadNotif, readNotif]);

    await component.loadNotifications();
    await component.onMarkAllRead();

    expect(component.notifications().every(n => n.isRead)).toBe(true);
    const updatedN1 = await notifRepo.getById('n1');
    expect(updatedN1?.isRead).toBe(true);
  });

  it('loads and displays preferences via real service', async () => {
    const { component } = configure([], [samplePref]);

    await component.loadPreferences();

    expect(component.preferences()).toHaveLength(1);
    expect(component.getPrefValue('application_received', 'instant')).toBe(true);
    expect(component.getPrefValue('application_received', 'digest')).toBe(false);
  });

  it('updates a preference via real service', async () => {
    const { component, prefRepo } = configure([], [samplePref]);

    await component.loadPreferences();
    component.onTogglePref('application_received', 'digest', { target: { checked: true } } as any);
    await component.onSavePref('application_received');

    const updatedPref = await prefRepo.getByUserAndType('user1', 'application_received');
    expect(updatedPref?.digestEnabled).toBe(true);
  });
});
