import { Database } from './database';

export abstract class BaseRepository<T extends { id: string }> {
  protected abstract readonly storeName: string;
  constructor(protected readonly database: Database) {}

  async getById(id: string): Promise<T | null> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<T[]> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllByIndex(indexName: string, value: IDBValidKey | IDBKeyRange): Promise<T[]> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).index(indexName).getAll(value);
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  async getOneByIndex(indexName: string, value: IDBValidKey | IDBKeyRange): Promise<T | null> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).index(indexName).get(value);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async put(item: T): Promise<T> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  async add(item: T): Promise<T> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).add(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async count(): Promise<number> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async countByIndex(indexName: string, value: IDBValidKey | IDBKeyRange): Promise<number> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).index(indexName).count(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async updateWithLock(id: string, updater: (current: T) => T): Promise<T> {
    const db = await this.database.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const current = getReq.result;
        if (!current) { reject(new Error(`${this.storeName}:${id} not found`)); return; }
        const updated = updater(current);
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }
}
