import { Injectable } from '@angular/core';
import { AuditLogRepository } from '../db/audit-log.repository';
import { CryptoService } from './crypto.service';
import { AuditLog, AuditSearchParams } from '../models';
import { AuditAction, UserRole } from '../enums';
import { generateId, now } from '../utils/id';
import { AuthorizationError } from '../errors';

@Injectable({ providedIn: 'root' })
export class AuditService {
  constructor(private readonly auditRepo: AuditLogRepository, private readonly crypto: CryptoService) {}

  async log(actorId: string, action: AuditAction, entityType: string, entityId: string, organizationId: string, metadata: Record<string, unknown> = {}): Promise<AuditLog> {
    const lastLog = await this.auditRepo.getLast();
    const previousHash = lastLog?.entryHash ?? '0'.repeat(64);
    const entry: AuditLog = { id: generateId(), actorId, action, entityType, entityId, organizationId, timestamp: now(), metadata, previousHash, entryHash: '' };
    const hashInput = JSON.stringify({ id: entry.id, actorId: entry.actorId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId, organizationId: entry.organizationId, timestamp: entry.timestamp, metadata: entry.metadata, previousHash: entry.previousHash });
    entry.entryHash = await this.crypto.sha256(hashInput);
    await this.auditRepo.append(entry);
    return entry;
  }

  /**
   * Search audit logs.
   * RBAC: Administrator or HRCoordinator only.
   * ABAC: always scoped to actorOrgId — callers cannot search other orgs' logs.
   * The params.organizationId field is ignored; actorOrgId is the authoritative scope.
   */
  async search(
    params: AuditSearchParams,
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<AuditLog[]> {
    if (!actorRoles.some(r => r === UserRole.Administrator || r === UserRole.HRCoordinator)) {
      throw new AuthorizationError('Only Administrators and HR Coordinators can search audit logs');
    }

    let logs: AuditLog[];
    if (params.actorId && params.startDate && params.endDate) {
      const byActor = await this.auditRepo.getByActor(params.actorId);
      logs = byActor.filter(l => l.timestamp >= params.startDate! && l.timestamp <= params.endDate!);
    } else if (params.actorId) {
      logs = await this.auditRepo.getByActor(params.actorId);
    } else if (params.startDate && params.endDate) {
      logs = await this.auditRepo.getByDateRange(params.startDate, params.endDate);
    } else {
      logs = await this.auditRepo.getAll();
    }

    // Always enforce org scope — ignore any organizationId in params
    logs = logs.filter(l => l.organizationId === actorOrgId);

    if (params.action) logs = logs.filter(l => l.action === params.action);
    if (params.entityType) logs = logs.filter(l => l.entityType === params.entityType);
    logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 100;
    return logs.slice(offset, offset + limit);
  }

  /**
   * Verify the global audit hash chain.
   * Restricted to Administrators only — exposes the full chain structure.
   */
  async verifyIntegrity(actorRoles: UserRole[]): Promise<{ valid: boolean; brokenAt?: string }> {
    if (!actorRoles.includes(UserRole.Administrator)) {
      throw new AuthorizationError('Only Administrators can verify audit log integrity');
    }
    const allLogs = await this.auditRepo.getAll();
    allLogs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let expectedPreviousHash = '0'.repeat(64);
    for (const log of allLogs) {
      if (log.previousHash !== expectedPreviousHash) return { valid: false, brokenAt: log.id };
      const hashInput = JSON.stringify({ id: log.id, actorId: log.actorId, action: log.action, entityType: log.entityType, entityId: log.entityId, organizationId: log.organizationId, timestamp: log.timestamp, metadata: log.metadata, previousHash: log.previousHash });
      const computedHash = await this.crypto.sha256(hashInput);
      if (log.entryHash !== computedHash) return { valid: false, brokenAt: log.id };
      expectedPreviousHash = log.entryHash;
    }
    return { valid: true };
  }
}
