import { describe, it, expect } from 'vitest';
import { MessageService } from '../message.service';
import { ThreadContextType, UserRole } from '../../enums';
import { AuthorizationError, ValidationError, NotFoundError } from '../../errors';
import {
  FakeThreadRepo, FakeMessageRepo, FakeApplicationRepo, FakeInterviewRepo,
  fakeAudit, makeThread, makeMessage, makeApplication,
} from './helpers';
import { generateId, now } from '../../utils/id';

const ORG = 'org1';
const OTHER_ORG = 'org2';
const CANDIDATE = 'candidate1';
const OTHER_CANDIDATE = 'candidate2';
const EMPLOYER = 'employer1';
const INTERVIEWER = 'interviewer1';

const CANDIDATE_ROLES  = [UserRole.Candidate];
const EMPLOYER_ROLES   = [UserRole.Employer];
const ADMIN_ROLES      = [UserRole.Administrator];

function makeService(
  threadRepo  = new FakeThreadRepo(),
  msgRepo     = new FakeMessageRepo(),
  appRepo     = new FakeApplicationRepo(),
  intRepo     = new FakeInterviewRepo(),
) {
  return new MessageService(
    threadRepo as any, msgRepo as any,
    appRepo as any, intRepo as any,
    fakeAudit as any,
  );
}

// ── createThread — validation & RBAC ──────────────────────────────────────

describe('MessageService — createThread validation', () => {
  it('rejects a thread with only one participant (after actor is auto-added)', async () => {
    // Actor is added automatically; if we pass no extra participants the list has
    // only 1 member — the actor — which is below the minimum of 2.
    const svc = makeService(
      undefined, undefined,
      new FakeApplicationRepo().seed([
        makeApplication({ id: 'app1', organizationId: ORG, candidateId: CANDIDATE }),
      ]),
    );
    await expect(
      svc.createThread(ThreadContextType.Application, 'app1', [CANDIDATE], CANDIDATE, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('candidate cannot create a thread for another candidate\'s application', async () => {
    const appRepo = new FakeApplicationRepo().seed([
      makeApplication({ id: 'app1', organizationId: ORG, candidateId: OTHER_CANDIDATE }),
    ]);
    const svc = makeService(undefined, undefined, appRepo);
    await expect(
      svc.createThread(
        ThreadContextType.Application, 'app1',
        [OTHER_CANDIDATE, EMPLOYER],
        CANDIDATE, CANDIDATE_ROLES, ORG,
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it('cannot create a thread for an application from a different org', async () => {
    const appRepo = new FakeApplicationRepo().seed([
      makeApplication({ id: 'app1', organizationId: OTHER_ORG, candidateId: CANDIDATE }),
    ]);
    const svc = makeService(undefined, undefined, appRepo);
    await expect(
      svc.createThread(
        ThreadContextType.Application, 'app1',
        [CANDIDATE, EMPLOYER],
        CANDIDATE, CANDIDATE_ROLES, ORG,
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it('throws NotFoundError when application context does not exist', async () => {
    const svc = makeService(undefined, undefined, new FakeApplicationRepo());
    await expect(
      svc.createThread(
        ThreadContextType.Application, 'nonexistent',
        [CANDIDATE, EMPLOYER],
        EMPLOYER, EMPLOYER_ROLES, ORG,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('non-participant cannot create an interview thread', async () => {
    const intRepo = new FakeInterviewRepo().seed([{
      id: 'int1', organizationId: ORG, applicationId: 'app1',
      interviewerId: INTERVIEWER, candidateId: OTHER_CANDIDATE,
      startTime: now(), endTime: now(), status: 'scheduled',
      rescheduledAt: null, rescheduledBy: null,
      version: 1, createdAt: now(), updatedAt: now(),
    } as any]);
    const svc = makeService(undefined, undefined, undefined, intRepo);
    // CANDIDATE is not the candidateId (OTHER_CANDIDATE) nor the interviewerId
    await expect(
      svc.createThread(
        ThreadContextType.Interview, 'int1',
        [CANDIDATE, INTERVIEWER],
        CANDIDATE, CANDIDATE_ROLES, ORG,
      ),
    ).rejects.toThrow(AuthorizationError);
  });
});

// ── sendMessage — participant enforcement ─────────────────────────────────

describe('MessageService — sendMessage enforcement', () => {
  it('non-participant cannot send a message to a thread', async () => {
    const thread = makeThread({ id: 'thread1', participantIds: [CANDIDATE, EMPLOYER], organizationId: ORG });
    const svc = makeService(new FakeThreadRepo().seed([thread]));
    await expect(
      svc.sendMessage('thread1', 'Hello', 'intruder', ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('user from a different org cannot send to a thread in another org', async () => {
    const thread = makeThread({ id: 'thread1', participantIds: [CANDIDATE, EMPLOYER], organizationId: OTHER_ORG });
    const svc = makeService(new FakeThreadRepo().seed([thread]));
    await expect(
      svc.sendMessage('thread1', 'Hello', CANDIDATE, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('sending an empty message (whitespace-only) throws ValidationError', async () => {
    const thread = makeThread({ id: 'thread1', participantIds: [CANDIDATE, EMPLOYER], organizationId: ORG });
    const svc = makeService(new FakeThreadRepo().seed([thread]));
    await expect(
      svc.sendMessage('thread1', '   ', CANDIDATE, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('sending a message with only HTML tags (stripped to empty) throws ValidationError', async () => {
    const thread = makeThread({ id: 'thread1', participantIds: [CANDIDATE, EMPLOYER], organizationId: ORG });
    const svc = makeService(new FakeThreadRepo().seed([thread]));
    // sanitizePlainText strips all tags; result is empty
    await expect(
      svc.sendMessage('thread1', '<script>alert(1)</script>', CANDIDATE, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError when thread does not exist', async () => {
    const svc = makeService(new FakeThreadRepo());
    await expect(
      svc.sendMessage('ghost-thread', 'Hello', CANDIDATE, ORG),
    ).rejects.toThrow(NotFoundError);
  });
});

// ── getMessages — participant enforcement ─────────────────────────────────

describe('MessageService — getMessages enforcement', () => {
  it('non-participant cannot read thread messages', async () => {
    const thread = makeThread({ id: 'thread1', participantIds: [CANDIDATE, EMPLOYER], organizationId: ORG });
    const svc = makeService(new FakeThreadRepo().seed([thread]));
    await expect(
      svc.getMessages('thread1', 'outsider', ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('user from a different org cannot read a thread', async () => {
    const thread = makeThread({ id: 'thread1', participantIds: [CANDIDATE, EMPLOYER], organizationId: OTHER_ORG });
    const svc = makeService(new FakeThreadRepo().seed([thread]));
    await expect(
      svc.getMessages('thread1', CANDIDATE, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('participant can read their thread messages', async () => {
    const thread = makeThread({ id: 'thread1', participantIds: [CANDIDATE, EMPLOYER], organizationId: ORG });
    const msg = {
      id: generateId(), threadId: 'thread1', organizationId: ORG,
      senderId: EMPLOYER, content: 'Hello', isSensitive: false,
      readBy: [EMPLOYER], version: 1, createdAt: now(), updatedAt: now(),
    };
    const svc = makeService(
      new FakeThreadRepo().seed([thread]),
      new FakeMessageRepo().seed([msg as any]),
    );
    const messages = await svc.getMessages('thread1', CANDIDATE, ORG);
    expect(messages).toHaveLength(1);
  });
});

// ── getThreadsForUser ──────────────────────────────────────────────────────

describe('MessageService — getThreadsForUser', () => {
  it('returns only threads the user is a participant in', async () => {
    const myThread    = makeThread({ participantIds: [CANDIDATE, EMPLOYER], organizationId: ORG });
    const otherThread = makeThread({ participantIds: [OTHER_CANDIDATE, EMPLOYER], organizationId: ORG });
    const svc = makeService(new FakeThreadRepo().seed([myThread, otherThread]));
    const result = await svc.getThreadsForUser(CANDIDATE, ORG);
    expect(result).toHaveLength(1);
    expect(result[0].participantIds).toContain(CANDIDATE);
  });

  it('threads from a different org are excluded', async () => {
    const thread = makeThread({ participantIds: [CANDIDATE, EMPLOYER], organizationId: OTHER_ORG });
    const svc = makeService(new FakeThreadRepo().seed([thread]));
    const result = await svc.getThreadsForUser(CANDIDATE, ORG);
    expect(result).toHaveLength(0);
  });
});

// ── markAsRead enforcement ───────────────────────────────────────────────────

describe('MessageService — markAsRead enforcement', () => {
  it('non-participant cannot mark a message as read', async () => {
    const thread = makeThread({ id: 'thread1', participantIds: [CANDIDATE, EMPLOYER], organizationId: ORG });
    const msg = makeMessage({ id: 'msg1', threadId: 'thread1', senderId: CANDIDATE, readBy: [CANDIDATE], organizationId: ORG });
    const threadRepo = new FakeThreadRepo().seed([thread]);
    const msgRepo = new FakeMessageRepo().seed([msg]);
    const svc = makeService(threadRepo, msgRepo);
    await svc.markAsRead('msg1', 'outsider', ORG);
    // Message should still only have CANDIDATE in readBy
    const updated = await msgRepo.getById('msg1');
    expect(updated!.readBy).not.toContain('outsider');
  });

  it('participant CAN mark a message as read', async () => {
    const thread = makeThread({ id: 'thread1', participantIds: [CANDIDATE, EMPLOYER], organizationId: ORG });
    const msg = makeMessage({ id: 'msg1', threadId: 'thread1', senderId: CANDIDATE, readBy: [CANDIDATE], organizationId: ORG });
    const threadRepo = new FakeThreadRepo().seed([thread]);
    const msgRepo = new FakeMessageRepo().seed([msg]);
    const svc = makeService(threadRepo, msgRepo);
    await svc.markAsRead('msg1', EMPLOYER, ORG);
    const updated = await msgRepo.getById('msg1');
    expect(updated!.readBy).toContain(EMPLOYER);
  });
});
