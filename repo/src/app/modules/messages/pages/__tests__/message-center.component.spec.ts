import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { MessageCenterComponent } from '../message-center.component';
import { SessionService } from '../../../../core/services/session.service';
import { MessageService } from '../../../../core/services/message.service';
import { UserRole, ThreadContextType } from '../../../../core/enums';
import { Thread, Message } from '../../../../core/models';

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

const sampleThread: Thread = {
  id: 't1', organizationId: 'org1', contextType: 'general', contextId: 'ctx1',
  participantIds: ['user1', 'user2'],
  version: 1, createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z',
};

const sampleMessage: Message = {
  id: 'm1', organizationId: 'org1', threadId: 't1', senderId: 'user2',
  content: 'Hello there', isSensitive: false, readBy: ['user2'],
  version: 1, createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:00:00Z',
};

const ownMessage: Message = {
  id: 'm2', organizationId: 'org1', threadId: 't1', senderId: 'user1',
  content: 'Hi back', isSensitive: false, readBy: ['user1'],
  version: 1, createdAt: '2026-04-01T10:01:00Z', updatedAt: '2026-04-01T10:01:00Z',
};

function configure(overrides: Record<string, any> = {}) {
  const msgSvc = {
    getThreadsForUser: vi.fn().mockResolvedValue([sampleThread]),
    getMessages: vi.fn().mockResolvedValue([sampleMessage, ownMessage]),
    sendMessage: vi.fn().mockResolvedValue(ownMessage),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    createThread: vi.fn().mockResolvedValue(sampleThread),
    ...overrides,
  };

  TestBed.configureTestingModule({
    imports: [MessageCenterComponent],
    providers: [
      { provide: SessionService, useValue: makeSessionMock() },
      { provide: MessageService, useValue: msgSvc },
    ],
  });

  const fixture = TestBed.createComponent(MessageCenterComponent);
  return { component: fixture.componentInstance, msgSvc };
}

describe('MessageCenterComponent', () => {
  it('loads thread list for user', async () => {
    const { component, msgSvc } = configure();
    await component.loadThreads();
    expect(msgSvc.getThreadsForUser).toHaveBeenCalledWith('user1', 'org1');
    expect(component.threads().length).toBe(1);
    expect(component.threads()[0].id).toBe('t1');
  });

  it('selects thread and loads messages', async () => {
    const { component, msgSvc } = configure();
    await component.onSelectThread(sampleThread);
    expect(msgSvc.getMessages).toHaveBeenCalledWith('t1', 'user1', 'org1');
    expect(component.messages().length).toBe(2);
    expect(component.selectedThread()?.id).toBe('t1');
    // Should mark unread message from other user as read
    expect(msgSvc.markAsRead).toHaveBeenCalledWith('m1', 'user1', 'org1');
    // Should not mark own message as read
    expect(msgSvc.markAsRead).toHaveBeenCalledTimes(1);
  });

  it('sends a message and refreshes', async () => {
    const { component, msgSvc } = configure();
    component.selectedThread.set(sampleThread);
    component.messageControl.setValue('New message');
    await component.onSendMessage();
    expect(msgSvc.sendMessage).toHaveBeenCalledWith('t1', 'New message', 'user1', 'org1');
    expect(msgSvc.getMessages).toHaveBeenCalled();
    expect(component.messageControl.value).toBeFalsy();
  });

  it('shows empty state when no thread selected', () => {
    const { component } = configure();
    expect(component.selectedThread()).toBeNull();
    expect(component.messages().length).toBe(0);
  });

  it('creates a new thread', async () => {
    const { component, msgSvc } = configure();
    component.newThreadForm.setValue({
      contextType: 'general',
      contextId: 'ctx1',
      participantIds: 'user1,user2',
    });
    await component.onCreateThread();
    expect(msgSvc.createThread).toHaveBeenCalledWith(
      'general', 'ctx1', ['user1', 'user2'], 'user1', [UserRole.Candidate], 'org1',
    );
    expect(component.showNewThread()).toBe(false);
    // Should reload threads
    expect(msgSvc.getThreadsForUser).toHaveBeenCalled();
  });
});
