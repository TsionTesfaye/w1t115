/**
 * browser_tests/real-fetch-e2e.spec.ts
 *
 * Real fetch E2E — no vi.stubGlobal('fetch', ...), no mock crypto.
 *
 * Strategy:
 *   1. Spin up a real Node.js HTTP server on an ephemeral port.
 *   2. Construct IntegrationService with that server's URL as simulatorBase.
 *   3. Real CryptoService (crypto.subtle) computes and verifies HMAC.
 *   4. processRequest() issues a real fetch() to the server — no stubs.
 *   5. The server echoes back request metadata so we can assert on headers.
 *
 * Why this is the correct minimum for "no mocks":
 *   - crypto.subtle is the real Web Crypto API (Node 20+ built-in)
 *   - fetch() is the real Node.js native fetch (no vi.stubGlobal)
 *   - The server is a real TCP listener, not an in-memory handler
 *   - FakeIntegrationSecretRepo is an in-memory double, not an IDB mock;
 *     real IDB requires a browser environment unavailable in vitest/jsdom
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { IntegrationService } from '../src/app/core/services/integration.service';
import { CryptoService } from '../src/app/core/services/crypto.service';
import { UserRole } from '../src/app/core/enums';
import {
  FakeIntegrationRequestRepo,
  FakeIdempotencyKeyRepo,
  FakeIntegrationSecretRepo,
  FakeWebhookQueueRepo,
  fakeAudit,
} from '../src/app/core/services/__tests__/helpers';

// ── Real HTTP server ──────────────────────────────────────────────────────────

let serverBase = '';

const echoServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // Collect body, then echo request metadata as JSON
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    const payload = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body || null,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});

beforeAll(async () => {
  await new Promise<void>(resolve => echoServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (echoServer.address() as AddressInfo).port;
  serverBase = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    echoServer.close(err => err ? reject(err) : resolve()),
  );
});

// ── Service factory (real crypto, real server base) ───────────────────────────

function makeService(secretRepo = new FakeIntegrationSecretRepo()) {
  const crypto = new CryptoService();
  const svc = new IntegrationService(
    new FakeIntegrationRequestRepo() as any,
    new FakeIdempotencyKeyRepo() as any,
    secretRepo as any,
    new FakeWebhookQueueRepo() as any,
    crypto as any,
    fakeAudit as any,
    serverBase, // real server — no fetch mock needed
  );
  return { svc, crypto, secretRepo };
}

const ORG    = 'org1';
const ACTOR  = 'admin1';
const ROLES  = [UserRole.Administrator];
const INT_KEY = 'real-key';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Real fetch E2E — no fetch mock, real crypto.subtle', () => {
  it('sends a real HTTP request and receives a real response', async () => {
    const { svc } = makeService();
    const result = await svc.processRequest(
      'GET', '/health', {}, null, null, null, null, INT_KEY, ACTOR, ROLES, ORG,
    );
    expect(result.status).toBe(200);
    const echo = JSON.parse(result.body);
    expect(echo.method).toBe('GET');
    expect(echo.headers['x-integration-key']).toBe(INT_KEY);
    expect(echo.headers['x-organization-id']).toBe(ORG);
  });

  it('forwards real HMAC signature header — verified by server echo', async () => {
    const { svc, crypto } = makeService();
    // Create secret via the service (stores in FakeIntegrationSecretRepo)
    const secret = await svc.createSecret(INT_KEY, ACTOR, ROLES, ORG);
    const body = JSON.stringify({ event: 'test', timestamp: Date.now() });
    const sig = await crypto.computeHmac(body, secret.secret);

    const result = await svc.processRequest(
      'POST', '/events', {}, body, null, sig, secret.version, INT_KEY, ACTOR, ROLES, ORG,
    );
    expect(result.status).toBe(200);
    const echo = JSON.parse(result.body);
    // Headers arrive lowercase from Node HTTP
    expect(echo.headers['x-signature']).toBe(sig);
    expect(echo.headers['x-secret-version']).toBe(String(secret.version));
    expect(echo.headers['x-integration-key']).toBe(INT_KEY);
  });

  it('real HMAC tamper detection: processRequest rejects tampered body before fetch', async () => {
    const { svc, crypto } = makeService();
    const secret = await svc.createSecret(INT_KEY, ACTOR, ROLES, ORG);
    const originalBody = '{"safe":true}';
    const sig = await crypto.computeHmac(originalBody, secret.secret);
    const tampered = '{"admin":true}';

    // Should throw before any HTTP request is made
    await expect(
      svc.processRequest('POST', '/events', {}, tampered, null, sig, secret.version, INT_KEY, ACTOR, ROLES, ORG),
    ).rejects.toThrow(/HMAC/i);
  });

  it('secret rotation: new signature accepted, old signature rejected (immediate deactivation)', async () => {
    const { svc, crypto } = makeService();
    const v1 = await svc.createSecret(INT_KEY, ACTOR, ROLES, ORG);
    const v2 = await svc.rotateSecret(v1.id, ACTOR, ROLES, ORG);

    const body = '{"rotate":true}';
    const sigV2 = await crypto.computeHmac(body, v2.secret);
    const sigV1 = await crypto.computeHmac(body, v1.secret);

    // v2 signature accepted
    const r1 = await svc.processRequest('POST', '/events', {}, body, null, sigV2, v2.version, INT_KEY, ACTOR, ROLES, ORG);
    expect(r1.status).toBe(200);

    // v1 is deactivated immediately on rotation — old signature rejected
    await expect(
      svc.processRequest('POST', '/events', {}, body, null, sigV1, v2.version, INT_KEY, ACTOR, ROLES, ORG),
    ).rejects.toThrow();
  });

  it('cross-org isolation: secret from org2 is not visible to org1 requests', async () => {
    const { crypto } = makeService();
    const secretRepoOrg2 = new FakeIntegrationSecretRepo();
    const { svc: svcOrg2 } = makeService(secretRepoOrg2);

    // Create a secret for org2
    const secretOrg2 = await svcOrg2.createSecret(INT_KEY, 'admin2', ROLES, 'org2');
    const body = '{"cross-org":"attempt"}';
    const sigOrg2 = await crypto.computeHmac(body, secretOrg2.secret);

    // Attempt to use org2 signature against org1 service (separate repo = no shared state)
    const { svc: svcOrg1 } = makeService();
    await expect(
      svcOrg1.processRequest('POST', '/events', {}, body, null, sigOrg2, secretOrg2.version, INT_KEY, ACTOR, ROLES, ORG),
    ).rejects.toThrow(); // no secrets in org1's repo
  });

  it('deactivated secret: signature rejected after deactivation', async () => {
    const { svc, crypto } = makeService();
    const secret = await svc.createSecret(INT_KEY, ACTOR, ROLES, ORG);
    const body = '{"deact":true}';
    const sig = await crypto.computeHmac(body, secret.secret);

    await svc.deactivateSecret(secret.id, ACTOR, ROLES, ORG);

    await expect(
      svc.processRequest('POST', '/events', {}, body, null, sig, secret.version, INT_KEY, ACTOR, ROLES, ORG),
    ).rejects.toThrow();
  });
});

// ── Pure crypto round-trips (no service layer) ─────────────────────────────────

describe('Real crypto.subtle — pure HMAC round-trips', () => {
  it('computeHmac produces a 64-char hex string', async () => {
    const cs = new CryptoService();
    const sig = await cs.computeHmac('hello world', 'supersecretkey');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifyHmac returns true for correct signature', async () => {
    const cs = new CryptoService();
    const message = JSON.stringify({ action: 'create', id: 42 });
    const secret = 'test-secret-value';
    const sig = await cs.computeHmac(message, secret);
    expect(await cs.verifyHmac(message, sig, secret)).toBe(true);
  });

  it('verifyHmac returns false for tampered message', async () => {
    const cs = new CryptoService();
    const sig = await cs.computeHmac('original', 'key');
    expect(await cs.verifyHmac('tampered', sig, 'key')).toBe(false);
  });

  it('verifyHmac returns false for wrong key', async () => {
    const cs = new CryptoService();
    const sig = await cs.computeHmac('message', 'key1');
    expect(await cs.verifyHmac('message', sig, 'key2')).toBe(false);
  });

  it('verifyHmac returns false for forged all-zero signature', async () => {
    const cs = new CryptoService();
    const forged = '0'.repeat(64);
    expect(await cs.verifyHmac('any body', forged, 'any-key')).toBe(false);
  });

  it('two different secrets produce different signatures for the same message', async () => {
    const cs = new CryptoService();
    const msg = 'same message';
    const sig1 = await cs.computeHmac(msg, 'secret-one');
    const sig2 = await cs.computeHmac(msg, 'secret-two');
    expect(sig1).not.toBe(sig2);
  });
});
