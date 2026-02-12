type Entry<T> = {
  value: T;
  expiresAt: number;
};

export class MemoryCache<T> {
  private store = new Map<string, Entry<T>>();

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlSeconds: number) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value, expiresAt });
  }
}

export const cache = new MemoryCache<unknown>();
