import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { NotificationCenterComponent } from '../notification-center.component';
import { SessionService } from '../../../../core/services/session.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { DigestService } from '../../../../core/services/digest.service';
import { UserRole, NotificationEventType } from '../../../../core/enums';
import { Notification, NotificationPreference } from '../../../../core/models';

afterEach(() => {
  TestBed.resetTestingModule();
});

function makeSessionMock() {
  return {
    activeRole: signal(UserRole.Candidate),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test User' }),
    organizationId: computed(() => 'org1'),
    userId: computed(() => 'user1'),
    userRoles: computed(() => [UserRole.Candidate]),
    requireAuth: () => ({
      userId: 'user1',
      organizationId: 'org1',
      roles: [UserRole.Candidate],
      activeRole: UserRole.Candidate,
    }),
  };
}

const unreadNotif: Notification = {
  id: 'n1', organizationId: 'org1', userId: 'user1',
  type: 'application_received', referenceType: 'application', referenceId: 'app1',
  eventId: 'ev1', message: 'You received an application', isRead: false,
  deliveryMode: 'instant', isCanceled: false,
  version: 1, createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:00:00Z',
};

const readNotif: Notification = {
  id: 'n2', organizationId: 'org1', userId: 'user1',
  type: 'interview_confirmed', referenceType: 'interview', referenceId: 'int1',
  eventId: 'ev2', message: 'Interview confirmed', isRead: true,
  deliveryMode: 'instant', isCanceled: false,
  version: 1, createdAt: '2026-04-01T09:00:00Z', updatedAt: '2026-04-01T09:00:00Z',
};

const samplePref: NotificationPreference = {
  id: 'pref1', userId: 'user1', organizationId: 'org1',
  eventType: 'application_received', instantEnabled: true, digestEnabled: false,
  dndStart: null, dndEnd: null,
  version: 1, createdAt: '2026-04-01', updatedAt: '2026-04-01',
};

function configure(overrides: Record<string, any> = {}) {
  const notifSvc = {
    getAllForUser: vi.fn().mockResolvedValue([unreadNotif, readNotif]),
    getUnreadForUser: vi.fn().mockResolvedValue([unreadNotif]),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    getUserPreferences: vi.fn().mockResolvedValue([samplePref]),
    updatePreference: vi.fn().mockResolvedValue(samplePref),
    ...overrides,
  };

  const digestSvc = {
    getAllForUser: vi.fn().mockResolvedValue([]),
    getUndeliveredForUser: vi.fn().mockResolvedValue([]),
    markDelivered: vi.fn().mockResolvedValue(undefined),
    generateDigest: vi.fn().mockResolvedValue(null),
  };

  TestBed.configureTestingModule({
    imports: [NotificationCenterComponent],
    providers: [
      { provide: SessionService, useValue: makeSessionMock() },
      { provide: NotificationService, useValue: notifSvc },
      { provide: DigestService, useValue: digestSvc },
    ],
  });

  const fixture = TestBed.createComponent(NotificationCenterComponent);
  return { component: fixture.componentInstance, notifSvc };
}

describe('NotificationCenterComponent', () => {
  it('loads all notifications', async () => {
    const { component, notifSvc } = configure();
    await component.loadNotifications();
    expect(notifSvc.getAllForUser).toHaveBeenCalledWith('user1', 'user1', 'org1');
    expect(component.notifications().length).toBe(2);
    expect(component.unreadCount()).toBe(1);
  });

  it('filters to show only unread', async () => {
    const { component } = configure();
    await component.loadNotifications();
    component.filter.set('unread');
    expect(component.filteredNotifications().length).toBe(1);
    expect(component.filteredNotifications()[0].id).toBe('n1');
  });

  it('marks individual notification as read', async () => {
    const { component, notifSvc } = configure();
    await component.loadNotifications();
    await component.onMarkRead(unreadNotif);
    expect(notifSvc.markAsRead).toHaveBeenCalledWith('n1', 'user1', 'org1');
    // Should update local state
    expect(component.notifications().find(n => n.id === 'n1')?.isRead).toBe(true);
  });

  it('marks all as read', async () => {
    const { component, notifSvc } = configure();
    await component.loadNotifications();
    await component.onMarkAllRead();
    expect(notifSvc.markAsRead).toHaveBeenCalledWith('n1', 'user1', 'org1');
    expect(component.notifications().every(n => n.isRead)).toBe(true);
  });

  it('loads and displays preferences', async () => {
    const { component, notifSvc } = configure();
    await component.loadPreferences();
    expect(notifSvc.getUserPreferences).toHaveBeenCalledWith('user1', 'user1');
    expect(component.preferences().length).toBe(1);
    expect(component.getPrefValue('application_received', 'instant')).toBe(true);
    expect(component.getPrefValue('application_received', 'digest')).toBe(false);
  });

  it('updates a preference', async () => {
    const { component, notifSvc } = configure();
    await component.loadPreferences();
    // Toggle digest on for application_received
    component.onTogglePref('application_received', 'digest', { target: { checked: true } } as any);
    await component.onSavePref('application_received');
    expect(notifSvc.updatePreference).toHaveBeenCalledWith(
      'user1', 'org1', 'application_received',
      true, true, null, null, 'user1',
    );
  });
});
