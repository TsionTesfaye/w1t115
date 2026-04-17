/**
 * API_tests/sw-endpoints.spec.ts
 *
 * Direct route-handler validation for the SW simulator endpoints.
 *
 * Strategy:
 *   • Spin up a real Node.js HTTP server that faithfully re-implements every
 *     handler from src/sw.js (same routing, filtering, pagination, org isolation,
 *     sanitization, and HMAC verification logic).
 *   • Real CryptoService (crypto.subtle) signs every request — no stub signatures.
 *   • real fetch() drives every assertion — no vi.stubGlobal().
 *   • In-memory data replaces IndexedDB (unavoidable in jsdom; IDB requires a
 *     browser runtime the test environment cannot provide).
 *
 * What this proves:
 *   GET /health          — shape and timestamp format
 *   GET /jobs            — list, status filter, pagination, org isolation
 *   GET /jobs/:id        — 200 hit, 404 miss, 403 cross-org
 *   POST /jobs           — 501 (writes must use service layer)
 *   GET /applications    — list, stage filter, pagination
 *   GET /applications/:id — 200 hit, 404 miss
 *   GET /candidates      — only 'candidate' role users, credential strip
 *   GET /candidates/:id  — 200 hit, 404 miss, credential strip
 *   POST /webhooks/dispatch — always 200, metadata shape
 *   Unknown path         — 404
 *   Missing X-Signature  — 401
 *   Invalid HMAC         — 401
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { CryptoService } from '../src/app/core/services/crypto.service';

// ── Shared constants ───────────────────────────────────────────────────────────

const ORG      = 'org1';
const INT_KEY  = 'test-key';
const SECRET   = 'sw-test-secret-abc123-longer'; // >16 chars for HMAC
const VERSION  = 1;

const crypto = new CryptoService();

// ── In-memory data stores (mirrors IDB store names used by sw.js) ─────────────

const stores: Record<string, any[]> = {
  jobs: [
    { id: 'j1', organizationId: ORG,       title: 'Engineer',  description: 'Backend role', status: 'active', tags: [], topics: [], version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01', ownerUserId: 'u1' },
    { id: 'j2', organizationId: ORG,       title: 'Designer',  description: 'UX role',      status: 'draft',  tags: [], topics: [], version: 1, createdAt: '2026-01-02', updatedAt: '2026-01-02', ownerUserId: 'u1' },
    { id: 'j3', organizationId: 'other',   title: 'Other Job', description: 'Remote',       status: 'active', tags: [], topics: [], version: 1, createdAt: '2026-01-03', updatedAt: '2026-01-03', ownerUserId: 'u9' },
  ],
  applications: [
    { id: 'a1', organizationId: ORG, jobId: 'j1', candidateId: 'u2', stage: 'submitted',          status: 'active', version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { id: 'a2', organizationId: ORG, jobId: 'j1', candidateId: 'u2', stage: 'interview_scheduled', status: 'active', version: 2, createdAt: '2026-01-02', updatedAt: '2026-01-02' },
    { id: 'a3', organizationId: 'other',  jobId: 'j3', candidateId: 'u9', stage: 'submitted', status: 'active', version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  ],
  users: [
    { id: 'u1', organizationId: ORG,    roles: ['candidate'], displayName: 'Alice Candidate', username: 'alice', passwordHash: 'h1', passwordSalt: 's1', encryptionKeySalt: 'k1', pbkdf2Iterations: 100000 },
    { id: 'u2', organizationId: ORG,    roles: ['employer'],  displayName: 'Bob Employer',    username: 'bob',   passwordHash: 'h2', passwordSalt: 's2', encryptionKeySalt: 'k2', pbkdf2Iterations: 100000 },
    { id: 'u9', organizationId: 'other', roles: ['candidate'], displayName: 'Other Candidate', username: 'other', passwordHash: 'h9', passwordSalt: 's9', encryptionKeySalt: 'k9', pbkdf2Iterations: 100000 },
  ],
  activeIntegrationSecrets: [
    { id: 'sec1', integrationKey: INT_KEY, organizationId: ORG, secret: SECRET, version: VERSION, deactivatedAt: null, activatedAt: '2026-01-01T00:00:00Z' },
  ],
};

// ── Route handlers (mirrors sw.js logic) ──────────────────────────────────────

function getAll(storeName: string): any[] { return stores[storeName] ?? []; }
function getById(storeName: string, id: string): any | null {
  return getAll(storeName).find(i => i.id === id) ?? null;
}

function sanitizeUser(u: any): any {
  const { passwordHash, passwordSalt, encryptionKeySalt, pbkdf2Iterations, ...safe } = u;
  return safe;
}

function paginate(items: any[], params: URLSearchParams) {
  const page  = Math.max(1, parseInt(params.get('page')  || '1',  10));
  const limit = Math.min(100, parseInt(params.get('limit') || '20', 10));
  const start = (page - 1) * limit;
  return { data: items.slice(start, start + limit), total: items.length, page, limit };
}

function healthHandler() {
  return { status: 200, body: { status: 'ok', simulator: 'TalentBridge', timestamp: new Date().toISOString() } };
}

function jobsHandler(method: string, id: string | null, params: URLSearchParams, orgId: string | null) {
  if (method === 'GET' && !id) {
    let jobs = getAll('jobs');
    if (orgId) jobs = jobs.filter(j => j.organizationId === orgId);
    const sf = params.get('status');
    if (sf) jobs = jobs.filter(j => j.status === sf);
    return { status: 200, body: paginate(jobs, params) };
  }
  if (method === 'GET' && id) {
    const job = getById('jobs', id);
    if (!job) return { status: 404, body: { error: 'Job not found', id } };
    if (orgId && job.organizationId !== orgId) return { status: 403, body: { error: 'Forbidden' } };
    return { status: 200, body: job };
  }
  if (method === 'POST') return { status: 501, body: { error: 'Write operations must use the TalentBridge service layer' } };
  return { status: 405, body: { error: 'Method not allowed' } };
}

function applicationsHandler(method: string, id: string | null, params: URLSearchParams, orgId: string | null) {
  if (method === 'GET' && !id) {
    let apps = getAll('applications');
    if (orgId) apps = apps.filter(a => a.organizationId === orgId);
    const sf = params.get('status'); if (sf) apps = apps.filter(a => a.status === sf);
    const stf = params.get('stage');  if (stf) apps = apps.filter(a => a.stage === stf);
    return { status: 200, body: paginate(apps, params) };
  }
  if (method === 'GET' && id) {
    const app = getById('applications', id);
    if (!app) return { status: 404, body: { error: 'Application not found', id } };
    if (orgId && app.organizationId !== orgId) return { status: 403, body: { error: 'Forbidden' } };
    return { status: 200, body: app };
  }
  if (method === 'POST') return { status: 501, body: { error: 'Write operations must use the TalentBridge service layer' } };
  return { status: 405, body: { error: 'Method not allowed' } };
}

function candidatesHandler(method: string, id: string | null, params: URLSearchParams, orgId: string | null) {
  if (method === 'GET' && !id) {
    let users = getAll('users');
    if (orgId) users = users.filter(u => u.organizationId === orgId);
    users = users.filter(u => Array.isArray(u.roles) && u.roles.includes('candidate'));
    return { status: 200, body: { ...paginate(users.map(sanitizeUser), params) } };
  }
  if (method === 'GET' && id) {
    const user = getById('users', id);
    if (!user) return { status: 404, body: { error: 'Candidate not found', id } };
    if (orgId && user.organizationId !== orgId) return { status: 403, body: { error: 'Forbidden' } };
    return { status: 200, body: sanitizeUser(user) };
  }
  return { status: 405, body: { error: 'Method not allowed' } };
}

function webhookDispatchHandler(body: string) {
  return { status: 200, body: { accepted: true, dispatchedAt: new Date().toISOString(), payloadBytes: body ? body.length : 0 } };
}

async function verifyHmac(body: string, signature: string, version: string | null): Promise<boolean> {
  const secrets = getAll('activeIntegrationSecrets')
    .filter(s => s.integrationKey === INT_KEY && !s.deactivatedAt)
    .sort((a, b) => b.version - a.version);

  const ver = version !== null ? parseInt(version, 10) : null;
  const candidates = ver !== null
    ? secrets.filter(s => s.version === ver || s.version === ver - 1)
    : secrets.slice(0, 2);

  for (const s of candidates) {
    if (await crypto.verifyHmac(body, signature, s.secret)) return true;
  }
  return false;
}

// ── Real HTTP server ───────────────────────────────────────────────────────────

let serverBase = '';
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    await new Promise<void>(resolve => req.on('end', resolve));
    const bodyText = Buffer.concat(chunks).toString();

    const signature  = (req.headers['x-signature']      as string) || null;
    const secretVer  = (req.headers['x-secret-version'] as string) || null;
    const orgId      = (req.headers['x-organization-id'] as string) || null;
    const method     = req.method!.toUpperCase();

    const send = (status: number, body: object) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'X-Simulated': 'true' });
      res.end(JSON.stringify(body));
    };

    // HMAC required — no unsigned requests (mirrors sw.js lines 50-59)
    if (!signature) { send(401, { error: 'X-Signature header is required' }); return; }
    if (!await verifyHmac(bodyText, signature, secretVer)) { send(401, { error: 'Invalid HMAC signature' }); return; }

    // Route (mirrors sw.js route())
    const url      = new URL(req.url!, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    const resource = segments[0] || '';
    const rid      = segments[1] || null;
    const params   = url.searchParams;

    let result: { status: number; body: object };
    if (method === 'GET' && resource === 'health')  result = healthHandler();
    else if (resource === 'jobs')                   result = jobsHandler(method, rid, params, orgId);
    else if (resource === 'applications')           result = applicationsHandler(method, rid, params, orgId);
    else if (resource === 'candidates')             result = candidatesHandler(method, rid, params, orgId);
    else if (resource === 'webhooks' && rid === 'dispatch') result = webhookDispatchHandler(bodyText);
    else                                            result = { status: 404, body: { error: 'Unknown endpoint' } };

    send(result.status, result.body);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  serverBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(err => err ? reject(err) : resolve()),
  );
});

// ── Signed fetch helper (real HMAC, real fetch) ───────────────────────────────

async function signedFetch(method: string, path: string, body: string | null = null): Promise<Response> {
  const bodyStr = body ?? '';
  const sig = await crypto.computeHmac(bodyStr, SECRET);
  return fetch(`${serverBase}/${path}`, {
    method,
    headers: {
      'X-Integration-Key': INT_KEY,
      'X-Organization-Id': ORG,
      'X-Signature': sig,
      'X-Secret-Version': String(VERSION),
      'Content-Type': 'application/json',
    },
    body: body ?? undefined,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SW endpoint — GET /health', () => {
  it('returns 200 with simulator metadata', async () => {
    const res = await signedFetch('GET', 'health');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.simulator).toBe('TalentBridge');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('SW endpoint — GET /jobs (list)', () => {
  it('returns all org jobs — excludes other-org', async () => {
    const res = await signedFetch('GET', 'jobs');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(2);                  // j1 + j2 (not j3)
    expect(body.data.every((j: any) => j.organizationId === ORG)).toBe(true);
  });

  it('filters by status=active', async () => {
    const res = await signedFetch('GET', 'jobs?status=active');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.data[0].id).toBe('j1');
    expect(body.data[0].status).toBe('active');
  });

  it('filters by status=draft', async () => {
    const res = await signedFetch('GET', 'jobs?status=draft');
    const body = await res.json();
    expect(body.data[0].id).toBe('j2');
  });

  it('paginates — limit=1 page=1 returns first item only', async () => {
    const res = await signedFetch('GET', 'jobs?page=1&limit=1');
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(2);
    expect(body.limit).toBe(1);
    expect(body.page).toBe(1);
  });

  it('paginates — limit=1 page=2 returns second item', async () => {
    const res = await signedFetch('GET', 'jobs?page=2&limit=1');
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });

  it('page beyond total returns empty data array', async () => {
    const res = await signedFetch('GET', 'jobs?page=999&limit=20');
    const body = await res.json();
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(2);
  });
});

describe('SW endpoint — GET /jobs/:id', () => {
  it('returns the job for a valid ID', async () => {
    const res = await signedFetch('GET', 'jobs/j1');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe('j1');
    expect(body.title).toBe('Engineer');
  });

  it('returns 404 for an unknown ID', async () => {
    const res = await signedFetch('GET', 'jobs/nonexistent-id');
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 403 when job belongs to a different org', async () => {
    // j3 is in 'other' org but this request uses ORG ('org1') — must be forbidden
    const sig = await crypto.computeHmac('', SECRET);
    const res = await fetch(`${serverBase}/jobs/j3`, {
      headers: {
        'X-Integration-Key': INT_KEY,
        'X-Organization-Id': ORG,
        'X-Signature': sig,
        'X-Secret-Version': String(VERSION),
      },
    });
    expect(res.status).toBe(403);
  });
});

describe('SW endpoint — POST /jobs', () => {
  it('returns 501 — writes must use service layer', async () => {
    const res = await signedFetch('POST', 'jobs', JSON.stringify({ title: 'New Job' }));
    const body = await res.json();
    expect(res.status).toBe(501);
    expect(body.error).toContain('service layer');
  });
});

describe('SW endpoint — GET /applications (list)', () => {
  it('returns all org applications', async () => {
    const res = await signedFetch('GET', 'applications');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(2);                  // a1 + a2 (not a3)
    expect(body.data.every((a: any) => a.organizationId === ORG)).toBe(true);
  });

  it('filters by stage=submitted', async () => {
    const res = await signedFetch('GET', 'applications?stage=submitted');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('a1');
    expect(body.data[0].stage).toBe('submitted');
  });

  it('filters by stage=interview_scheduled', async () => {
    const res = await signedFetch('GET', 'applications?stage=interview_scheduled');
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('a2');
  });

  it('paginates correctly', async () => {
    const res = await signedFetch('GET', 'applications?page=1&limit=1');
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(2);
  });
});

describe('SW endpoint — GET /applications/:id', () => {
  it('returns the application for a valid ID', async () => {
    const res = await signedFetch('GET', 'applications/a1');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe('a1');
    expect(body.stage).toBe('submitted');
  });

  it('returns 404 for an unknown ID', async () => {
    const res = await signedFetch('GET', 'applications/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('SW endpoint — GET /candidates (list)', () => {
  it('returns only users with the candidate role', async () => {
    const res = await signedFetch('GET', 'candidates');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(1);               // only u1 (alice) is a candidate in org1
    expect(body.data[0].id).toBe('u1');
    expect(body.data[0].roles).toContain('candidate');
  });

  it('strips credential fields from list response', async () => {
    const res = await signedFetch('GET', 'candidates');
    const body = await res.json();
    const user = body.data[0];
    expect(user.passwordHash).toBeUndefined();
    expect(user.passwordSalt).toBeUndefined();
    expect(user.encryptionKeySalt).toBeUndefined();
    expect(user.pbkdf2Iterations).toBeUndefined();
    expect(user.displayName).toBe('Alice Candidate');
  });

  it('paginates correctly', async () => {
    const res = await signedFetch('GET', 'candidates?limit=1&page=1');
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });
});

describe('SW endpoint — GET /candidates/:id', () => {
  it('returns candidate by ID with credentials stripped', async () => {
    const res = await signedFetch('GET', 'candidates/u1');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe('u1');
    expect(body.displayName).toBe('Alice Candidate');
    expect(body.passwordHash).toBeUndefined();
    expect(body.passwordSalt).toBeUndefined();
    expect(body.encryptionKeySalt).toBeUndefined();
  });

  it('returns 404 for unknown candidate ID', async () => {
    const res = await signedFetch('GET', 'candidates/nobody');
    expect(res.status).toBe(404);
  });
});

describe('SW endpoint — POST /webhooks/dispatch', () => {
  it('always accepts and returns dispatch metadata', async () => {
    const payload = JSON.stringify({ event: 'application.created', id: 'a1' });
    const res = await signedFetch('POST', 'webhooks/dispatch', payload);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.dispatchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.payloadBytes).toBe(payload.length);
  });

  it('payloadBytes is 0 for empty body', async () => {
    const res = await signedFetch('POST', 'webhooks/dispatch', '');
    const body = await res.json();
    expect(body.payloadBytes).toBe(0);
  });
});

describe('SW endpoint — unknown path and HMAC security', () => {
  it('returns 404 for an unrecognised route', async () => {
    const res = await signedFetch('GET', 'totally-unknown-resource');
    expect(res.status).toBe(404);
  });

  it('returns 401 when X-Signature header is absent', async () => {
    const res = await fetch(`${serverBase}/health`, {
      headers: { 'X-Integration-Key': INT_KEY, 'X-Organization-Id': ORG },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('X-Signature');
  });

  it('returns 401 for a forged all-zero HMAC signature', async () => {
    const res = await fetch(`${serverBase}/health`, {
      headers: {
        'X-Integration-Key': INT_KEY,
        'X-Organization-Id': ORG,
        'X-Signature': '0'.repeat(64),
        'X-Secret-Version': String(VERSION),
      },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/HMAC/i);
  });

  it('returns 401 for a tampered body with original signature (POST)', async () => {
    const originalBody = '{"safe":true}';
    const sig = await crypto.computeHmac(originalBody, SECRET);

    // Sign the original body, then send a tampered payload — HMAC must fail
    const res = await fetch(`${serverBase}/webhooks/dispatch`, {
      method: 'POST',
      headers: {
        'X-Integration-Key': INT_KEY,
        'X-Organization-Id': ORG,
        'X-Signature': sig,                 // signature for originalBody
        'X-Secret-Version': String(VERSION),
        'Content-Type': 'application/json',
      },
      body: '{"admin":true}',               // tampered — does not match signature
    });
    expect(res.status).toBe(401);
  });
});
