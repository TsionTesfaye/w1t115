import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CrossTabService } from '../cross-tab.service';
import { BROADCAST_CHANNELS } from '../../constants';

// ── BroadcastChannel mock — jsdom does not implement it ───────────────────────

class MockChannel {
  static instances: MockChannel[] = [];
  name: string;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(name: string) {
    this.name = name;
    MockChannel.instances.push(this);
  }
  postMessage(data: unknown) {
    MockChannel.instances
      .filter(c => c.name === this.name && c !== this)
      .forEach(c => c.onmessage?.({ data }));
  }
  close() {}
}

vi.stubGlobal('BroadcastChannel', MockChannel);

beforeEach(() => {
  MockChannel.instances = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  MockChannel.instances = [];
});

// ── Helper ────────────────────────────────────────────────────────────────────

function makeService(): CrossTabService {
  return new CrossTabService();
}

// ── broadcast() ───────────────────────────────────────────────────────────────

describe('CrossTabService — broadcast()', () => {
  it('posts a message to the channel', () => {
    const svc = makeService();
    const sessionChannel = MockChannel.instances.find(c => c.name === BROADCAST_CHANNELS.SESSION)!;
    const received: unknown[] = [];
    sessionChannel.onmessage = (e) => received.push(e.data);
    svc.broadcast(BROADCAST_CHANNELS.SESSION, 'test_event', { foo: 'bar' });
    // The channel's postMessage delivers to OTHER instances; for a self-check,
    // we verify a second listener on the same channel name receives it.
    // Create a second instance with the same channel name:
    const receiver = new MockChannel(BROADCAST_CHANNELS.SESSION);
    const msgs: unknown[] = [];
    receiver.onmessage = (e) => msgs.push(e.data);
    svc.broadcast(BROADCAST_CHANNELS.SESSION, 'test_event', { foo: 'bar' });
    expect(msgs).toHaveLength(1);
    expect((msgs[0] as any).type).toBe('test_event');
    expect((msgs[0] as any).payload).toEqual({ foo: 'bar' });
  });

  it('includes tabId and timestamp in each message', () => {
    const svc = makeService();
    const receiver = new MockChannel(BROADCAST_CHANNELS.DATA);
    const msgs: unknown[] = [];
    receiver.onmessage = (e) => msgs.push(e.data);
    svc.broadcast(BROADCAST_CHANNELS.DATA, 'ping');
    expect((msgs[0] as any).tabId).toBeTruthy();
    expect((msgs[0] as any).timestamp).toBeTruthy();
  });
});

// ── onMessage() ───────────────────────────────────────────────────────────────

describe('CrossTabService — onMessage()', () => {
  it('handler is called when another tab sends a message', () => {
    const svc = makeService();
    const received: unknown[] = [];
    svc.onMessage(BROADCAST_CHANNELS.SESSION, (msg) => received.push(msg));

    // Simulate message from a different tab — fake a different tabId
    const sessionChannel = MockChannel.instances.find(c => c.name === BROADCAST_CHANNELS.SESSION)!;
    sessionChannel.onmessage?.({ data: { type: 'logout', tabId: 'other-tab-id', timestamp: new Date().toISOString() } });

    expect(received).toHaveLength(1);
    expect((received[0] as any).type).toBe('logout');
  });

  it('own messages are filtered out (same tabId is ignored)', () => {
    const svc = makeService();
    const received: unknown[] = [];
    svc.onMessage(BROADCAST_CHANNELS.SESSION, (msg) => received.push(msg));

    // Get the service's own tabId by broadcasting and capturing what was sent
    let sentTabId: string | null = null;
    const receiver = new MockChannel(BROADCAST_CHANNELS.SESSION);
    receiver.onmessage = (e) => { sentTabId = (e.data as any).tabId; };
    svc.broadcast(BROADCAST_CHANNELS.SESSION, 'probe');

    // Now simulate a message back from that same tabId to the service's channel handler
    const sessionChannel = MockChannel.instances.find(
      c => c.name === BROADCAST_CHANNELS.SESSION && c !== receiver,
    )!;
    if (sentTabId) {
      sessionChannel.onmessage?.({ data: { type: 'own-msg', tabId: sentTabId, timestamp: new Date().toISOString() } });
    }

    expect(received).toHaveLength(0);
  });
});

// ── broadcastLogout() ─────────────────────────────────────────────────────────

describe('CrossTabService — broadcastLogout()', () => {
  it('sends "logout" message on SESSION channel', () => {
    const svc = makeService();
    const receiver = new MockChannel(BROADCAST_CHANNELS.SESSION);
    const msgs: unknown[] = [];
    receiver.onmessage = (e) => msgs.push(e.data);
    svc.broadcastLogout();
    expect(msgs).toHaveLength(1);
    expect((msgs[0] as any).type).toBe('logout');
  });
});

// ── broadcastDataChange() ─────────────────────────────────────────────────────

describe('CrossTabService — broadcastDataChange()', () => {
  it('sends "data_change" on DATA channel with entityType and entityId', () => {
    const svc = makeService();
    const receiver = new MockChannel(BROADCAST_CHANNELS.DATA);
    const msgs: unknown[] = [];
    receiver.onmessage = (e) => msgs.push(e.data);
    svc.broadcastDataChange('application', 'app-123');
    expect((msgs[0] as any).type).toBe('data_change');
    expect((msgs[0] as any).payload).toEqual({ entityType: 'application', entityId: 'app-123' });
  });
});

// ── broadcastNotificationRefresh() ───────────────────────────────────────────

describe('CrossTabService — broadcastNotificationRefresh()', () => {
  it('sends "refresh" on NOTIFICATIONS channel', () => {
    const svc = makeService();
    const receiver = new MockChannel(BROADCAST_CHANNELS.NOTIFICATIONS);
    const msgs: unknown[] = [];
    receiver.onmessage = (e) => msgs.push(e.data);
    svc.broadcastNotificationRefresh();
    expect((msgs[0] as any).type).toBe('refresh');
  });
});

// ── ngOnDestroy() ─────────────────────────────────────────────────────────────

describe('CrossTabService — ngOnDestroy()', () => {
  it('closes all BroadcastChannel instances', () => {
    const svc = makeService();
    const closeSpy = vi.spyOn(MockChannel.prototype, 'close');
    svc.ngOnDestroy();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('no longer delivers messages after destroy', () => {
    const svc = makeService();
    const received: unknown[] = [];
    svc.onMessage(BROADCAST_CHANNELS.DATA, (msg) => received.push(msg));
    svc.ngOnDestroy();

    // After destroy, sending should not reach registered handlers (channels are cleared)
    const receiver = new MockChannel(BROADCAST_CHANNELS.DATA);
    receiver.onmessage = (e) => received.push(e.data);
    // Since channels map is cleared after destroy, broadcast is a no-op
    svc.broadcast(BROADCAST_CHANNELS.DATA, 'post-destroy');
    expect(received).toHaveLength(0);
  });
});
