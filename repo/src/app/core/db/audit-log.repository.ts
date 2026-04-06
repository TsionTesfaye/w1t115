/**
 * AuditLogRepository — private repository for the immutable audit log.
 *
 * This file is intentionally NOT exported from the repositories barrel
 * (src/app/core/repositories/index.ts). All reads and writes must go through
 * AuditService, which enforces RBAC and the SHA-256 hash chain.
 *
 * Do NOT import this class directly from application code. Use AuditService.
 */
import { Injectable } from '@angular/core';
import { Database } from './database';
import { AuditLog } from '../models';

@Injectable({ providedIn: 'root' })
export class AuditLogRepository {
  private readonly storeName = 'auditLogs';
  constructor(private readonly database: Database) {}

  async append(log: AuditLog): Promise<void> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).add(log);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<AuditLog[]> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  async getByActor(actorId: string): Promise<AuditLog[]> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).index('actorId').getAll(actorId);
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  async getByDateRange(start: string, end: string): Promise<AuditLog[]> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).index('timestamp').getAll(IDBKeyRange.bound(start, end));
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  async getLast(): Promise<AuditLog | null> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).index('timestamp').openCursor(null, 'prev');
      req.onsuccess = () => { resolve(req.result ? req.result.value : null); };
      req.onerror = () => reject(req.error);
    });
  }
}
