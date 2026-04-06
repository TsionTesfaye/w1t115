import { Injectable } from '@angular/core';
import { NotificationPreferenceRepository, DelayedDeliveryRepository } from '../repositories';
import { DelayedDelivery } from '../models';
import { generateId, now } from '../utils/id';

@Injectable({ providedIn: 'root' })
export class DNDService {
  constructor(private readonly prefRepo: NotificationPreferenceRepository, private readonly delayedRepo: DelayedDeliveryRepository) {}

  async isInDND(userId: string): Promise<boolean> {
    const prefs = await this.prefRepo.getByUser(userId); const dndPref = prefs.find(p => p.dndStart && p.dndEnd);
    if (!dndPref?.dndStart || !dndPref?.dndEnd) return false;
    return this.isTimeInWindow(dndPref.dndStart, dndPref.dndEnd);
  }

  async delayDelivery(notificationId: string, userId: string): Promise<DelayedDelivery> {
    const prefs = await this.prefRepo.getByUser(userId); const dndPref = prefs.find(p => p.dndEnd);
    let releaseAt = now();
    if (dndPref?.dndEnd) { const [h, m] = dndPref.dndEnd.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); releaseAt = d.toISOString(); }
    const delayed: DelayedDelivery = { id: generateId(), notificationId, userId, scheduledReleaseAt: releaseAt, released: false, createdAt: now(), updatedAt: now(), version: 1 };
    await this.delayedRepo.add(delayed); return delayed;
  }

  async releaseExpiredDelays(): Promise<DelayedDelivery[]> {
    const all = await this.delayedRepo.getAll(); const currentTime = now();
    const toRelease = all.filter(d => !d.released && d.scheduledReleaseAt <= currentTime);
    for (const d of toRelease) { d.released = true; d.updatedAt = now(); d.version += 1; await this.delayedRepo.put(d); }
    return toRelease;
  }

  private isTimeInWindow(start: string, end: string): boolean {
    const n = new Date(); const cur = n.getHours() * 60 + n.getMinutes();
    const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number);
    const s = sh * 60 + sm; const e = eh * 60 + em;
    return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
  }
}
