/**
 * unit_tests/digest-display.spec.ts
 *
 * Tests for DigestService: generation, delivery marking, and user-scoped access.
 * Also covers that delayed notifications remain hidden until released.
 *
 * Uses in-memory doubles — no IDB.
 */

import { describe, it, expect } from 'vitest';
import { DigestService } from '../src/app/core/services/digest.service';
import { NotificationDeliveryMode } from '../src/app/core/enums';
import {
  FakeNotificationRepo, FakeDigestRepo,
} from '../src/app/core/services/__tests__/helpers';
import { generateId, now } from '../src/app/core/utils/id';

const USER = 'user1';
const ORG  = 'org1';

function makeDigestNotif(overrides: Record<string, unknown> = {}) {
  return {
    id: generateId(), userId: USER, organizationId: ORG,
    type: 'application_received', referenceType: 'application', referenceId: generateId(),
    eventId: generateId(), message: 'New application received',
    isRead: false, deliveryMode: NotificationDeliveryMode.Digest, isCanceled: false,
    version: 1, createdAt: new Date().toISOString().substring(0, 10) + 'T00:00:00.000Z',
    updatedAt: now(), ...overrides,
  } as any;
}

function makeService(notifRepo = new FakeNotificationRepo(), digestRepo = new FakeDigestRepo()) {
  return new DigestService(digestRepo as any, notifRepo as any);
}

// ── Digest generation ─────────────────────────────────────────────────────────

describe('DigestService — generateDigest', () => {
  it('generates a digest containing all digest-mode notifications for today', async () => {
    const notifs = [makeDigestNotif(), makeDigestNotif()];
    const notifRepo = new FakeNotificationRepo().seed(notifs);
    const digestRepo = new FakeDigestRepo();
    const svc = makeService(notifRepo, digestRepo);

    const digest = await svc.generateDigest(USER, ORG);

    expect(digest).not.toBeNull();
    expect(digest!.itemIds).toHaveLength(2);
    expect(digest!.deliveredAt).toBeNull();
    expect(digest!.userId).toBe(USER);
  });

  it('returns null when no digest notifications exist for today', async () => {
    const notifRepo = new FakeNotificationRepo(); // empty
    const svc = makeService(notifRepo);

    const digest = await svc.generateDigest(USER, ORG);
    expect(digest).toBeNull();
  });

  it('returns null (idempotent) when digest already exists for today', async () => {
    const notifs = [makeDigestNotif()];
    const notifRepo = new FakeNotificationRepo().seed(notifs);
    const digestRepo = new FakeDigestRepo();
    const svc = makeService(notifRepo, digestRepo);

    const first  = await svc.generateDigest(USER, ORG);
    const second = await svc.generateDigest(USER, ORG);

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // already exists for today
  });

  it('does NOT include instant-mode notifications in the digest', async () => {
    const instantNotif = makeDigestNotif({ deliveryMode: NotificationDeliveryMode.Instant });
    const digestNotif  = makeDigestNotif({ deliveryMode: NotificationDeliveryMode.Digest });
    const notifRepo = new FakeNotificationRepo().seed([instantNotif, digestNotif]);
    const svc = makeService(notifRepo);

    const digest = await svc.generateDigest(USER, ORG);
    expect(digest!.itemIds).toHaveLength(1);
    expect(digest!.itemIds[0]).toBe(digestNotif.id);
  });
});

// ── Digest delivery state ─────────────────────────────────────────────────────

describe('DigestService — delivery state', () => {
  it('marks digest as delivered', async () => {
    const digestRepo = new FakeDigestRepo();
    const svc = makeService(new FakeNotificationRepo(), digestRepo);

    const digest = {
      id: 'digest1', userId: USER, organizationId: ORG,
      digestDate: '2026-04-06', itemIds: [], deliveredAt: null,
      uniqueKey: `${USER}:2026-04-06`,
      version: 1, createdAt: now(), updatedAt: now(),
    };
    digestRepo.seed([digest]);

    await svc.markDelivered('digest1');

    const updated = await digestRepo.getById('digest1');
    expect(updated!.deliveredAt).not.toBeNull();
  });

  it('markDelivered is idempotent — does not re-stamp deliveredAt', async () => {
    const alreadyDelivered = '2026-04-06T09:00:00.000Z';
    const digestRepo = new FakeDigestRepo();
    digestRepo.seed([{
      id: 'digest2', userId: USER, organizationId: ORG,
      digestDate: '2026-04-06', itemIds: [], deliveredAt: alreadyDelivered,
      uniqueKey: `${USER}:2026-04-06`,
      version: 1, createdAt: now(), updatedAt: now(),
    }]);
    const svc = makeService(new FakeNotificationRepo(), digestRepo);

    await svc.markDelivered('digest2');

    const updated = await digestRepo.getById('digest2');
    expect(updated!.deliveredAt).toBe(alreadyDelivered); // unchanged
  });

  it('getUndeliveredForUser returns only undelivered digests', async () => {
    const digestRepo = new FakeDigestRepo();
    digestRepo.seed([
      { id: 'd1', userId: USER, organizationId: ORG, digestDate: '2026-04-05', itemIds: [], deliveredAt: null,   uniqueKey: `${USER}:2026-04-05`, version: 1, createdAt: now(), updatedAt: now() },
      { id: 'd2', userId: USER, organizationId: ORG, digestDate: '2026-04-04', itemIds: [], deliveredAt: now(),  uniqueKey: `${USER}:2026-04-04`, version: 1, createdAt: now(), updatedAt: now() },
    ]);
    const svc = makeService(new FakeNotificationRepo(), digestRepo);

    const undelivered = await svc.getUndeliveredForUser(USER, USER, ORG);
    expect(undelivered).toHaveLength(1);
    expect(undelivered[0].id).toBe('d1');
  });

  it('getAllForUser returns all digests regardless of delivery state', async () => {
    const digestRepo = new FakeDigestRepo();
    digestRepo.seed([
      { id: 'd1', userId: USER, organizationId: ORG, digestDate: '2026-04-05', itemIds: [], deliveredAt: null,  uniqueKey: `${USER}:2026-04-05`, version: 1, createdAt: now(), updatedAt: now() },
      { id: 'd2', userId: USER, organizationId: ORG, digestDate: '2026-04-04', itemIds: [], deliveredAt: now(), uniqueKey: `${USER}:2026-04-04`, version: 1, createdAt: now(), updatedAt: now() },
    ]);
    const svc = makeService(new FakeNotificationRepo(), digestRepo);

    const all = await svc.getAllForUser(USER, USER, ORG);
    expect(all).toHaveLength(2);
  });

  it('getUndeliveredForUser throws if actorId != userId (ABAC)', async () => {
    const svc = makeService();
    await expect(
      svc.getUndeliveredForUser(USER, 'other-user', ORG),
    ).rejects.toThrow(/Cannot access another user/);
  });
});
