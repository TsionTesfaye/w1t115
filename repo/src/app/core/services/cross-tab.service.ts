import { Injectable, OnDestroy } from '@angular/core';
import { BROADCAST_CHANNELS } from '../constants';

export interface CrossTabMessage {
  type: string;
  payload?: unknown;
  tabId: string;
  timestamp: string;
}

type MessageHandler = (message: CrossTabMessage) => void;

/**
 * CrossTabService — coordinates state across browser tabs via BroadcastChannel.
 *
 * Responsibilities:
 * - Session invalidation broadcast
 * - Role change alerts
 * - Data refresh signals
 * - Notification state sync
 */
@Injectable({ providedIn: 'root' })
export class CrossTabService implements OnDestroy {
  private channels = new Map<string, BroadcastChannel>();
  private handlers = new Map<string, MessageHandler[]>();
  private readonly tabId = crypto.randomUUID();

  constructor() {
    this.initChannel(BROADCAST_CHANNELS.SESSION);
    this.initChannel(BROADCAST_CHANNELS.DATA);
    this.initChannel(BROADCAST_CHANNELS.NOTIFICATIONS);
  }

  private initChannel(name: string): void {
    if (typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(name);
    channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
      // Ignore messages from this tab
      if (event.data.tabId === this.tabId) return;

      const handlers = this.handlers.get(name) ?? [];
      for (const handler of handlers) {
        handler(event.data);
      }
    };
    this.channels.set(name, channel);
  }

  /**
   * Sends a message to all other tabs on the specified channel.
   */
  broadcast(channelName: string, type: string, payload?: unknown): void {
    const channel = this.channels.get(channelName);
    if (!channel) return;

    const message: CrossTabMessage = {
      type,
      payload,
      tabId: this.tabId,
      timestamp: new Date().toISOString(),
    };

    channel.postMessage(message);
  }

  /**
   * Registers a handler for messages on a specific channel.
   */
  onMessage(channelName: string, handler: MessageHandler): void {
    const existing = this.handlers.get(channelName) ?? [];
    existing.push(handler);
    this.handlers.set(channelName, existing);
  }

  /**
   * Broadcast logout to all tabs.
   */
  broadcastLogout(): void {
    this.broadcast(BROADCAST_CHANNELS.SESSION, 'logout');
  }

  /**
   * Broadcast data change to trigger refresh in other tabs.
   */
  broadcastDataChange(entityType: string, entityId: string): void {
    this.broadcast(BROADCAST_CHANNELS.DATA, 'data_change', { entityType, entityId });
  }

  /**
   * Broadcast notification refresh signal.
   */
  broadcastNotificationRefresh(): void {
    this.broadcast(BROADCAST_CHANNELS.NOTIFICATIONS, 'refresh');
  }

  ngOnDestroy(): void {
    for (const channel of this.channels.values()) {
      channel.close();
    }
    this.channels.clear();
    this.handlers.clear();
  }
}
