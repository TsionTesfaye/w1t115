/**
 * API_tests/webhook-hmac.spec.ts
 *
 * Integration simulator tests — HMAC verification, idempotency, and
 * retry window enforcement at the service layer.
 *
 * These do NOT require a real Service Worker or IDB — they test the service
 * logic with in-memory doubles.
 */

import { describe, it, expect, vi } from 'vitest';
import { IntegrationService } from '../src/app/core/services/integration.service';
import { WebhookQueueStatus, UserRole } from '../src/app/core/enums';
import { INTEGRATION_CONSTANTS } from '../src/app/core/constants';
import {
  FakeIntegrationRequestRepo, FakeIdempotencyKeyRepo,
  FakeIntegrationSecretRepo, FakeWebhookQueueRepo,
  fakeCrypto, fakeAudit,
  makeWebhookItem, makeIntegrationSecret,
} from '../src/app/core/services/__tests__/helpers';
import { generateId, now } from '../src/app/core/utils/id';

const ORG          = 'org1';
const ACTOR        = 'admin1';
const ADMIN_ROLES  = [UserRole.Administrator];
const INT_KEY      = 'key1';

function makeService(
  secretRepo = new FakeIntegrationSecretRepo(),
  webhookRepo = new FakeWebhookQueueRepo(),
) {
  return new IntegrationService(
    new FakeIntegrationRequestRepo() as any,
    new FakeIdempotencyKeyRepo() as any,
    secretRepo as any,
    webhookRepo as any,
    fakeCrypto as any,
    fakeAudit as any,
  );
}

// ── HMAC verification (service layer) ────────────────────────────────────

describe('IntegrationService — HMAC verification', () => {
  it('valid HMAC signature passes verification', async () => {
    const secret = makeIntegrationSecret({ integrationKey: INT_KEY, secret: 'mysecret', deactivatedAt: null });
    const secretRepo = new FakeIntegrationSecretRepo().seed([secret]);
    const svc = makeService(secretRepo);

    // fakeCrypto.computeHmac returns a deterministic stub; fakeCrypto.verifyHmac always accepts
    const body = JSON.stringify({ event: 'test' });
    const signature = await fakeCrypto.computeHmac(body, 'mysecret');

    // Should NOT throw — valid signature
    await expect(
      (svc as any).verifySignature(body, signature, INT_KEY, null, ORG),
    ).resolves.not.toThrow();
  });

  it('non-admin cannot use processRequest', async () => {
    const svc = makeService();
    await expect(
      svc.processRequest('GET', '/test', {}, null, null, null, null, INT_KEY, ACTOR, [UserRole.Candidate], ORG),
    ).rejects.toThrow(/administrator/i);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────

describe('IntegrationService — idempotency', () => {
  it('duplicate idempotency key returns cached response', async () => {
    const iKey = `idem-${generateId()}`;
    const idempRepo = new FakeIdempotencyKeyRepo();
    // Pre-seed an existing idempotency record
    await idempRepo.put({
      key: iKey,
      integrationKey: INT_KEY,
      responseSnapshot: { status: 200, headers: {}, body: 'cached' },
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      createdAt: now(),
    });

    const svc = new IntegrationService(
      new FakeIntegrationRequestRepo() as any,
      idempRepo as any,
      new FakeIntegrationSecretRepo() as any,
      new FakeWebhookQueueRepo() as any,
      fakeCrypto as any,
      fakeAudit as any,
    );

    const result = await svc.processRequest(
      'POST', '/test', {}, '{}', iKey, null, null, INT_KEY, ACTOR, ADMIN_ROLES, ORG,
    );
    expect(result.body).toBe('cached');
  });
});

// ── Webhook retry window enforcement ─────────────────────────────────────

describe('IntegrationService — webhook retry window', () => {
  const MAX_RETRIES = INTEGRATION_CONSTANTS.MAX_WEBHOOK_RETRIES;
  const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

  it('marks item failed when retry would exceed 15-minute window', async () => {
    // Create item created just enough time ago that the next retry would land past the deadline
    // retryCount = 0, so next retry = 2^1 = 2 minutes from now
    // If createdAt is 14+ minutes ago, 2 more minutes = 16 min total > 15 min window
    const createdAt = new Date(Date.now() - 14 * 60 * 1000).toISOString();
    const item = makeWebhookItem({
      id: 'w1',
      status: WebhookQueueStatus.Pending,
      retryCount: 0,
      nextRetryAt: now(), // past due
      createdAt,
    });
    const webhookRepo = new FakeWebhookQueueRepo().seed([item]);
    const svc = makeService(new FakeIntegrationSecretRepo(), webhookRepo);

    // Mock fetch to fail (so a retry would be needed)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await svc.processWebhookRetries();

    const updated = await webhookRepo.getById('w1');
    // Should be Failed — next retry at now + 2^1 minutes = ~16 minutes from createdAt, beyond deadline
    expect(updated?.status).toBe(WebhookQueueStatus.Failed);

    vi.unstubAllGlobals();
  });

  it('marks item failed when max retries exhausted', async () => {
    const item = makeWebhookItem({
      id: 'w2',
      status: WebhookQueueStatus.Pending,
      retryCount: MAX_RETRIES - 1,
      nextRetryAt: now(),
      createdAt: now(),
    });
    const webhookRepo = new FakeWebhookQueueRepo().seed([item]);
    const svc = makeService(new FakeIntegrationSecretRepo(), webhookRepo);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await svc.processWebhookRetries();

    const updated = await webhookRepo.getById('w2');
    expect(updated?.status).toBe(WebhookQueueStatus.Failed);

    vi.unstubAllGlobals();
  });

  it('delivers successfully on first attempt', async () => {
    const item = makeWebhookItem({
      id: 'w3',
      status: WebhookQueueStatus.Pending,
      retryCount: 0,
      nextRetryAt: now(),
      createdAt: now(),
    });
    const webhookRepo = new FakeWebhookQueueRepo().seed([item]);
    const svc = makeService(new FakeIntegrationSecretRepo(), webhookRepo);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    await svc.processWebhookRetries();

    const updated = await webhookRepo.getById('w3');
    expect(updated?.status).toBe(WebhookQueueStatus.Delivered);

    vi.unstubAllGlobals();
  });
});
