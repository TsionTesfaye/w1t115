import { Injectable } from '@angular/core';
import { STORAGE_CONSTANTS } from '../constants';

@Injectable({ providedIn: 'root' })
export class Database {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  async getDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = this.openDatabase();
    this.db = await this.dbPromise;
    this.dbPromise = null;
    return this.db;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(STORAGE_CONSTANTS.DB_NAME, STORAGE_CONSTANTS.DB_VERSION);
      request.onerror = () => reject(new Error(`Failed to open database: ${request.error?.message}`));
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStores(db);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => { this.db = null; };
        resolve(db);
      };
    });
  }

  private createStores(db: IDBDatabase): void {
    const stores: Array<{ name: string; keyPath: string; indexes?: Array<{ name: string; keyPath: string | string[]; unique?: boolean }> }> = [
      { name: 'users', keyPath: 'id', indexes: [{ name: 'username', keyPath: 'username', unique: true }, { name: 'organizationId', keyPath: 'organizationId' }] },
      { name: 'sessions', keyPath: 'id', indexes: [{ name: 'userId', keyPath: 'userId' }, { name: 'expiresAt', keyPath: 'expiresAt' }] },
      { name: 'jobs', keyPath: 'id', indexes: [{ name: 'organizationId', keyPath: 'organizationId' }, { name: 'ownerUserId', keyPath: 'ownerUserId' }, { name: 'status', keyPath: 'status' }, { name: 'org_status', keyPath: ['organizationId', 'status'] }] },
      { name: 'applications', keyPath: 'id', indexes: [{ name: 'jobId', keyPath: 'jobId' }, { name: 'candidateId', keyPath: 'candidateId' }, { name: 'organizationId', keyPath: 'organizationId' }, { name: 'candidate_job', keyPath: ['candidateId', 'jobId'] }, { name: 'stage', keyPath: 'stage' }, { name: 'status', keyPath: 'status' }] },
      { name: 'applicationPackets', keyPath: 'id', indexes: [{ name: 'applicationId', keyPath: 'applicationId', unique: true }, { name: 'status', keyPath: 'status' }] },
      { name: 'packetSections', keyPath: 'id', indexes: [{ name: 'applicationPacketId', keyPath: 'applicationPacketId' }] },
      { name: 'interviewPlans', keyPath: 'id', indexes: [{ name: 'jobId', keyPath: 'jobId' }, { name: 'organizationId', keyPath: 'organizationId' }] },
      { name: 'interviews', keyPath: 'id', indexes: [{ name: 'applicationId', keyPath: 'applicationId' }, { name: 'interviewerId', keyPath: 'interviewerId' }, { name: 'candidateId', keyPath: 'candidateId' }, { name: 'organizationId', keyPath: 'organizationId' }, { name: 'status', keyPath: 'status' }] },
      { name: 'interviewFeedback', keyPath: 'id', indexes: [{ name: 'interviewId', keyPath: 'interviewId' }, { name: 'interviewerId', keyPath: 'interviewerId' }, { name: 'organizationId', keyPath: 'organizationId' }] },
      { name: 'documents', keyPath: 'id', indexes: [{ name: 'ownerUserId', keyPath: 'ownerUserId' }, { name: 'applicationId', keyPath: 'applicationId' }, { name: 'organizationId', keyPath: 'organizationId' }, { name: 'status', keyPath: 'status' }] },
      { name: 'documentQuotaUsage', keyPath: 'userId' },
      { name: 'threads', keyPath: 'id', indexes: [{ name: 'organizationId', keyPath: 'organizationId' }, { name: 'contextType_contextId', keyPath: ['contextType', 'contextId'] }] },
      { name: 'messages', keyPath: 'id', indexes: [{ name: 'threadId', keyPath: 'threadId' }, { name: 'organizationId', keyPath: 'organizationId' }] },
      { name: 'notifications', keyPath: 'id', indexes: [{ name: 'userId', keyPath: 'userId' }, { name: 'organizationId', keyPath: 'organizationId' }, { name: 'type', keyPath: 'type' }, { name: 'eventId', keyPath: 'eventId' }, { name: 'user_type', keyPath: ['userId', 'type'] }] },
      { name: 'notificationPreferences', keyPath: 'id', indexes: [{ name: 'userId', keyPath: 'userId' }, { name: 'user_eventType', keyPath: ['userId', 'eventType'], unique: true }] },
      { name: 'digests', keyPath: 'id', indexes: [{ name: 'userId', keyPath: 'userId' }, { name: 'uniqueKey', keyPath: 'uniqueKey', unique: true }, { name: 'digestDate', keyPath: 'digestDate' }] },
      { name: 'delayedDeliveries', keyPath: 'id', indexes: [{ name: 'userId', keyPath: 'userId' }, { name: 'released', keyPath: 'released' }] },
      { name: 'contentPosts', keyPath: 'id', indexes: [{ name: 'organizationId', keyPath: 'organizationId' }, { name: 'authorId', keyPath: 'authorId' }, { name: 'status', keyPath: 'status' }] },
      { name: 'contentComments', keyPath: 'id', indexes: [{ name: 'postId', keyPath: 'postId' }, { name: 'organizationId', keyPath: 'organizationId' }, { name: 'status', keyPath: 'status' }, { name: 'authorId', keyPath: 'authorId' }] },
      { name: 'moderationCases', keyPath: 'id', indexes: [{ name: 'commentId', keyPath: 'commentId' }, { name: 'organizationId', keyPath: 'organizationId' }] },
      { name: 'sensitiveWords', keyPath: 'id' },
      { name: 'integrationRequests', keyPath: 'id', indexes: [{ name: 'organizationId', keyPath: 'organizationId' }, { name: 'integrationKey', keyPath: 'integrationKey' }] },
      { name: 'idempotencyKeys', keyPath: 'key', indexes: [{ name: 'expiresAt', keyPath: 'expiresAt' }, { name: 'integrationKey', keyPath: 'integrationKey' }] },
      { name: 'rateLimitBuckets', keyPath: 'integrationKey' },
      { name: 'activeIntegrationSecrets', keyPath: 'id', indexes: [{ name: 'integrationKey', keyPath: 'integrationKey' }, { name: 'organizationId', keyPath: 'organizationId' }, { name: 'org_key', keyPath: ['organizationId', 'integrationKey'] }] },
      { name: 'webhookQueue', keyPath: 'id', indexes: [{ name: 'status', keyPath: 'status' }, { name: 'nextRetryAt', keyPath: 'nextRetryAt' }, { name: 'organizationId', keyPath: 'organizationId' }] },
      { name: 'auditLogs', keyPath: 'id', indexes: [{ name: 'actorId', keyPath: 'actorId' }, { name: 'action', keyPath: 'action' }, { name: 'timestamp', keyPath: 'timestamp' }, { name: 'organizationId', keyPath: 'organizationId' }] },
      { name: 'metricDefinitions', keyPath: 'id', indexes: [{ name: 'key', keyPath: 'key', unique: true }] },
      { name: 'dataDictionaryEntries', keyPath: 'id', indexes: [{ name: 'entityType', keyPath: 'entityType' }] },
      { name: 'lineageLinks', keyPath: 'id', indexes: [{ name: 'fromEntityType_fromEntityId', keyPath: ['fromEntityType', 'fromEntityId'] }, { name: 'toEntityType_toEntityId', keyPath: ['toEntityType', 'toEntityId'] }] },
      { name: 'datasetSnapshots', keyPath: 'id', indexes: [{ name: 'organizationId', keyPath: 'organizationId' }, { name: 'createdAt', keyPath: 'createdAt' }] },
      { name: 'storageReservations', keyPath: 'id', indexes: [{ name: 'userId', keyPath: 'userId' }] },
      { name: 'orgAdminKeys', keyPath: 'organizationId' },
      { name: 'appConfig', keyPath: 'key' },
      { name: 'exportJobs', keyPath: 'id', indexes: [{ name: 'createdAt', keyPath: 'createdAt' }] },
    ];

    for (const storeDef of stores) {
      if (!db.objectStoreNames.contains(storeDef.name)) {
        const store = db.createObjectStore(storeDef.name, { keyPath: storeDef.keyPath });
        if (storeDef.indexes) {
          for (const idx of storeDef.indexes) {
            store.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
          }
        }
      }
    }
  }

  close(): void {
    if (this.db) { this.db.close(); this.db = null; }
  }

  async deleteDatabase(): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(STORAGE_CONSTANTS.DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete database'));
    });
  }
}
