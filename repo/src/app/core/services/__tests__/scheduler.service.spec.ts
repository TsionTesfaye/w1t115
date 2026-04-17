import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchedulerService } from '../scheduler.service';
import { SCHEDULER_CONSTANTS } from '../../constants';

// ── BroadcastChannel stub — jsdom does not implement it ───────────────────────

class MockChannel {
  static instances: MockChannel[] = [];
  name: string;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(name: string) { this.name = name; MockChannel.instances.push(this); }
  postMessage(_data: unknown) {}
  close() {}
}

vi.stubGlobal('BroadcastChannel', MockChannel);

// ── Shared mock services ───────────────────────────────────────────────────────

function makeServiceMocks() {
  return {
    applicationService: { expireOffer: vi.fn().mockResolvedValue(undefined) },
    digestService: { generateDigest: vi.fn().mockResolvedValue(null) },
    dndService: { releaseExpiredDelays: vi.fn().mockResolvedValue(undefined) },
    contentService: {
      expirePins: vi.fn().mockResolvedValue(undefined),
      publishScheduledPosts: vi.fn().mockResolvedValue(undefined),
    },
    integrationService: {
      processWebhookRetries: vi.fn().mockResolvedValue(undefined),
      cleanupExpiredKeys: vi.fn().mockResolvedValue(undefined),
    },
    appRepo: { getAll: vi.fn().mockResolvedValue([]) },
    userRepo: { getAll: vi.fn().mockResolvedValue([]) },
  };
}

function makeScheduler(mocks = makeServiceMocks()) {
  return new SchedulerService(
    mocks.applicationService as any,
    mocks.digestService as any,
    mocks.dndService as any,
    mocks.contentService as any,
    mocks.integrationService as any,
    mocks.appRepo as any,
    mocks.userRepo as any,
  );
}

beforeEach(() => {
  MockChannel.instances = [];
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  MockChannel.instances = [];
  localStorage.clear();
});

// ── existingLeaderIsAlive() ───────────────────────────────────────────────────

describe('SchedulerService — existingLeaderIsAlive()', () => {
  it('returns false when localStorage keys are absent', () => {
    const svc = makeScheduler();
    // Access private method via type cast
    const result = (svc as any).existingLeaderIsAlive();
    expect(result).toBe(false);
  });

  it('returns false when heartbeat key is present but leader key is absent', () => {
    localStorage.setItem(SCHEDULER_CONSTANTS.LEADER_HEARTBEAT_KEY, Date.now().toString());
    const svc = makeScheduler();
    expect((svc as any).existingLeaderIsAlive()).toBe(false);
  });

  it('returns false when heartbeat is stale (older than LEADER_TIMEOUT_MS)', () => {
    const staleTime = Date.now() - SCHEDULER_CONSTANTS.LEADER_TIMEOUT_MS - 1000;
    localStorage.setItem(SCHEDULER_CONSTANTS.LEADER_KEY, 'other-tab-id');
    localStorage.setItem(SCHEDULER_CONSTANTS.LEADER_HEARTBEAT_KEY, staleTime.toString());
    const svc = makeScheduler();
    expect((svc as any).existingLeaderIsAlive()).toBe(false);
  });

  it('returns true when heartbeat is fresh and leader is a different tab', () => {
    const freshTime = Date.now() - 1000; // 1 second ago, well within timeout
    localStorage.setItem(SCHEDULER_CONSTANTS.LEADER_KEY, 'other-tab-id');
    localStorage.setItem(SCHEDULER_CONSTANTS.LEADER_HEARTBEAT_KEY, freshTime.toString());
    const svc = makeScheduler();
    // The tabId of the new service won't match 'other-tab-id'
    expect((svc as any).existingLeaderIsAlive()).toBe(true);
  });

  it('returns false when own tabId is in leader key (bootstrap case)', () => {
    const svc = makeScheduler();
    const tabId: string = (svc as any).tabId;
    const freshTime = Date.now() - 100;
    localStorage.setItem(SCHEDULER_CONSTANTS.LEADER_KEY, tabId);
    localStorage.setItem(SCHEDULER_CONSTANTS.LEADER_HEARTBEAT_KEY, freshTime.toString());
    expect((svc as any).existingLeaderIsAlive()).toBe(false);
  });
});

// ── tick() logic ──────────────────────────────────────────────────────────────

describe('SchedulerService — tick()', () => {
  it('does nothing when state is "follower" (not leader)', async () => {
    const mocks = makeServiceMocks();
    const svc = makeScheduler(mocks);
    // Default state is 'follower'
    expect((svc as any).state).toBe('follower');
    await (svc as any).tick();
    expect(mocks.dndService.releaseExpiredDelays).not.toHaveBeenCalled();
    expect(mocks.contentService.expirePins).not.toHaveBeenCalled();
  });

  it('calls all scheduled task services when state is "leader"', async () => {
    const mocks = makeServiceMocks();
    const svc = makeScheduler(mocks);
    // Force leader state
    (svc as any).state = 'leader';
    await (svc as any).tick();
    expect(mocks.dndService.releaseExpiredDelays).toHaveBeenCalledOnce();
    expect(mocks.integrationService.processWebhookRetries).toHaveBeenCalledOnce();
    expect(mocks.integrationService.cleanupExpiredKeys).toHaveBeenCalledOnce();
    expect(mocks.contentService.expirePins).toHaveBeenCalledOnce();
    expect(mocks.contentService.publishScheduledPosts).toHaveBeenCalledOnce();
  });

  it('continues other tasks if one fails', async () => {
    const mocks = makeServiceMocks();
    mocks.dndService.releaseExpiredDelays = vi.fn().mockRejectedValue(new Error('DND fail'));
    const svc = makeScheduler(mocks);
    (svc as any).state = 'leader';
    await (svc as any).tick();
    // Other services should still be called despite DND failure
    expect(mocks.contentService.expirePins).toHaveBeenCalledOnce();
    expect(mocks.integrationService.processWebhookRetries).toHaveBeenCalledOnce();
  });
});
