/**
 * TalentBridge Integration Simulator — Service Worker
 *
 * Intercepts all fetch events to /api/simulate/** and routes them to
 * in-process endpoint handlers backed by the shared TalentBridgeDB IndexedDB.
 *
 * Responsibilities:
 *  1. Rate limiting  — atomic read-modify-write in a single IDB readwrite tx
 *  2. Idempotency    — cache response by X-Idempotency-Key for 24 h
 *  3. Endpoint routing — GET/POST handlers that read/write the shared IDB
 *  4. Webhook dispatch — always accepts; used by processWebhookRetries()
 */

/* ─── Constants ─────────────────────────────────────────────────────────── */
const DB_NAME = 'TalentBridgeDB';
const SIM_PREFIX = '/api/simulate';
const RATE_LIMIT_PER_MINUTE = 60;
const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000;

/* ─── Lifecycle ──────────────────────────────────────────────────────────── */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/* ─── Fetch interception ─────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(SIM_PREFIX)) return; // pass through non-sim requests
  event.respondWith(handleSimRequest(event.request));
});

async function handleSimRequest(request) {
  let db;
  try {
    db = await openDb();
  } catch (e) {
    return jsonResponse(503, { error: 'Database unavailable', detail: String(e) });
  }

  const integrationKey = request.headers.get('X-Integration-Key') || 'default';
  const idempotencyKey = request.headers.get('X-Idempotency-Key') || null;

  // 1. Idempotency — check cache before rate-limit so replays are free
  if (idempotencyKey) {
    const cached = await getIdempotencyCache(db, idempotencyKey);
    if (cached) return new Response(cached.body, { status: cached.status, headers: cached.headers });
  }

  // 1.5. HMAC verification — all requests must carry a valid X-Signature.
  //      Unsigned requests are rejected (no optional path).
  const signature = request.headers.get('X-Signature');
  if (!signature) {
    return jsonResponse(401, { error: 'X-Signature header is required' });
  }
  let bodyForVerify = null;
  try { bodyForVerify = await request.clone().text(); } catch { /* ignore */ }
  const secretVersion = request.headers.get('X-Secret-Version');
  const verified = await verifyRequestHmac(db, integrationKey, bodyForVerify || '', signature, secretVersion ? parseInt(secretVersion, 10) : null);
  if (!verified) {
    return jsonResponse(401, { error: 'Invalid HMAC signature' });
  }

  // 2. Rate limiting — atomic IDB readwrite transaction
  const allowed = await checkAndIncrementRateLimit(db, integrationKey);
  if (!allowed) {
    return jsonResponse(429, { error: 'Rate limit exceeded', limitPerMinute: RATE_LIMIT_PER_MINUTE });
  }

  // 3. Route to endpoint handler
  const url = new URL(request.url);
  const path = url.pathname.slice(SIM_PREFIX.length); // e.g. '/jobs' or '/jobs/abc123'
  const orgId = request.headers.get('X-Organization-Id') || null;
  let bodyText = null;
  try { bodyText = await request.text(); } catch { /* ignore */ }

  let response;
  try {
    response = await route(db, request.method.toUpperCase(), path, url.searchParams, bodyText, orgId);
  } catch (e) {
    response = jsonResponse(500, { error: 'Simulator error', detail: String(e) });
  }

  // 4. Store idempotency key (only for mutating methods or if key was provided)
  if (idempotencyKey && response.status < 500) {
    const snapshot = {
      status: response.status,
      body: await response.clone().text(),
      headers: Object.fromEntries(response.headers.entries()),
    };
    await storeIdempotencyCache(db, idempotencyKey, integrationKey, snapshot);
  }

  return response;
}

/* ─── Router ─────────────────────────────────────────────────────────────── */
async function route(db, method, path, params, body, orgId) {
  // Normalize trailing slash
  const p = path.replace(/\/$/, '') || '/';
  const segments = p.split('/').filter(Boolean); // ['jobs'] or ['jobs','abc123']
  const resource = segments[0] || '';
  const resourceId = segments[1] || null;

  if (method === 'GET' && resource === 'health') return healthHandler();
  if (resource === 'jobs') return jobsHandler(db, method, resourceId, params, body, orgId);
  if (resource === 'applications') return applicationsHandler(db, method, resourceId, params, body, orgId);
  if (resource === 'candidates') return candidatesHandler(db, method, resourceId, params, body, orgId);
  if (resource === 'webhooks' && segments[1] === 'dispatch') return webhookDispatchHandler(body);
  return jsonResponse(404, { error: 'Unknown endpoint', path });
}

/* ─── Endpoint handlers ──────────────────────────────────────────────────── */
function healthHandler() {
  return jsonResponse(200, { status: 'ok', simulator: 'TalentBridge', timestamp: new Date().toISOString() });
}

async function jobsHandler(db, method, id, params, body, orgId) {
  if (method === 'GET' && !id) {
    const status = params.get('status') || null;
    let jobs = await getAllFromStore(db, 'jobs');
    if (orgId) jobs = jobs.filter(j => j.organizationId === orgId);
    if (status) jobs = jobs.filter(j => j.status === status);
    const page = parseInt(params.get('page') || '1', 10);
    const limit = Math.min(parseInt(params.get('limit') || '20', 10), 100);
    const start = (page - 1) * limit;
    return jsonResponse(200, {
      data: jobs.slice(start, start + limit).map(sanitizeJob),
      total: jobs.length, page, limit,
    });
  }
  if (method === 'GET' && id) {
    const job = await getFromStore(db, 'jobs', id);
    if (!job) return jsonResponse(404, { error: 'Job not found', id });
    if (orgId && job.organizationId !== orgId) return jsonResponse(403, { error: 'Forbidden' });
    return jsonResponse(200, sanitizeJob(job));
  }
  if (method === 'POST' && !id) {
    // Simulator accepts new job payloads but returns 501 for data writes
    // (writes to core data must go through the service layer to enforce business rules)
    return jsonResponse(501, { error: 'Write operations must use the TalentBridge service layer' });
  }
  return jsonResponse(405, { error: 'Method not allowed' });
}

async function applicationsHandler(db, method, id, params, body, orgId) {
  if (method === 'GET' && !id) {
    let apps = await getAllFromStore(db, 'applications');
    if (orgId) apps = apps.filter(a => a.organizationId === orgId);
    const status = params.get('status') || null;
    const stage = params.get('stage') || null;
    if (status) apps = apps.filter(a => a.status === status);
    if (stage) apps = apps.filter(a => a.stage === stage);
    const page = parseInt(params.get('page') || '1', 10);
    const limit = Math.min(parseInt(params.get('limit') || '20', 10), 100);
    const start = (page - 1) * limit;
    return jsonResponse(200, {
      data: apps.slice(start, start + limit).map(sanitizeApplication),
      total: apps.length, page, limit,
    });
  }
  if (method === 'GET' && id) {
    const app = await getFromStore(db, 'applications', id);
    if (!app) return jsonResponse(404, { error: 'Application not found', id });
    if (orgId && app.organizationId !== orgId) return jsonResponse(403, { error: 'Forbidden' });
    return jsonResponse(200, sanitizeApplication(app));
  }
  if (method === 'POST' && !id) {
    return jsonResponse(501, { error: 'Write operations must use the TalentBridge service layer' });
  }
  return jsonResponse(405, { error: 'Method not allowed' });
}

async function candidatesHandler(db, method, id, params, body, orgId) {
  if (method === 'GET' && !id) {
    let users = await getAllFromStore(db, 'users');
    if (orgId) users = users.filter(u => u.organizationId === orgId);
    // Only return candidate-role users
    users = users.filter(u => Array.isArray(u.roles) && u.roles.includes('candidate'));
    const page = parseInt(params.get('page') || '1', 10);
    const limit = Math.min(parseInt(params.get('limit') || '20', 10), 100);
    const start = (page - 1) * limit;
    return jsonResponse(200, {
      data: users.slice(start, start + limit).map(sanitizeUser),
      total: users.length, page, limit,
    });
  }
  if (method === 'GET' && id) {
    const user = await getFromStore(db, 'users', id);
    if (!user) return jsonResponse(404, { error: 'Candidate not found', id });
    if (orgId && user.organizationId !== orgId) return jsonResponse(403, { error: 'Forbidden' });
    return jsonResponse(200, sanitizeUser(user));
  }
  return jsonResponse(405, { error: 'Method not allowed' });
}

function webhookDispatchHandler(body) {
  // The simulator always accepts webhook dispatches.
  // This endpoint is used by processWebhookRetries() to simulate delivery.
  return jsonResponse(200, {
    accepted: true,
    dispatchedAt: new Date().toISOString(),
    payloadBytes: body ? body.length : 0,
  });
}

/* ─── Sanitizers (strip credentials before returning) ────────────────────── */
function sanitizeJob(job) {
  const { ...safe } = job;
  return safe;
}

function sanitizeApplication(app) {
  const { ...safe } = app;
  return safe;
}

function sanitizeUser(user) {
  // Never expose credentials through the simulator API
  const { passwordHash, passwordSalt, encryptionKeySalt, pbkdf2Iterations, ...safe } = user;
  return safe;
}

/* ─── HMAC verification ──────────────────────────────────────────────────── */
/**
 * Verify an HMAC-SHA256 signature against secrets stored in IDB for integrationKey.
 * Accepts the current secret version and one prior (rotation grace window).
 * Returns true if any candidate secret produces a valid signature.
 */
async function verifyRequestHmac(db, integrationKey, message, signature, secretVersion) {
  let secrets;
  try {
    secrets = await getAllFromStore(db, 'activeIntegrationSecrets');
  } catch {
    return false; // IDB unavailable — deny
  }
  // Only consider active (non-deactivated) secrets — consistent with service layer policy
  const keySecrets = secrets
    .filter(s => s.integrationKey === integrationKey && !s.deactivatedAt)
    .sort((a, b) => b.version - a.version);

  if (!keySecrets.length) return false; // no active secrets for this key — deny

  const candidates = secretVersion !== null
    ? keySecrets.filter(s => s.version === secretVersion || s.version === secretVersion - 1)
    : keySecrets.slice(0, 2);

  for (const s of candidates) {
    try {
      if (await hmacVerify(message, signature, s.secret)) return true;
    } catch { /* bad format — try next */ }
  }
  return false;
}

async function hmacVerify(message, signature, secret) {
  const encoder = new TextEncoder();
  const key = await self.crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  );
  const sigBytes = hexToBufferSw(signature);
  return self.crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(message));
}

function hexToBufferSw(hex) {
  const buf = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    buf[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return buf;
}

/* ─── Rate limiting (atomic) ─────────────────────────────────────────────── */
/**
 * Reads and conditionally increments the rate-limit bucket for `integrationKey`
 * in a single IDB readwrite transaction.
 *
 * Returns true if the request is within the limit, false if rate-limited.
 * Because the read AND conditional write happen in one transaction, no other
 * IDB transaction can interleave — this is genuinely race-free.
 */
function checkAndIncrementRateLimit(db, integrationKey) {
  const windowStart = new Date().toISOString().substring(0, 16); // "YYYY-MM-DDTHH:mm"
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rateLimitBuckets', 'readwrite');
    const store = tx.objectStore('rateLimitBuckets');
    let allowed = false;
    const getReq = store.get(integrationKey);
    getReq.onsuccess = () => {
      const bucket = getReq.result;
      if (bucket && bucket.windowStart === windowStart) {
        if (bucket.requestCount >= RATE_LIMIT_PER_MINUTE) {
          allowed = false;
          // No put — let the tx commit without incrementing
        } else {
          allowed = true;
          store.put({ integrationKey, windowStart, requestCount: bucket.requestCount + 1 });
        }
      } else {
        // New window or first request for this key
        allowed = true;
        store.put({ integrationKey, windowStart, requestCount: 1 });
      }
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve(allowed);
    tx.onerror = () => reject(tx.error);
  });
}

/* ─── Idempotency ────────────────────────────────────────────────────────── */
function getIdempotencyCache(db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('idempotencyKeys', 'readonly')
      .objectStore('idempotencyKeys').get(key);
    req.onsuccess = () => {
      const record = req.result;
      if (record && record.expiresAt > new Date().toISOString()) {
        resolve(record.responseSnapshot);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

function storeIdempotencyCache(db, key, integrationKey, snapshot) {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  return new Promise((resolve, reject) => {
    const req = db.transaction('idempotencyKeys', 'readwrite')
      .objectStore('idempotencyKeys')
      .put({ key, integrationKey, responseSnapshot: snapshot, createdAt: new Date().toISOString(), expiresAt });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ─── IDB helpers ────────────────────────────────────────────────────────── */
function openDb() {
  return new Promise((resolve, reject) => {
    // Open without specifying a version so we use whatever version the main app created.
    // If the DB doesn't exist yet we get an empty DB — handlers return empty arrays gracefully.
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // No onupgradeneeded — we never create schemas from the SW; the Angular app owns schema setup.
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function getFromStore(db, storeName, id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly')
      .objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/* ─── Response helpers ───────────────────────────────────────────────────── */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Simulated': 'true',
      'X-Simulator-Version': '1',
    },
  });
}
