import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { IntegrationConsoleComponent } from '../integration-console.component';
import { SessionService } from '../../../../core/services/session.service';
import { IntegrationService } from '../../../../core/services/integration.service';
import { UserRole } from '../../../../core/enums';
import { IntegrationResponse, WebhookQueueItem } from '../../../../core/models';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Mock helpers ─────────────────────────────────────────────────────────────

function makeSessionMock() {
  return {
    activeRole: signal(UserRole.Administrator),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Admin User' }),
    organizationId: computed(() => 'org1'),
    userId: computed(() => 'admin1'),
    userRoles: computed(() => [UserRole.Administrator]),
    requireAuth: () => ({
      userId: 'admin1',
      organizationId: 'org1',
      roles: [UserRole.Administrator],
      activeRole: UserRole.Administrator,
    }),
  };
}

const mockWebhookItems: WebhookQueueItem[] = [
  {
    id: 'wh1', organizationId: 'org1', targetName: 'Target A',
    payload: '{"event":"test","data":"some long payload content here"}',
    retryCount: 0, nextRetryAt: '2026-04-06T12:00:00Z', status: 'pending',
    version: 1, createdAt: '2026-04-06T10:00:00Z', updatedAt: '2026-04-06T10:00:00Z',
  },
  {
    id: 'wh2', organizationId: 'org1', targetName: 'Target B',
    payload: '{"event":"delivered"}',
    retryCount: 2, nextRetryAt: '2026-04-06T14:00:00Z', status: 'delivered',
    version: 3, createdAt: '2026-04-06T09:00:00Z', updatedAt: '2026-04-06T13:00:00Z',
  },
  {
    id: 'wh3', organizationId: 'org1', targetName: 'Target C',
    payload: '{"event":"fail"}',
    retryCount: 5, nextRetryAt: '2026-04-06T16:00:00Z', status: 'failed',
    version: 6, createdAt: '2026-04-06T08:00:00Z', updatedAt: '2026-04-06T15:00:00Z',
  },
];

const mockResponse: IntegrationResponse = {
  status: 200,
  body: '{"result":"ok"}',
  headers: { 'content-type': 'application/json' },
};

function makeIntegrationSvcMock(overrides: Record<string, any> = {}) {
  return {
    getWebhookQueue: vi.fn().mockResolvedValue(mockWebhookItems),
    processRequest: vi.fn().mockResolvedValue(mockResponse),
    ...overrides,
  };
}

function configure(svcOverrides: Record<string, any> = {}) {
  const integrationSvc = makeIntegrationSvcMock(svcOverrides);
  const sessionMock = makeSessionMock();

  TestBed.configureTestingModule({
    imports: [IntegrationConsoleComponent],
    providers: [
      { provide: SessionService, useValue: sessionMock },
      { provide: IntegrationService, useValue: integrationSvc },
    ],
  });

  const fixture = TestBed.createComponent(IntegrationConsoleComponent);
  return { component: fixture.componentInstance, integrationSvc, sessionMock };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('IntegrationConsoleComponent', () => {
  it('loads webhook queue on init', async () => {
    const { component, integrationSvc } = configure();
    await component.loadWebhookQueue();

    expect(integrationSvc.getWebhookQueue).toHaveBeenCalledWith(
      [UserRole.Administrator], 'org1',
    );
    expect(component.webhookQueue()).toHaveLength(3);
    expect(component.webhookQueue()[0].targetName).toBe('Target A');
  });

  it('sends integration request and displays response', async () => {
    const { component, integrationSvc } = configure();

    component.requestForm.patchValue({
      method: 'POST',
      endpoint: '/api/test',
      integrationKey: 'key-123',
      headers: '{"X-Custom": "val"}',
      body: '{"data": true}',
      idempotencyKey: 'idem-1',
      hmacSignature: 'sig-abc',
      secretVersion: 2,
    });

    await component.onSendRequest();

    expect(integrationSvc.processRequest).toHaveBeenCalledWith(
      'POST', '/api/test',
      { 'X-Custom': 'val' },
      '{"data": true}',
      'idem-1',
      'sig-abc',
      2,
      'key-123',
      'admin1',
      [UserRole.Administrator],
      'org1',
    );
    expect(component.response()).toBeDefined();
    expect(component.response()!.status).toBe(200);
    expect(component.response()!.body).toBe('{"result":"ok"}');
  });

  it('shows error for failed requests', async () => {
    const { component } = configure({
      processRequest: vi.fn().mockRejectedValue(new Error('Rate limit exceeded')),
    });

    component.requestForm.patchValue({
      method: 'GET',
      endpoint: '/api/fail',
      integrationKey: 'key-123',
    });

    await component.onSendRequest();

    expect(component.actionError()).toBe('Rate limit exceeded');
    expect(component.response()).toBeNull();
  });

  it('displays webhook queue with status badges', async () => {
    const { component } = configure();
    await component.loadWebhookQueue();

    const queue = component.webhookQueue();
    expect(queue[0].status).toBe('pending');
    expect(queue[1].status).toBe('delivered');
    expect(queue[2].status).toBe('failed');
    expect(queue[0].retryCount).toBe(0);
    expect(queue[2].retryCount).toBe(5);
  });

  it('parses headers JSON correctly', async () => {
    const { component, integrationSvc } = configure();

    component.requestForm.patchValue({
      method: 'GET',
      endpoint: '/test',
      integrationKey: 'key-1',
      headers: '{"Authorization": "Bearer token123", "Accept": "application/json"}',
      body: '',
    });

    await component.onSendRequest();

    expect(integrationSvc.processRequest).toHaveBeenCalledWith(
      'GET', '/test',
      { Authorization: 'Bearer token123', Accept: 'application/json' },
      null,
      null,
      null,
      null,
      'key-1',
      'admin1',
      [UserRole.Administrator],
      'org1',
    );
  });
});
