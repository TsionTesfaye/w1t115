import { Injectable, InjectionToken, Inject, Optional } from '@angular/core';
import { IntegrationRequestRepository, IdempotencyKeyRepository, IntegrationSecretRepository, WebhookQueueRepository } from '../repositories';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { IntegrationRequest, IntegrationResponse, WebhookQueueItem, IntegrationSecret } from '../models';
import { WebhookQueueStatus, AuditAction, UserRole } from '../enums';
import { INTEGRATION_CONSTANTS } from '../constants';
import { generateId, now } from '../utils/id';
import { AuthorizationError, RateLimitError, ValidationError } from '../errors';

/** Base URL intercepted by the integration simulator Service Worker. */
export const SIMULATOR_BASE = new InjectionToken<string>('SIMULATOR_BASE', {
  providedIn: 'root',
  factory: () => '/api/simulate',
});

@Injectable({ providedIn: 'root' })
export class IntegrationService {
  private readonly simulatorBase: string;

  constructor(
    private readonly intRepo: IntegrationRequestRepository,
    private readonly idempRepo: IdempotencyKeyRepository,
    private readonly secretRepo: IntegrationSecretRepository,
    private readonly webhookRepo: WebhookQueueRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @Optional() @Inject(SIMULATOR_BASE) simulatorBase?: string,
  ) {
    this.simulatorBase = simulatorBase ?? '/api/simulate';
  }

  /**
   * Send a simulated integration request.
   *
   * Flow:
   *  1. RBAC gate — Administrator only.
   *  2. HMAC signature verification if signature + body are provided.
   *  3. Fast idempotency cache read — return early if key already seen.
   *  4. Real fetch() to SIM_BASE + path — intercepted by the Service Worker.
   *     The SW atomically enforces rate limiting and stores the idempotency key.
   *  5. Persist an IntegrationRequest record and emit an audit event.
   */
  async processRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: string | null,
    idempotencyKey: string | null,
    signature: string | null,
    secretVersion: number | null,
    integrationKey: string,
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<IntegrationResponse> {
    if (!actorRoles.includes(UserRole.Administrator)) {
      throw new AuthorizationError('Only administrators can use the integration simulator');
    }

    // HMAC verification — done before any IDB/network work (fast fail)
    if (signature && body) {
      await this.verifySignature(body, signature, integrationKey, secretVersion, actorOrgId);
    }

    // Fast idempotency cache read (IDB, read-only).
    // The SW will also enforce idempotency atomically, but this early-exit
    // avoids a network round-trip for repeat requests.
    if (idempotencyKey) {
      const existing = await this.idempRepo.get(idempotencyKey);
      if (existing && existing.expiresAt > now()) {
        return existing.responseSnapshot;
      }
    }

    // Build request headers for the SW to consume
    const swHeaders: Record<string, string> = {
      ...headers,
      'X-Integration-Key': integrationKey,
      'X-Organization-Id': actorOrgId,
    };
    if (idempotencyKey) swHeaders['X-Idempotency-Key'] = idempotencyKey;
    if (signature) swHeaders['X-Signature'] = signature;
    if (secretVersion !== null) swHeaders['X-Secret-Version'] = String(secretVersion);

    // Real fetch — the Service Worker intercepts /api/simulate/** and:
    //   • enforces rate limiting (atomic IDB readwrite transaction)
    //   • checks + stores the idempotency key
    //   • routes the request to the simulated endpoint handler
    let httpResponse: Response;
    try {
      httpResponse = await fetch(`${this.simulatorBase}${path}`, {
        method,
        headers: swHeaders,
        body: body ?? undefined,
      });
    } catch (err) {
      throw new Error(`Integration simulator unreachable: ${err}`);
    }

    if (httpResponse.status === 429) {
      throw new RateLimitError('Rate limit exceeded');
    }

    const responseBody = await httpResponse.text();
    const responseHeaders: Record<string, string> = {};
    httpResponse.headers.forEach((value, key) => { responseHeaders[key] = value; });

    const response: IntegrationResponse = {
      status: httpResponse.status,
      body: responseBody,
      headers: responseHeaders,
    };

    // Persist request record + audit log
    const req: IntegrationRequest = {
      id: generateId(),
      organizationId: actorOrgId,
      method,
      path,
      headers,
      body,
      idempotencyKey,
      signature,
      secretVersion,
      integrationKey,
      responseSnapshot: response,
      version: 1,
      createdAt: now(),
      updatedAt: now(),
    };
    await this.intRepo.add(req);
    await this.audit.log(actorId, AuditAction.IntegrationRequest, 'integrationRequest', req.id, actorOrgId, { method, path, status: response.status });

    return response;
  }

  /** Enqueue a webhook item for async delivery with exponential-backoff retries. */
  async enqueueWebhook(targetName: string, payload: string, organizationId: string): Promise<WebhookQueueItem> {
    const item: WebhookQueueItem = {
      id: generateId(),
      organizationId,
      targetName,
      payload,
      retryCount: 0,
      nextRetryAt: now(),
      status: WebhookQueueStatus.Pending,
      version: 1,
      createdAt: now(),
      updatedAt: now(),
    };
    await this.webhookRepo.add(item);
    return item;
  }

  /**
   * Process pending webhook retries.
   *
   * Each item is delivered by making a real fetch() to the simulator's
   * /api/simulate/webhooks/dispatch endpoint (intercepted by the SW).
   *
   * Atomicity: each state transition uses updateWithLock() — a single IDB
   * readwrite transaction — eliminating double-put races.
   *
   * Backoff: nextRetryAt = now + 2^retryCount minutes.
   */
  async processWebhookRetries(): Promise<void> {
    const pending = await this.webhookRepo.getPendingRetries(now());
    for (const item of pending) {
      // Atomically mark as Processing
      try {
        await this.webhookRepo.updateWithLock(item.id, (current) => ({
          ...current,
          status: WebhookQueueStatus.Processing,
          version: current.version + 1,
          updatedAt: now(),
        }));
      } catch {
        continue; // already picked up by another scheduler run
      }

      // Attempt delivery — the SW intercepts and returns 200
      let deliverySucceeded = false;
      try {
        const res = await fetch(`${this.simulatorBase}/webhooks/dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: item.payload,
        });
        deliverySucceeded = res.ok;
      } catch {
        deliverySucceeded = false;
      }

      // Atomically record outcome
      const RETRY_WINDOW_MS = 15 * 60 * 1000; // 15 minutes total window
      await this.webhookRepo.updateWithLock(item.id, (current) => {
        if (deliverySucceeded) {
          return {
            ...current,
            status: WebhookQueueStatus.Delivered,
            version: current.version + 1,
            updatedAt: now(),
          };
        }
        const retryCount = current.retryCount + 1;
        const deadline = new Date(current.createdAt).getTime() + RETRY_WINDOW_MS;
        const windowExpired = Date.now() >= deadline;
        // Compute the candidate retry timestamp BEFORE deciding to schedule.
        // If the retry itself would land past the deadline, mark as failed immediately —
        // scheduling a retry we cannot honour within the window is a spec violation.
        const candidateNextRetryAt = Date.now() + Math.pow(2, retryCount) * 60000;
        const beyondDeadline = candidateNextRetryAt >= deadline;
        const exhausted = retryCount >= INTEGRATION_CONSTANTS.MAX_WEBHOOK_RETRIES || windowExpired || beyondDeadline;
        return {
          ...current,
          retryCount,
          status: exhausted ? WebhookQueueStatus.Failed : WebhookQueueStatus.Pending,
          nextRetryAt: exhausted
            ? current.nextRetryAt
            : new Date(candidateNextRetryAt).toISOString(),
          version: current.version + 1,
          updatedAt: now(),
        };
      });
    }
  }

  /** Remove idempotency keys whose TTL has expired. Called by the scheduler. */
  async cleanupExpiredKeys(): Promise<void> {
    await this.idempRepo.deleteExpired(now());
  }

  /**
   * Get the webhook queue for the caller's organization.
   * RBAC: Administrator only.
   * ABAC: org derived from actorOrgId (session), never from caller input.
   */
  async getWebhookQueue(actorRoles: UserRole[], actorOrgId: string): Promise<WebhookQueueItem[]> {
    if (!actorRoles.includes(UserRole.Administrator)) {
      throw new AuthorizationError('Only administrators can view the webhook queue');
    }
    return (await this.webhookRepo.getAll()).filter(w => w.organizationId === actorOrgId);
  }

  /** Create a new integration secret for the given key. RBAC: Administrator only. */
  async createSecret(
    integrationKey: string,
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<IntegrationSecret> {
    if (!actorRoles.includes(UserRole.Administrator)) {
      throw new AuthorizationError('Only administrators can manage integration secrets');
    }
    const secretBytes = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const secret: IntegrationSecret = {
      id: generateId(),
      organizationId: actorOrgId,
      integrationKey,
      secret: secretBytes,
      version: 1,
      activatedAt: now(),
      deactivatedAt: null,
    };
    await this.secretRepo.add(secret);
    return secret;
  }

  /**
   * Rotate a secret: create a new version, deactivate all previous versions for
   * the same integration key.
   */
  async rotateSecret(
    secretId: string,
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<IntegrationSecret> {
    if (!actorRoles.includes(UserRole.Administrator)) {
      throw new AuthorizationError('Only administrators can manage integration secrets');
    }
    const old = await this.secretRepo.getById(secretId);
    if (!old) throw new ValidationError('Secret not found');
    if (old.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    const newSecretBytes = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const newSecret: IntegrationSecret = {
      id: generateId(),
      organizationId: actorOrgId,
      integrationKey: old.integrationKey,
      secret: newSecretBytes,
      version: old.version + 1,
      activatedAt: now(),
      deactivatedAt: null,
    };
    await this.secretRepo.add(newSecret);
    // Deactivate all previous secrets for this org + integration key immediately.
    // Policy: no grace window — old secrets are invalid the moment a new one is created.
    // Use deactivateSecret() explicitly if a phase-out period is needed.
    const previous = await this.secretRepo.getByOrgAndKey(actorOrgId, old.integrationKey);
    const deactivateNow = now();
    for (const prev of previous) {
      if (prev.id !== newSecret.id && !prev.deactivatedAt) {
        await this.secretRepo.put({ ...prev, deactivatedAt: deactivateNow });
      }
    }
    return newSecret;
  }

  /** Deactivate a single secret by ID. RBAC: Administrator only. */
  async deactivateSecret(
    secretId: string,
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<void> {
    if (!actorRoles.includes(UserRole.Administrator)) {
      throw new AuthorizationError('Only administrators can manage integration secrets');
    }
    const secret = await this.secretRepo.getById(secretId);
    if (!secret) throw new ValidationError('Secret not found');
    if (secret.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    await this.secretRepo.put({ ...secret, deactivatedAt: now() });
  }

  /** List all integration secrets. RBAC: Administrator only. */
  async listSecrets(
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<IntegrationSecret[]> {
    if (!actorRoles.includes(UserRole.Administrator)) {
      throw new AuthorizationError('Only administrators can view integration secrets');
    }
    return this.secretRepo.getByOrganization(actorOrgId);
  }

  private async verifySignature(
    body: string,
    signature: string,
    integrationKey: string,
    secretVersion: number | null,
    actorOrgId: string,
  ): Promise<void> {
    // Scope lookup to this org to prevent cross-org secret reuse
    const secrets = await this.secretRepo.getByOrgAndKey(actorOrgId, integrationKey);
    if (!secrets.length) throw new ValidationError('No secrets configured');
    // Only active secrets are valid candidates
    const active = secrets.filter(s => !s.deactivatedAt);
    if (!active.length) throw new ValidationError('Invalid HMAC signature');
    const sorted = active.sort((a, b) => b.version - a.version);
    // Accept current version and one prior (rotation grace window)
    const candidates = secretVersion !== null
      ? sorted.filter(s => s.version === secretVersion || s.version === secretVersion - 1)
      : sorted.slice(0, 2);
    for (const s of candidates) {
      if (await this.crypto.verifyHmac(body, signature, s.secret)) return;
    }
    throw new ValidationError('Invalid HMAC signature');
  }
}
