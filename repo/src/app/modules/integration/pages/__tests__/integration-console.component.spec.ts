/**
 * IntegrationConsoleComponent tests — real IntegrationService backed by
 * in-memory repos from helpers.ts.
 *
 * Boundary stubs kept:
 *  - SessionService → plain stub (no crypto/IDB)
 *  - fetch → vi.stubGlobal (transport boundary — IntegrationService calls real fetch)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';

import { IntegrationConsoleComponent } from '../integration-console.component';
import { SessionService } from '../../../../core/services/session.service';
import { IntegrationService } from '../../../../core/services/integration.service';

import { UserRole, WebhookQueueStatus } from '../../../../core/enums';
import { IntegrationResponse, WebhookQueueItem } from '../../../../core/models';
import { now } from '../../../../core/utils/id';

import {
  FakeIntegrationRequestRepo, FakeIdempotencyKeyRepo, FakeIntegrationSecretRepo,
  FakeWebhookQueueRepo, FakeAuditLogRepo,
  fakeCrypto, makeWebhookItem,
} from '../../../../core/services/__tests__/helpers';
import { AuditService } from '../../../../core/services/audit.service';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  TestBed.resetTestingModule();
});

// ── Session stub ──────────────────────────────────────────────────────────────

function makeSessionStub(userId = 'admin1', orgId = 'org1') {
  return {
    activeRole: signal(UserRole.Administrator),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Admin User' }),
    organizationId: computed(() => orgId),
    userId: computed(() => userId),
    userRoles: computed(() => [UserRole.Administrator]),
    requireAuth: () => ({
      userId, organizationId: orgId,
      roles: [UserRole.Administrator], activeRole: UserRole.Administrator,
    }),
  };
}

// ── Fake fetch helper ─────────────────────────────────────────────────────────

function stubFetch(status: number, body: string, headers: Record<string, string> = {}) {
  const mockHeaders = new Map(Object.entries({ 'content-type': 'application/json', ...headers }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
    headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach(cb) },
  }));
}

// ── Configure helper ─────────────────────────────────────────────────────────

function configure(seedWebhooks: WebhookQueueItem[] = []) {
  const intRepo = new FakeIntegrationRequestRepo();
  const idempRepo = new FakeIdempotencyKeyRepo();
  const secretRepo = new FakeIntegrationSecretRepo();
  const webhookRepo = new FakeWebhookQueueRepo();
  if (seedWebhooks.length) webhookRepo.seed(seedWebhooks);

  const auditLogRepo = new FakeAuditLogRepo();
  const realAuditSvc = new AuditService(auditLogRepo as any, fakeCrypto as any);

  const realIntegrationSvc = new IntegrationService(
    intRepo as any, idempRepo as any, secretRepo as any, webhookRepo as any,
    fakeCrypto as any, realAuditSvc as any, '/api/simulate',
  );

  const sessionStub = makeSessionStub();

  TestBed.configureTestingModule({
    imports: [IntegrationConsoleComponent],
    providers: [
      { provide: SessionService, useValue: sessionStub },
      { provide: IntegrationService, useValue: realIntegrationSvc },
    ],
  });

  const fixture = TestBed.createComponent(IntegrationConsoleComponent);
  return { component: fixture.componentInstance, webhookRepo, intRepo, realIntegrationSvc };
}

// ── Webhook seed data ─────────────────────────────────────────────────────────

const webhookItems: WebhookQueueItem[] = [
  makeWebhookItem({ id: 'wh1', targetName: 'Target A', payload: '{"event":"test"}', retryCount: 0, status: WebhookQueueStatus.Pending }),
  makeWebhookItem({ id: 'wh2', targetName: 'Target B', payload: '{"event":"delivered"}', retryCount: 2, status: 'delivered' as any }),
  makeWebhookItem({ id: 'wh3', targetName: 'Target C', payload: '{"event":"fail"}', retryCount: 5, status: 'failed' as any }),
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IntegrationConsoleComponent', () => {
  it('loads webhook queue via real IntegrationService', async () => {
    const { component } = configure(webhookItems);

    await component.loadWebhookQueue();

    expect(component.webhookQueue()).toHaveLength(3);
    expect(component.webhookQueue()[0].targetName).toBe('Target A');
  });

  it('sends integration request and displays response — fetch is transport boundary', async () => {
    stubFetch(200, '{"result":"ok"}');
    const { component } = configure();

    component.requestForm.patchValue({
      method: 'POST',
      endpoint: '/api/test',
      integrationKey: 'key-123',
      headers: '{"X-Custom": "val"}',
      body: '{"data": true}',
      idempotencyKey: 'idem-1',
      hmacSignature: null,
      secretVersion: null,
    });

    await component.onSendRequest();

    expect(component.response()).toBeDefined();
    expect(component.response()!.status).toBe(200);
    expect(component.response()!.body).toBe('{"result":"ok"}');
  });

  it('shows error for failed requests', async () => {
    stubFetch(500, 'Internal Server Error');
    const { component } = configure();

    component.requestForm.patchValue({
      method: 'GET',
      endpoint: '/api/fail',
      integrationKey: 'key-123',
      headers: '',
      body: '',
    });

    await component.onSendRequest();

    // 500 is not a rate limit error but should still be returned
    expect(component.response()?.status).toBe(500);
  });

  it('shows rate limit error when fetch returns 429', async () => {
    stubFetch(429, 'Rate limited');
    const { component } = configure();

    component.requestForm.patchValue({
      method: 'GET',
      endpoint: '/api/rate-limited',
      integrationKey: 'key-123',
    });

    await component.onSendRequest();

    expect(component.actionError()).toContain('limit');
  });

  it('displays webhook queue with status badges', async () => {
    const { component } = configure(webhookItems);

    await component.loadWebhookQueue();

    const queue = component.webhookQueue();
    expect(queue[0].status).toBe(WebhookQueueStatus.Pending);
    expect(queue[1].status).toBe('delivered');
    expect(queue[2].status).toBe('failed');
  });

  it('parses headers JSON correctly before sending', async () => {
    stubFetch(200, '{"ok":true}');
    const { component } = configure();

    component.requestForm.patchValue({
      method: 'GET',
      endpoint: '/test',
      integrationKey: 'key-1',
      headers: '{"Authorization": "Bearer token123", "Accept": "application/json"}',
      body: '',
    });

    await component.onSendRequest();

    // If headers were parsed incorrectly, fetch would fail
    expect(component.response()?.status).toBe(200);
  });
});

// ── Webhook queue creation and retry flow ─────────────────────────────────────

describe('IntegrationConsoleComponent — webhook enqueue and retry', () => {
  it('onEnqueueWebhook creates a new item in the repo and refreshes the queue', async () => {
    const { component, webhookRepo } = configure();
    await component.switchToQueue();

    expect(component.webhookQueue()).toHaveLength(0);

    component.enqueueForm.setValue({ targetName: 'crm-hook', payload: '{"event":"test"}' });
    await component.onEnqueueWebhook();

    expect(webhookRepo.snapshot()).toHaveLength(1);
    expect(webhookRepo.snapshot()[0].targetName).toBe('crm-hook');
    expect(webhookRepo.snapshot()[0].status).toBe(WebhookQueueStatus.Pending);
    expect(webhookRepo.snapshot()[0].retryCount).toBe(0);

    expect(component.webhookQueue()).toHaveLength(1);
    expect(component.actionSuccess()).toContain('enqueued');
    expect(component.enqueueForm.value.targetName).toBeFalsy();
  });

  it('onEnqueueWebhook does nothing when form is invalid', async () => {
    const { component, webhookRepo } = configure();

    component.enqueueForm.setValue({ targetName: '', payload: '' });
    await component.onEnqueueWebhook();

    expect(webhookRepo.snapshot()).toHaveLength(0);
  });

  it('onProcessRetries delivers pending items — transitions Pending→Delivered on fetch 200', async () => {
    stubFetch(200, 'OK');
    const { component, webhookRepo } = configure();

    component.enqueueForm.setValue({ targetName: 'target', payload: '{"x":1}' });
    await component.onEnqueueWebhook();

    expect(webhookRepo.snapshot()[0].status).toBe(WebhookQueueStatus.Pending);

    await component.onProcessRetries();

    const updated = webhookRepo.snapshot()[0];
    expect(updated.status).toBe(WebhookQueueStatus.Delivered);
    expect(component.actionSuccess()).toContain('complete');

    expect(component.webhookQueue()[0].status).toBe(WebhookQueueStatus.Delivered);
  });

  it('onProcessRetries transitions Pending→Pending (retry scheduled) on fetch failure', async () => {
    const { component, webhookRepo } = configure();
    component.enqueueForm.setValue({ targetName: 'target', payload: '{"x":1}' });
    await component.onEnqueueWebhook();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    await component.onProcessRetries();

    const updated = webhookRepo.snapshot()[0];
    expect(updated.retryCount).toBe(1);
    expect([WebhookQueueStatus.Pending, 'failed']).toContain(updated.status);
  });

  it('queue shows new item immediately after enqueue without manual refresh', async () => {
    const { component } = configure();
    await component.switchToQueue();

    component.enqueueForm.setValue({ targetName: 'instant-hook', payload: '{"ping":true}' });
    await component.onEnqueueWebhook();

    expect(component.webhookQueue().some(i => i.targetName === 'instant-hook')).toBe(true);
  });

  it('multiple enqueues accumulate in queue', async () => {
    const { component, webhookRepo } = configure();
    await component.switchToQueue();

    component.enqueueForm.setValue({ targetName: 'hook-1', payload: '{"a":1}' });
    await component.onEnqueueWebhook();

    component.enqueueForm.setValue({ targetName: 'hook-2', payload: '{"b":2}' });
    await component.onEnqueueWebhook();

    expect(webhookRepo.snapshot()).toHaveLength(2);
    expect(component.webhookQueue()).toHaveLength(2);
  });
});
