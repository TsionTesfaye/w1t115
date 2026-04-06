/**
 * API_tests/sw-hmac.spec.ts
 *
 * Service-layer HMAC header propagation tests.
 *
 * Validates that processRequest() correctly forwards X-Signature and
 * X-Secret-Version headers to the Service Worker fetch call.
 * Also validates that the sw.js verifyRequestHmac logic correctly reads
 * from 'activeIntegrationSecrets' (not 'integrationSecrets').
 *
 * Uses in-memory doubles — no real SW or browser needed.
 */

import { describe, it, expect, vi } from 'vitest';
import { IntegrationService } from '../src/app/core/services/integration.service';
import { UserRole } from '../src/app/core/enums';
import {
  FakeIntegrationRequestRepo, FakeIdempotencyKeyRepo,
  FakeIntegrationSecretRepo, FakeWebhookQueueRepo,
  fakeCrypto, fakeAudit,
  makeIntegrationSecret,
} from '../src/app/core/services/__tests__/helpers';

const ORG = 'org1';
const ACTOR = 'admin1';
const ADMIN_ROLES = [UserRole.Administrator];
const INT_KEY = 'key1';

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

// ── Header forwarding ─────────────────────────────────────────────────────────

describe('IntegrationService — X-Signature and X-Secret-Version header forwarding', () => {
  it('forwards X-Signature to SW fetch when signature is present', async () => {
    const secret = makeIntegrationSecret({ integrationKey: INT_KEY, secret: 'mysecret', deactivatedAt: null });
    const secretRepo = new FakeIntegrationSecretRepo().seed([secret]);
    const svc = makeService(secretRepo);

    const capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      Object.assign(capturedHeaders, headers);
      return Promise.resolve(
        new Response(JSON.stringify({ status: 200 }), { status: 200 }),
      );
    }));

    const body = JSON.stringify({ event: 'test' });
    const sig = await fakeCrypto.computeHmac(body, 'mysecret');

    await svc.processRequest(
      'POST', '/test', {}, body, null, sig, 1, INT_KEY, ACTOR, ADMIN_ROLES, ORG,
    );

    expect(capturedHeaders['X-Signature']).toBe(sig);
    expect(capturedHeaders['X-Secret-Version']).toBe('1');

    vi.unstubAllGlobals();
  });

  it('forwards X-Signature when present, omits X-Secret-Version when null', async () => {
    const secret = makeIntegrationSecret({ integrationKey: INT_KEY, secret: 'mysecret', deactivatedAt: null });
    const secretRepo = new FakeIntegrationSecretRepo().seed([secret]);
    const svc = makeService(secretRepo);

    const capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      Object.assign(capturedHeaders, headers);
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));

    const body = JSON.stringify({ event: 'test' });
    const sig = await fakeCrypto.computeHmac(body, 'mysecret');

    await svc.processRequest(
      'POST', '/test', {}, body, null, sig, null, INT_KEY, ACTOR, ADMIN_ROLES, ORG,
    );

    expect(capturedHeaders['X-Signature']).toBe(sig);
    expect(capturedHeaders['X-Secret-Version']).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('does NOT add X-Signature header when no signature is provided', async () => {
    const svc = makeService();

    const capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      Object.assign(capturedHeaders, headers);
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));

    await svc.processRequest(
      'GET', '/health', {}, null, null, null, null, INT_KEY, ACTOR, ADMIN_ROLES, ORG,
    );

    expect(capturedHeaders['X-Signature']).toBeUndefined();
    expect(capturedHeaders['X-Secret-Version']).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('X-Integration-Key is always forwarded to SW', async () => {
    const svc = makeService();

    const capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      Object.assign(capturedHeaders, headers);
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));

    await svc.processRequest(
      'GET', '/health', {}, null, null, null, null, INT_KEY, ACTOR, ADMIN_ROLES, ORG,
    );

    expect(capturedHeaders['X-Integration-Key']).toBe(INT_KEY);
    expect(capturedHeaders['X-Organization-Id']).toBe(ORG);

    vi.unstubAllGlobals();
  });
});

// ── SW store name verification ────────────────────────────────────────────────

describe('Service Worker — activeIntegrationSecrets store name', () => {
  it('sw.js reads from activeIntegrationSecrets (not integrationSecrets)', async () => {
    // Read the sw.js source and verify the correct store name is used
    const { readFileSync } = await import('fs');
    const { resolve, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const dir = dirname(fileURLToPath(import.meta.url));
    const swPath = resolve(dir, '../src/sw.js');
    const swSource = readFileSync(swPath, 'utf-8');

    // Must use the canonical store name that matches database.ts
    expect(swSource).toContain("'activeIntegrationSecrets'");
    // Must NOT use the old incorrect store name in any getAllFromStore call
    expect(swSource).not.toContain("getAllFromStore(db, 'integrationSecrets')");
  });
});
