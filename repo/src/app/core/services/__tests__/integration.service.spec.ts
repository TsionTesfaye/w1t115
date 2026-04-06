/**
 * IntegrationService tests
 *
 * fetch() is stubbed with vi.stubGlobal so tests are fully offline.
 * Real CryptoService is used for HMAC tests so signature verification is exercised end-to-end.
 * All other repos are in-memory fakes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IntegrationService } from '../integration.service';
import { CryptoService } from '../crypto.service';
import { AuthorizationError, RateLimitError, ValidationError } from '../../errors';
import { UserRole, WebhookQueueStatus } from '../../enums';
import { now } from '../../utils/id';
import {
  FakeIntegrationRequestRepo,
  FakeIdempotencyKeyRepo,
  FakeIntegrationSecretRepo,
  FakeWebhookQueueRepo,
  fakeAudit,
  makeWebhookItem,
  makeIntegrationSecret,
} from './helpers';
import type { IntegrationResponse } from '../../models';

// ── Setup ────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = [UserRole.Administrator];
const CANDIDATE_ROLES = [UserRole.Candidate];

function makeRepos() {
  return {
    intRepo: new FakeIntegrationRequestRepo(),
    idempRepo: new FakeIdempotencyKeyRepo(),
    secretRepo: new FakeIntegrationSecretRepo(),
    webhookRepo: new FakeWebhookQueueRepo(),
  };
}

function makeSvc(
  repos = makeRepos(),
  crypto: any = new CryptoService(),
) {
  return {
    svc: new IntegrationService(
      repos.intRepo as any,
      repos.idempRepo as any,
      repos.secretRepo as any,
      repos.webhookRepo as any,
      crypto,
      fakeAudit as any,
    ),
    ...repos,
  };
}

/** Helper: mock fetch to return a 200 JSON response. */
function mockFetch200(body = '{"ok":true}') {
  return vi.fn().mockResolvedValue({
    status: 200,
    ok: true,
    text: async () => body,
    headers: { forEach: (_cb: any) => {} },
  });
}

/** Helper: mock fetch to return a 429 response. */
function mockFetch429() {
  return vi.fn().mockResolvedValue({
    status: 429,
    ok: false,
    text: async () => 'Too Many Requests',
    headers: { forEach: (_cb: any) => {} },
  });
}

/** Helper: mock fetch to reject (network error). */
function mockFetchFailure() {
  return vi.fn().mockRejectedValue(new Error('network error'));
}

afterEach(() => vi.unstubAllGlobals());

// ── RBAC ──────────────────────────────────────────────────────────────────────

describe('IntegrationService RBAC', () => {
  it('processRequest throws AuthorizationError for non-admin', async () => {
    vi.stubGlobal('fetch', mockFetch200());
    const { svc } = makeSvc();
    await expect(
      svc.processRequest('GET', '/test', {}, null, null, null, null, 'key1', 'u1', CANDIDATE_ROLES, 'org1'),
    ).rejects.toThrow(AuthorizationError);
  });

  it('getWebhookQueue throws AuthorizationError for non-admin', async () => {
    const { svc } = makeSvc();
    await expect(svc.getWebhookQueue(CANDIDATE_ROLES, 'org1')).rejects.toThrow(AuthorizationError);
  });
});

// ── Idempotency cache ─────────────────────────────────────────────────────────

describe('IntegrationService idempotency', () => {
  it('returns cached response without calling fetch if key is valid and not expired', async () => {
    const fetchMock = mockFetch200();
    vi.stubGlobal('fetch', fetchMock);
    const cachedResponse: IntegrationResponse = { status: 200, body: '{"cached":true}', headers: {} };
    const { svc, idempRepo } = makeSvc();
    idempRepo.seed([{
      key: 'idem-key-1',
      integrationKey: 'key1',
      responseSnapshot: cachedResponse,
      createdAt: now(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }]);
    const result = await svc.processRequest(
      'GET', '/endpoint', {}, null, 'idem-key-1', null, null, 'key1', 'u1', ADMIN_ROLES, 'org1',
    );
    expect(result).toEqual(cachedResponse);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls fetch when the cached key is expired', async () => {
    const fetchMock = mockFetch200('{"fresh":true}');
    vi.stubGlobal('fetch', fetchMock);
    const { svc, idempRepo } = makeSvc();
    idempRepo.seed([{
      key: 'idem-key-2',
      integrationKey: 'key1',
      responseSnapshot: { status: 200, body: '{"stale":true}', headers: {} },
      createdAt: new Date(Date.now() - 7_200_000).toISOString(),
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(), // expired
    }]);
    const result = await svc.processRequest(
      'GET', '/endpoint', {}, null, 'idem-key-2', null, null, 'key1', 'u1', ADMIN_ROLES, 'org1',
    );
    expect(result.body).toBe('{"fresh":true}');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe('IntegrationService rate limiting', () => {
  it('throws RateLimitError when fetch returns 429', async () => {
    vi.stubGlobal('fetch', mockFetch429());
    const { svc } = makeSvc();
    await expect(
      svc.processRequest('GET', '/endpoint', {}, null, null, null, null, 'key1', 'u1', ADMIN_ROLES, 'org1'),
    ).rejects.toThrow(RateLimitError);
  });
});

// ── HMAC signature verification ───────────────────────────────────────────────

describe('IntegrationService HMAC verification', () => {
  const SECRET = 'super-secret-webhook-key';
  const BODY = '{"event":"job.created"}';

  it('passes when signature matches the current secret version', async () => {
    vi.stubGlobal('fetch', mockFetch200());
    const crypto = new CryptoService();
    const sig = await crypto.computeHmac(BODY, SECRET);
    const { svc, secretRepo } = makeSvc(makeRepos(), crypto);
    secretRepo.seed([makeIntegrationSecret({ integrationKey: 'key1', secret: SECRET, version: 1 })]);
    const result = await svc.processRequest(
      'POST', '/endpoint', {}, BODY, null, sig, 1, 'key1', 'u1', ADMIN_ROLES, 'org1',
    );
    expect(result.status).toBe(200);
  });

  it('throws ValidationError for an invalid signature', async () => {
    vi.stubGlobal('fetch', mockFetch200());
    const crypto = new CryptoService();
    const { svc, secretRepo } = makeSvc(makeRepos(), crypto);
    secretRepo.seed([makeIntegrationSecret({ integrationKey: 'key1', secret: SECRET, version: 1 })]);
    await expect(
      svc.processRequest('POST', '/endpoint', {}, BODY, null, 'deadbeefdeadbeef00000000000000000000000000000000000000000000000000', 1, 'key1', 'u1', ADMIN_ROLES, 'org1'),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when no secrets are configured for the integration key', async () => {
    vi.stubGlobal('fetch', mockFetch200());
    const crypto = new CryptoService();
    const sig = await crypto.computeHmac(BODY, SECRET);
    const { svc } = makeSvc(makeRepos(), crypto);
    // secretRepo has no secrets for 'key1'
    await expect(
      svc.processRequest('POST', '/endpoint', {}, BODY, null, sig, 1, 'key1', 'u1', ADMIN_ROLES, 'org1'),
    ).rejects.toThrow(ValidationError);
  });

  it('accepts signature from a manually-seeded active prior version (both active = both candidates)', async () => {
    vi.stubGlobal('fetch', mockFetch200());
    const crypto = new CryptoService();
    const OLD_SECRET = 'old-secret';
    const sigWithOld = await crypto.computeHmac(BODY, OLD_SECRET);
    const { svc, secretRepo } = makeSvc(makeRepos(), crypto);
    // Both secrets seeded as active (no deactivatedAt) — simulates two co-active secrets
    secretRepo.seed([
      makeIntegrationSecret({ integrationKey: 'key1', secret: SECRET, version: 2, deactivatedAt: null }),
      makeIntegrationSecret({ integrationKey: 'key1', secret: OLD_SECRET, version: 1, deactivatedAt: null }),
    ]);
    // secretVersion=2 means current=2, prior=1 → both checked; v1 sig accepted since v1 is still active
    const result = await svc.processRequest(
      'POST', '/endpoint', {}, BODY, null, sigWithOld, 2, 'key1', 'u1', ADMIN_ROLES, 'org1',
    );
    expect(result.status).toBe(200);
  });
});

// ── enqueueWebhook ────────────────────────────────────────────────────────────

describe('IntegrationService.enqueueWebhook', () => {
  it('stores item with status=Pending and retryCount=0', async () => {
    const { svc, webhookRepo } = makeSvc();
    const item = await svc.enqueueWebhook('target-a', '{"x":1}', 'org1');
    expect(item.status).toBe(WebhookQueueStatus.Pending);
    expect(item.retryCount).toBe(0);
    expect(item.organizationId).toBe('org1');
    expect((await webhookRepo.getAll()).length).toBe(1);
  });
});

// ── processWebhookRetries ─────────────────────────────────────────────────────

describe('IntegrationService.processWebhookRetries', () => {
  it('marks item as Delivered on successful fetch', async () => {
    vi.stubGlobal('fetch', mockFetch200());
    const { svc, webhookRepo } = makeSvc();
    const item = makeWebhookItem({ status: WebhookQueueStatus.Pending, nextRetryAt: now() });
    webhookRepo.seed([item]);
    await svc.processWebhookRetries();
    const updated = await webhookRepo.getById(item.id);
    expect(updated!.status).toBe(WebhookQueueStatus.Delivered);
  });

  it('increments retryCount and sets nextRetryAt on failure, status stays Pending', async () => {
    vi.stubGlobal('fetch', mockFetchFailure());
    const { svc, webhookRepo } = makeSvc();
    const item = makeWebhookItem({ status: WebhookQueueStatus.Pending, retryCount: 0, nextRetryAt: now() });
    webhookRepo.seed([item]);
    const before = Date.now();
    await svc.processWebhookRetries();
    const updated = await webhookRepo.getById(item.id);
    expect(updated!.retryCount).toBe(1);
    expect(updated!.status).toBe(WebhookQueueStatus.Pending);
    // nextRetryAt = now + 2^1 * 60000 = now + 120000 ms
    const expectedMinRetry = new Date(before + 2 * 60_000 - 5000).toISOString();
    expect(updated!.nextRetryAt > expectedMinRetry).toBe(true);
  });

  it('marks item as Failed when MAX_WEBHOOK_RETRIES is reached', async () => {
    vi.stubGlobal('fetch', mockFetchFailure());
    const { svc, webhookRepo } = makeSvc();
    // retryCount=4 — one more failure brings it to 5 = MAX_WEBHOOK_RETRIES
    const item = makeWebhookItem({ status: WebhookQueueStatus.Pending, retryCount: 4, nextRetryAt: now() });
    webhookRepo.seed([item]);
    await svc.processWebhookRetries();
    const updated = await webhookRepo.getById(item.id);
    expect(updated!.retryCount).toBe(5);
    expect(updated!.status).toBe(WebhookQueueStatus.Failed);
  });

  it('skips items whose nextRetryAt is in the future', async () => {
    const fetchMock = mockFetch200();
    vi.stubGlobal('fetch', fetchMock);
    const { svc, webhookRepo } = makeSvc();
    const item = makeWebhookItem({
      status: WebhookQueueStatus.Pending,
      nextRetryAt: new Date(Date.now() + 60_000).toISOString(), // 1 minute from now
    });
    webhookRepo.seed([item]);
    await svc.processWebhookRetries();
    expect(fetchMock).not.toHaveBeenCalled();
    const unchanged = await webhookRepo.getById(item.id);
    expect(unchanged!.status).toBe(WebhookQueueStatus.Pending);
  });
});

// ── getWebhookQueue ───────────────────────────────────────────────────────────

describe('IntegrationService.getWebhookQueue', () => {
  it('returns only items belonging to the actor org', async () => {
    const { svc, webhookRepo } = makeSvc();
    webhookRepo.seed([
      makeWebhookItem({ organizationId: 'org1' }),
      makeWebhookItem({ organizationId: 'org2' }),
    ]);
    const result = await svc.getWebhookQueue(ADMIN_ROLES, 'org1');
    expect(result.every(w => w.organizationId === 'org1')).toBe(true);
    expect(result.length).toBe(1);
  });

  it('throws AuthorizationError for non-admin', async () => {
    const { svc } = makeSvc();
    await expect(svc.getWebhookQueue([UserRole.Employer], 'org1')).rejects.toThrow(AuthorizationError);
  });
});
