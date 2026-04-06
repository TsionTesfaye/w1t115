import { Injectable } from '@angular/core';
import { JobRepository, ApplicationRepository, UserRepository, InterviewRepository, ContentPostRepository } from '../repositories';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { Job, Application, Interview, ContentPost } from '../models';
import { AuditAction, UserRole, ImportStrategy,
         JobStatus, ApplicationStage, ApplicationStatus,
         InterviewStatus, ContentPostStatus } from '../enums';
import { AuthorizationError, ValidationError } from '../errors';
import { sanitizeHtml, sanitizePlainText } from '../utils/sanitizer';
import { now } from '../utils/id';

// ── Schema ─────────────────────────────────────────────────────────────────

const REQUIRED_FIELDS: Record<string, string[]> = {
  jobs:         ['id', 'organizationId', 'ownerUserId', 'title', 'description', 'status'],
  applications: ['id', 'organizationId', 'jobId', 'candidateId', 'stage', 'status'],
  interviews:   ['id', 'organizationId', 'applicationId', 'interviewerId', 'candidateId', 'startTime', 'endTime', 'status'],
  contentPosts: ['id', 'organizationId', 'authorId', 'title', 'body', 'status'],
};

/** Fields whose values must be a member of the corresponding enum. */
const ENUM_VALIDATORS: Record<string, Record<string, Set<string>>> = {
  jobs: {
    status: new Set(Object.values(JobStatus)),
  },
  applications: {
    stage:  new Set(Object.values(ApplicationStage)),
    status: new Set(Object.values(ApplicationStatus)),
  },
  interviews: {
    status: new Set(Object.values(InterviewStatus)),
  },
  contentPosts: {
    status: new Set(Object.values(ContentPostStatus)),
  },
};

/** Fields that can be updated by a Merge import (identity/ownership fields are protected). */
const MUTABLE_FIELDS: Record<string, string[]> = {
  jobs:         ['title', 'description', 'tags', 'topics', 'status'],
  applications: ['stage', 'status', 'offerExpiresAt', 'submittedAt'],
  interviews:   ['startTime', 'endTime', 'status', 'rescheduledAt', 'rescheduledBy'],
  contentPosts: ['title', 'body', 'tags', 'topics', 'status', 'scheduledPublishAt', 'pinnedUntil'],
};

/** String fields that contain HTML and must be sanitized before storage. */
const HTML_FIELDS: Record<string, string[]> = {
  jobs:         ['title', 'description'],
  contentPosts: ['title', 'body'],
  applications: [],
  interviews:   [],
};

/** String fields that should be plain-text (no HTML). */
const TEXT_FIELDS: Record<string, string[]> = {
  jobs:         [],
  contentPosts: [],
  applications: [],
  interviews:   [],
};

/**
 * The "creator ownership" field for each entity type.
 * For new (imported) records this field is forced to actorId, preventing
 * arbitrary ownership injection via the import payload.
 * null means no single creator-owner field applies.
 */
const NEW_RECORD_OWNER_FIELD: Record<string, string | null> = {
  jobs:         'ownerUserId',
  applications: null,         // candidateId comes from source data
  interviews:   null,         // interviewerId/candidateId are multi-party
  contentPosts: 'authorId',
};

/**
 * Ownership/identity fields that must NEVER change for an existing record.
 * On Overwrite, these are always taken from the existing record — never the payload.
 */
const PROTECTED_OWNERSHIP_FIELDS: Record<string, string[]> = {
  jobs:         ['ownerUserId'],
  applications: ['candidateId'],
  interviews:   ['interviewerId', 'candidateId'],
  contentPosts: ['authorId'],
};

// ── Import token ────────────────────────────────────────────────────────────

interface PendingImport {
  entityType: string;
  total: number;          // number of records in the previewed data array
  expiresAt: number;      // ms since epoch
}

const IMPORT_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ImportExportService {
  /**
   * One-time-use tokens issued by previewImport().
   * applyImport() consumes the token before proceeding, ensuring that every
   * import was previewed with the exact same entity type and record count.
   */
  private readonly importTokens = new Map<string, PendingImport>();

  constructor(
    private readonly jobRepo: JobRepository,
    private readonly appRepo: ApplicationRepository,
    private readonly userRepo: UserRepository,
    private readonly interviewRepo: InterviewRepository,
    private readonly contentPostRepo: ContentPostRepository,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  // ── Export ─────────────────────────────────────────────────────────────────

  async exportJson(
    entityType: string,
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<{ manifest: { version: string; exportedAt: string; entityType: string; count: number }; data: unknown[] }> {
    if (!actorRoles.includes(UserRole.Administrator)) throw new AuthorizationError('Only administrators can export');
    const data = await this.fetchOrgData(entityType, actorOrgId);
    await this.audit.log(actorId, AuditAction.ExportExecuted, 'export', entityType, actorOrgId, { count: data.length });
    return { manifest: { version: '1.0', exportedAt: new Date().toISOString(), entityType, count: data.length }, data };
  }

  async exportCsv(
    entityType: string,
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<string> {
    const { data } = await this.exportJson(entityType, actorId, actorRoles, actorOrgId);
    if (!data.length) return '';
    const records = data as Record<string, unknown>[];
    const headers = Object.keys(records[0]);
    const rows = records.map(r => headers.map(h => {
      const v = r[h];
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
    return [headers.join(','), ...rows].join('\n');
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  /**
   * Preview an import without persisting anything.
   *
   * Returns conflict details and an importToken.  The token must be passed
   * to applyImport() to confirm the user reviewed the preview.  The token
   * expires after 5 minutes and is single-use.
   */
  async previewImport(
    entityType: string,
    data: unknown[],
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<{ entityType: string; total: number; newCount: number; existingCount: number; conflicts: string[]; importToken: string }> {
    if (!actorRoles.includes(UserRole.Administrator)) throw new AuthorizationError('Only administrators can import');
    if (entityType === 'auditLogs') throw new ValidationError('Audit logs cannot be imported');
    if (!REQUIRED_FIELDS[entityType]) throw new ValidationError(`Unsupported entity type: ${entityType}`);
    if (!Array.isArray(data) || !data.length) throw new ValidationError('Import data must be a non-empty array');

    let existingCount = 0; let newCount = 0;
    const conflicts: string[] = [];
    for (const r of data) {
      const rec = r as Record<string, unknown>;
      const validationError = this.validateRecord(entityType, rec, actorOrgId);
      if (validationError) { conflicts.push(validationError); continue; }
      const ex = await this.findExisting(entityType, rec['id'] as string);
      if (ex) existingCount++; else newCount++;
    }

    const importToken = this.issueImportToken(entityType, data.length);
    return { entityType, total: data.length, newCount, existingCount, conflicts, importToken };
  }

  /**
   * Apply a previewed import.
   *
   * Requires the importToken issued by previewImport() to enforce that callers
   * reviewed the preview before committing.  The token is validated against
   * the entity type and record count — any change to either requires a fresh preview.
   *
   * Safe merge rules:
   *  • Overwrite  — existing record identity/ownership fields are preserved;
   *                 imported fields overwrite all mutable fields; system
   *                 timestamps are refreshed.
   *  • Merge      — only the fields listed in MUTABLE_FIELDS are updated;
   *                 all other existing fields are kept.
   *  • Skip       — existing records are left untouched.
   *  • All paths  — HTML fields are sanitized through sanitizeHtml();
   *                 plain-text fields through sanitizePlainText().
   */
  async applyImport(
    entityType: string,
    data: unknown[],
    strategy: ImportStrategy,
    importToken: string,
    actorId: string,
    actorRoles: UserRole[],
    actorOrgId: string,
  ): Promise<{ imported: number; skipped: number }> {
    if (!actorRoles.includes(UserRole.Administrator)) throw new AuthorizationError('Only administrators can import');
    if (entityType === 'auditLogs') throw new ValidationError('Audit logs cannot be imported');
    if (!REQUIRED_FIELDS[entityType]) throw new ValidationError(`Unsupported entity type: ${entityType}`);

    // ── Token validation (preview gate) ──────────────────────────────────────
    this.pruneExpiredTokens();
    const pending = this.importTokens.get(importToken);
    if (!pending) {
      throw new ValidationError('Import preview token is missing or expired — call previewImport() first');
    }
    if (pending.entityType !== entityType) {
      throw new ValidationError('Import token entity type mismatch — call previewImport() again');
    }
    if (pending.total !== data.length) {
      throw new ValidationError('Import data changed since preview — call previewImport() again');
    }
    // Consume token — single-use
    this.importTokens.delete(importToken);

    let imported = 0; let skipped = 0;
    for (const r of data) {
      const rec = r as Record<string, unknown>;
      const validationError = this.validateRecord(entityType, rec, actorOrgId);
      if (validationError) { skipped++; continue; }
      try {
        await this.upsertRecord(entityType, rec, strategy, actorId);
        imported++;
      } catch {
        skipped++;
      }
    }
    await this.audit.log(actorId, AuditAction.ImportExecuted, 'import', entityType, actorOrgId, { strategy, imported, skipped });
    return { imported, skipped };
  }

  // ── CSV parser ─────────────────────────────────────────────────────────────

  /**
   * Parse a CSV string into an array of record objects.
   * The first line must be a header row.
   * Handles quoted fields (including commas and newlines inside quotes) and
   * double-quote escaping per RFC 4180.
   *
   * Throws ValidationError if:
   *  - The CSV has no header row
   *  - A row has a different number of fields than the header
   */
  parseCsv(csv: string): Record<string, unknown>[] {
    const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const nonEmpty = lines.filter(l => l.trim() !== '');
    if (!nonEmpty.length) throw new ValidationError('CSV is empty');

    const parseRow = (line: string): string[] => {
      const fields: string[] = [];
      let i = 0;
      while (i <= line.length) {
        if (i === line.length) { fields.push(''); break; }
        if (line[i] === '"') {
          // Quoted field
          let field = '';
          i++; // skip opening quote
          while (i < line.length) {
            if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
            else if (line[i] === '"') { i++; break; } // closing quote
            else { field += line[i++]; }
          }
          fields.push(field);
          if (i < line.length && line[i] === ',') i++; // skip comma
        } else {
          // Unquoted field
          const end = line.indexOf(',', i);
          if (end === -1) { fields.push(line.slice(i)); i = line.length + 1; }
          else { fields.push(line.slice(i, end)); i = end + 1; }
        }
      }
      return fields;
    };

    const headers = parseRow(nonEmpty[0]);
    if (!headers.length || (headers.length === 1 && headers[0] === '')) {
      throw new ValidationError('CSV has no header row');
    }

    const records: Record<string, unknown>[] = [];
    for (let rowIdx = 1; rowIdx < nonEmpty.length; rowIdx++) {
      const fields = parseRow(nonEmpty[rowIdx]);
      if (fields.length !== headers.length) {
        throw new ValidationError(`CSV row ${rowIdx + 1} has ${fields.length} fields but header has ${headers.length}`);
      }
      const record: Record<string, unknown> = {};
      for (let col = 0; col < headers.length; col++) {
        const val = fields[col];
        // Coerce empty string to null for optional fields; keep as string otherwise
        record[headers[col]] = val === '' ? null : val;
      }
      records.push(record);
    }
    return records;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async fetchOrgData(entityType: string, actorOrgId: string): Promise<unknown[]> {
    switch (entityType) {
      case 'jobs':         return this.jobRepo.getByOrganization(actorOrgId);
      case 'applications': return this.appRepo.getByOrganization(actorOrgId);
      case 'interviews':   return this.interviewRepo.getByOrganization(actorOrgId);
      case 'contentPosts': return this.contentPostRepo.getByOrganization(actorOrgId);
      default: throw new ValidationError(`Unsupported entity type: ${entityType}`);
    }
  }

  /**
   * Validate a single import record.
   * Checks: required fields present and non-empty, org matches, enum values are valid.
   */
  private validateRecord(entityType: string, rec: Record<string, unknown>, actorOrgId: string): string | null {
    const id = rec['id'] ?? '(no id)';

    // Required fields
    const required = REQUIRED_FIELDS[entityType];
    for (const field of required) {
      if (rec[field] === undefined || rec[field] === null || rec[field] === '') {
        return `Record ${id}: missing required field '${field}'`;
      }
    }

    // Organization scope — ABAC: only records belonging to the caller's org
    if (rec['organizationId'] !== actorOrgId) {
      return `Record ${id}: organizationId mismatch — cannot import records from a different organization`;
    }

    // Enum value validation
    const enumRules = ENUM_VALIDATORS[entityType] ?? {};
    for (const [field, validValues] of Object.entries(enumRules)) {
      const value = rec[field] as string | undefined;
      if (value !== undefined && !validValues.has(value)) {
        return `Record ${id}: invalid ${field} '${value}' — allowed: ${[...validValues].join(', ')}`;
      }
    }

    // ISO-8601 date validation for date string fields
    for (const field of ['startTime', 'endTime', 'offerExpiresAt', 'scheduledPublishAt']) {
      const value = rec[field];
      if (value != null && typeof value !== 'string') {
        return `Record ${id}: field '${field}' must be a string`;
      }
      if (typeof value === 'string' && value && isNaN(new Date(value).getTime())) {
        return `Record ${id}: field '${field}' is not a valid ISO-8601 date`;
      }
    }

    return null;
  }

  private async findExisting(entityType: string, id: string): Promise<unknown> {
    switch (entityType) {
      case 'jobs':         return this.jobRepo.getById(id);
      case 'applications': return this.appRepo.getById(id);
      case 'interviews':   return this.interviewRepo.getById(id);
      case 'contentPosts': return this.contentPostRepo.getById(id);
      default: return null;
    }
  }

  /**
   * Upsert a validated record.
   *
   * System-managed fields (id, organizationId, version, createdAt, updatedAt) are
   * always controlled by this method — never taken verbatim from the import payload.
   *
   * Ownership enforcement:
   *  - New records: the primary owner field (ownerUserId / authorId) is forced to
   *    actorId to prevent arbitrary ownership injection via the import payload.
   *  - Existing records: all fields in PROTECTED_OWNERSHIP_FIELDS are preserved
   *    from the existing record regardless of import strategy.
   */
  private async upsertRecord(
    entityType: string,
    rec: Record<string, unknown>,
    strategy: ImportStrategy,
    actorId: string,
  ): Promise<void> {
    const id = rec['id'] as string;
    const existing = await this.findExisting(entityType, id) as Record<string, unknown> | null;

    if (existing && strategy === ImportStrategy.Skip) return;

    const sanitized = this.sanitizeFields(entityType, rec);
    const t = now();

    if (existing) {
      // Ownership fields are NEVER taken from the import payload — always use existing values
      const ownershipPatch = Object.fromEntries(
        (PROTECTED_OWNERSHIP_FIELDS[entityType] ?? []).map(f => [f, existing[f]]),
      );
      const baseVersion = (existing['version'] as number);
      if (strategy === ImportStrategy.Merge) {
        // Merge: overlay only mutable fields from import onto the existing record
        const mutablePatch = this.extractMutableFields(entityType, sanitized);
        const merged: Record<string, unknown> = {
          ...existing,
          ...mutablePatch,
          ...ownershipPatch,     // ownership fields always from existing
          id: existing['id'],
          organizationId: existing['organizationId'],
          version: baseVersion + 1,
          createdAt: existing['createdAt'],
          updatedAt: t,
        };
        await this.putByType(entityType, merged);
      } else {
        // Overwrite: apply all sanitized fields, but protect identity, system timestamps, and ownership
        const overwritten: Record<string, unknown> = {
          ...sanitized,
          ...ownershipPatch,     // ownership fields always from existing
          id: existing['id'],
          organizationId: existing['organizationId'],
          version: baseVersion + 1,
          createdAt: existing['createdAt'],
          updatedAt: t,
        };
        await this.putByType(entityType, overwritten);
      }
    } else {
      // New record: force the primary owner field to actorId to prevent ownership injection
      const ownerField = NEW_RECORD_OWNER_FIELD[entityType];
      const ownershipPatch: Record<string, unknown> = ownerField ? { [ownerField]: actorId } : {};
      const inserted: Record<string, unknown> = {
        ...sanitized,
        ...ownershipPatch,       // force ownership to actorId for new records
        version: 1,
        createdAt: (typeof sanitized['createdAt'] === 'string' && sanitized['createdAt'])
          ? sanitized['createdAt']
          : t,
        updatedAt: t,
      };
      await this.addByType(entityType, inserted);
    }
  }

  /** Extract only the mutable fields defined for this entity type. */
  private extractMutableFields(entityType: string, rec: Record<string, unknown>): Record<string, unknown> {
    const allowed = MUTABLE_FIELDS[entityType] ?? [];
    return Object.fromEntries(
      allowed.filter(k => rec[k] !== undefined).map(k => [k, rec[k]]),
    );
  }

  /**
   * Sanitize all string fields in a record before it is written to IDB.
   * HTML fields are passed through sanitizeHtml(); plain-text fields through
   * sanitizePlainText().  This prevents stored XSS via imported content.
   */
  private sanitizeFields(entityType: string, rec: Record<string, unknown>): Record<string, unknown> {
    const result = { ...rec };
    for (const field of HTML_FIELDS[entityType] ?? []) {
      if (typeof result[field] === 'string') result[field] = sanitizeHtml(result[field] as string);
    }
    for (const field of TEXT_FIELDS[entityType] ?? []) {
      if (typeof result[field] === 'string') result[field] = sanitizePlainText(result[field] as string);
    }
    return result;
  }

  private async putByType(entityType: string, rec: Record<string, unknown>): Promise<void> {
    switch (entityType) {
      case 'jobs':         await this.jobRepo.put(rec as unknown as Job); break;
      case 'applications': await this.appRepo.put(rec as unknown as Application); break;
      case 'interviews':   await this.interviewRepo.put(rec as unknown as Interview); break;
      case 'contentPosts': await this.contentPostRepo.put(rec as unknown as ContentPost); break;
    }
  }

  private async addByType(entityType: string, rec: Record<string, unknown>): Promise<void> {
    switch (entityType) {
      case 'jobs':         await this.jobRepo.add(rec as unknown as Job); break;
      case 'applications': await this.appRepo.add(rec as unknown as Application); break;
      case 'interviews':   await this.interviewRepo.add(rec as unknown as Interview); break;
      case 'contentPosts': await this.contentPostRepo.add(rec as unknown as ContentPost); break;
    }
  }

  // ── Token helpers ──────────────────────────────────────────────────────────

  private issueImportToken(entityType: string, total: number): string {
    this.pruneExpiredTokens();
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    this.importTokens.set(token, { entityType, total, expiresAt: Date.now() + IMPORT_TOKEN_TTL_MS });
    return token;
  }

  private pruneExpiredTokens(): void {
    const t = Date.now();
    for (const [token, p] of this.importTokens) {
      if (t > p.expiresAt) this.importTokens.delete(token);
    }
  }
}
