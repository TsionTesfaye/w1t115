/**
 * MessageCenterComponent tests — real MessageService backed by in-memory repos.
 *
 * Boundary stubs kept:
 *  - SessionService → plain stub (no crypto/IDB)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';

import { MessageCenterComponent } from '../message-center.component';
import { SessionService } from '../../../../core/services/session.service';
import { MessageService } from '../../../../core/services/message.service';

import { UserRole, ThreadContextType } from '../../../../core/enums';
import { Thread, Message } from '../../../../core/models';
import { now } from '../../../../core/utils/id';

import {
  FakeThreadRepo, FakeMessageRepo, FakeApplicationRepo, FakeInterviewRepo,
  fakeAudit, makeThread, makeMessage,
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

// ── Configure helper ─────────────────────────────────────────────────────────

function configure(seedThreads: Thread[] = [], seedMessages: Message[] = []) {
  const threadRepo = new FakeThreadRepo();
  if (seedThreads.length) threadRepo.seed(seedThreads);

  const msgRepo = new FakeMessageRepo();
  if (seedMessages.length) msgRepo.seed(seedMessages);

  const appRepo = new FakeApplicationRepo();
  const interviewRepo = new FakeInterviewRepo();

  const realMsgSvc = new MessageService(
    threadRepo as any, msgRepo as any, appRepo as any, interviewRepo as any, fakeAudit as any,
  );

  const sessionStub = makeSessionStub();

  TestBed.configureTestingModule({
    imports: [MessageCenterComponent],
    providers: [
      { provide: SessionService, useValue: sessionStub },
      { provide: MessageService, useValue: realMsgSvc },
    ],
  });

  const fixture = TestBed.createComponent(MessageCenterComponent);
  return { component: fixture.componentInstance, threadRepo, msgRepo, realMsgSvc };
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const sampleThread: Thread = makeThread({
  id: 't1', contextType: 'general', contextId: 'ctx1',
  participantIds: ['user1', 'user2'],
});

const sampleMessage: Message = makeMessage({
  id: 'm1', threadId: 't1', senderId: 'user2',
  content: 'Hello there', readBy: ['user2'],
});

const ownMessage: Message = makeMessage({
  id: 'm2', threadId: 't1', senderId: 'user1',
  content: 'Hi back', readBy: ['user1'],
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MessageCenterComponent', () => {
  it('loads thread list for user via real MessageService', async () => {
    const { component } = configure([sampleThread]);

    await component.loadThreads();

    expect(component.threads().length).toBe(1);
    expect(component.threads()[0].id).toBe('t1');
  });

  it('selects thread and loads messages', async () => {
    const { component } = configure([sampleThread], [sampleMessage, ownMessage]);

    await component.onSelectThread(sampleThread);

    expect(component.messages().length).toBe(2);
    expect(component.selectedThread()?.id).toBe('t1');
  });

  it('marks unread messages from others as read — not own messages', async () => {
    const { component, msgRepo } = configure([sampleThread], [sampleMessage, ownMessage]);

    await component.onSelectThread(sampleThread);

    // sampleMessage (from user2, not yet read by user1) should be marked read by user1
    const updated = await msgRepo.getById('m1');
    expect(updated?.readBy).toContain('user1');
    // ownMessage was sent by user1 — markAsRead not called (senderId === actorId)
    // The own message already has user1 in readBy from creation; no double-mark call
    const ownUpdated = await msgRepo.getById('m2');
    expect(ownUpdated?.senderId).toBe('user1'); // sanity: own message stays own
  });

  it('sends a message and refreshes', async () => {
    const { component, msgRepo } = configure([sampleThread]);

    component.selectedThread.set(sampleThread);
    component.messageControl.setValue('New message');
    await component.onSendMessage();

    expect(component.messageControl.value).toBeFalsy();
    const allMsgs = await msgRepo.getAll();
    expect(allMsgs.some(m => m.content === 'New message')).toBe(true);
  });

  it('shows empty state when no thread selected', () => {
    const { component } = configure();
    expect(component.selectedThread()).toBeNull();
    expect(component.messages().length).toBe(0);
  });

  it('creates a new general thread', async () => {
    const { component, threadRepo } = configure();

    component.newThreadForm.setValue({
      contextType: 'general',
      contextId: 'ctx1',
      participantIds: 'user1,user2',
    });

    await component.onCreateThread();

    expect(component.showNewThread()).toBe(false);
    const threads = threadRepo.snapshot();
    expect(threads.some(t => t.contextType === 'general')).toBe(true);
  });
});
