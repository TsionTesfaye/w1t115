import { Injectable } from '@angular/core';
import { MetricDefinitionRepository, DataDictionaryRepository, LineageLinkRepository, DatasetSnapshotRepository, JobRepository, ApplicationRepository, InterviewRepository, DocumentRepository } from '../repositories';
import { AuditService } from './audit.service';
import { MetricDefinition, DataDictionaryEntry, LineageLink, DatasetSnapshot, SnapshotManifest } from '../models';
import { AuditAction, SensitivityLevel, UserRole } from '../enums';
import { generateId, now } from '../utils/id';
import { AuthorizationError, NotFoundError } from '../errors';

@Injectable({ providedIn: 'root' })
export class GovernanceService {
  constructor(
    private readonly metricRepo: MetricDefinitionRepository,
    private readonly dictRepo: DataDictionaryRepository,
    private readonly lineageRepo: LineageLinkRepository,
    private readonly snapRepo: DatasetSnapshotRepository,
    private readonly jobRepo: JobRepository,
    private readonly appRepo: ApplicationRepository,
    private readonly intRepo: InterviewRepository,
    private readonly docRepo: DocumentRepository,
    private readonly audit: AuditService,
  ) {}

  private isMgmt(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.Administrator || r === UserRole.HRCoordinator);
  }

  async seedMetrics(): Promise<void> {
    if ((await this.metricRepo.getAll()).length > 0) return;
    const defs = [{ key: 'views', label: 'Total Views', desc: 'Count of page views' }, { key: 'favorites', label: 'Favorites', desc: 'Count of favorites' }, { key: 'inquiry_conversion', label: 'Inquiry Conversion', desc: 'Applications / Job Views' }];
    for (const d of defs) await this.metricRepo.add({ id: generateId(), key: d.key, label: d.label, formulaDescription: d.desc, seededBySystem: true, createdAt: now(), updatedAt: now() });
  }

  async seedDataDictionary(): Promise<void> {
    if ((await this.dictRepo.getAll()).length > 0) return;
    const entries = [
      { entityType: 'User', fieldName: 'passwordHash', description: 'PBKDF2 hash', dataType: 'string', sensitivity: SensitivityLevel.Restricted },
      { entityType: 'Application', fieldName: 'stage', description: 'Lifecycle position', dataType: 'ApplicationStage', sensitivity: SensitivityLevel.Internal },
      { entityType: 'Document', fieldName: 'encryptedBlob', description: 'AES-GCM encrypted file', dataType: 'string', sensitivity: SensitivityLevel.Restricted },
    ];
    for (const e of entries) await this.dictRepo.add({ id: generateId(), entityType: e.entityType, fieldName: e.fieldName, description: e.description, dataType: e.dataType, sensitivity: e.sensitivity, seededBySystem: true, updatedAt: now() });
  }

  /**
   * Metric definitions are system-global (no org scope).
   * RBAC: restricted to management — contains schema/sensitivity metadata.
   */
  async getMetricDefinitions(actorRoles: UserRole[]): Promise<MetricDefinition[]> {
    if (!this.isMgmt(actorRoles)) throw new AuthorizationError('Not authorized to view metric definitions');
    return this.metricRepo.getAll();
  }

  /**
   * Data dictionary is system-global (no org scope).
   * RBAC: restricted to management — describes field sensitivity classifications.
   */
  async getDataDictionary(actorRoles: UserRole[], entityType?: string): Promise<DataDictionaryEntry[]> {
    if (!this.isMgmt(actorRoles)) throw new AuthorizationError('Not authorized to view data dictionary');
    return entityType ? this.dictRepo.getByEntityType(entityType) : this.dictRepo.getAll();
  }

  /**
   * Traverse entity lineage.
   * RBAC: Administrator or HRCoordinator only.
   * ABAC: verifies the root entity belongs to actorOrgId for known entity types
   *       before traversing the graph.
   */
  async resolveLineage(entityType: string, entityId: string, actorRoles: UserRole[], actorOrgId: string): Promise<LineageLink[]> {
    if (!this.isMgmt(actorRoles)) throw new AuthorizationError('Not authorized to resolve lineage');

    // Verify root entity belongs to caller's org for supported entity types
    await this.assertEntityInOrg(entityType, entityId, actorOrgId);

    const result: LineageLink[] = [];
    const visited = new Set<string>();
    const collect = async (et: string, eid: string) => {
      const key = `${et}:${eid}`;
      if (visited.has(key)) return;
      visited.add(key);
      const links = await this.lineageRepo.getFromEntity(et, eid);
      for (const l of links) { result.push(l); await collect(l.toEntityType, l.toEntityId); }
    };
    await collect(entityType, entityId);
    return result;
  }

  async createSnapshot(label: string, queryNotes: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<DatasetSnapshot> {
    if (!actorRoles.includes(UserRole.Administrator) && !actorRoles.includes(UserRole.HRCoordinator)) {
      throw new AuthorizationError('Not authorized');
    }
    const existing = await this.snapRepo.getByOrganization(actorOrgId);
    if (existing.length >= 50) throw new Error('Snapshot limit reached (max 50)');
    const jobs = await this.jobRepo.getByOrganization(actorOrgId);
    const apps = await this.appRepo.getByOrganization(actorOrgId);
    const interviews = await this.intRepo.getByOrganization(actorOrgId);
    const docs = await this.docRepo.getByOrganization(actorOrgId);
    const manifest: SnapshotManifest = {
      entityCounts: { jobs: jobs.length, applications: apps.length, interviews: interviews.length, documents: docs.length },
      entityIds: { jobs: jobs.map(j => j.id), applications: apps.map(a => a.id), interviews: interviews.map(i => i.id), documents: docs.map(d => d.id) },
      entityData: {
        jobs: jobs.map(j => ({ ...j })),
        applications: apps.map(a => ({ ...a })),
        interviews: interviews.map(i => ({ ...i })),
        documents: docs.map(({ encryptedBlob: _eb, encryptionIv: _ei, ...rest }) => rest),
      },
      capturedAt: now(),
    };
    const snap: DatasetSnapshot = { id: generateId(), label, organizationId: actorOrgId, createdBy: actorId, manifest, queryNotes, version: 1, createdAt: now(), updatedAt: now() };
    await this.snapRepo.add(snap);
    await this.audit.log(actorId, AuditAction.SnapshotCreated, 'datasetSnapshot', snap.id, actorOrgId);
    return snap;
  }

  /**
   * List snapshots for the caller's organization.
   * RBAC: Administrator or HRCoordinator only.
   * ABAC: org derived from actorOrgId (session), not caller input.
   */
  async listSnapshots(actorRoles: UserRole[], actorOrgId: string): Promise<DatasetSnapshot[]> {
    if (!this.isMgmt(actorRoles)) throw new AuthorizationError('Not authorized to list snapshots');
    return this.snapRepo.getByOrganization(actorOrgId);
  }

  /**
   * Get a specific snapshot by ID.
   * RBAC: Administrator or HRCoordinator only.
   * ABAC: verifies snapshot belongs to caller's org.
   */
  async getSnapshot(id: string, actorRoles: UserRole[], actorOrgId: string): Promise<DatasetSnapshot> {
    if (!this.isMgmt(actorRoles)) throw new AuthorizationError('Not authorized to access snapshots');
    const s = await this.snapRepo.getById(id);
    if (!s) throw new NotFoundError('DatasetSnapshot', id);
    if (s.organizationId !== actorOrgId) throw new AuthorizationError('Cannot access snapshot from different organization');
    return s;
  }

  // ── private ───────────────────────────────────────────────────────────────

  /**
   * Verify a known entity type's org membership before graph traversal.
   * Unknown entity types are allowed through (no repo to check against).
   */
  private async assertEntityInOrg(entityType: string, entityId: string, actorOrgId: string): Promise<void> {
    let orgId: string | null = null;
    switch (entityType) {
      case 'job': { const e = await this.jobRepo.getById(entityId); orgId = e?.organizationId ?? null; break; }
      case 'application': { const e = await this.appRepo.getById(entityId); orgId = e?.organizationId ?? null; break; }
      case 'interview': { const e = await this.intRepo.getById(entityId); orgId = e?.organizationId ?? null; break; }
      case 'document': { const e = await this.docRepo.getById(entityId); orgId = e?.organizationId ?? null; break; }
      default: return; // entity type not known to this service — skip check
    }
    if (orgId === null) throw new NotFoundError(entityType, entityId);
    if (orgId !== actorOrgId) throw new AuthorizationError('Cannot resolve lineage for an entity from a different organization');
  }
}
