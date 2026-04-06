import { Injectable } from '@angular/core';
import { DigestRepository, NotificationRepository } from '../repositories';
import { Digest } from '../models';
import { NotificationDeliveryMode } from '../enums';
import { generateId, now, today } from '../utils/id';
import { AuthorizationError } from '../errors';

@Injectable({ providedIn: 'root' })
export class DigestService {
  constructor(private readonly digestRepo: DigestRepository, private readonly notifRepo: NotificationRepository) {}

  async generateDigest(userId: string, organizationId: string): Promise<Digest | null> {
    const digestDate = today(); const uniqueKey = `${userId}:${digestDate}`;
    const existing = await this.digestRepo.getByUniqueKey(uniqueKey); if (existing) return null;
    const all = await this.notifRepo.getByUser(userId);
    const items = all.filter(n => n.deliveryMode === NotificationDeliveryMode.Digest && !n.isCanceled && n.createdAt.startsWith(digestDate));
    if (items.length === 0) return null;
    const digest: Digest = { id: generateId(), userId, organizationId, digestDate, itemIds: items.map(n => n.id), deliveredAt: null, uniqueKey, version: 1, createdAt: now(), updatedAt: now() };
    await this.digestRepo.add(digest);
    return digest;
  }

  async markDelivered(digestId: string): Promise<void> {
    const d = await this.digestRepo.getById(digestId);
    if (!d) return;
    if (d.deliveredAt) return; // already delivered — pre-flight idempotent check
    // Atomic: check deliveredAt + write inside a single IDB readwrite transaction
    // Prevents double-delivery when two scheduler tabs call markDelivered concurrently.
    await this.digestRepo.updateWithLock(digestId, (current) => {
      if (current.deliveredAt) return current; // already delivered — idempotent inside lock
      return { ...current, deliveredAt: now(), updatedAt: now(), version: current.version + 1 };
    });
  }

  /**
   * Get undelivered digests for a user.
   * ABAC: actorId must equal userId (own digests only).
   *       Results filtered to actorOrgId.
   */
  async getUndeliveredForUser(userId: string, actorId: string, actorOrgId: string): Promise<Digest[]> {
    if (userId !== actorId) throw new AuthorizationError('Cannot access another user\'s digests');
    return (await this.digestRepo.getByUser(userId)).filter(
      d => !d.deliveredAt && d.organizationId === actorOrgId,
    );
  }

  /**
   * Get all digests for a user.
   * ABAC: actorId must equal userId (own digests only).
   *       Results filtered to actorOrgId.
   */
  async getAllForUser(userId: string, actorId: string, actorOrgId: string): Promise<Digest[]> {
    if (userId !== actorId) throw new AuthorizationError('Cannot access another user\'s digests');
    return (await this.digestRepo.getByUser(userId)).filter(d => d.organizationId === actorOrgId);
  }
}
