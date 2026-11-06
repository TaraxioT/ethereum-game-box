// An in-memory Durable Object store, for the relayer's and the demo Box's tests.

export class MemoryStore {
  readonly map = new Map<string, unknown>();
  async get<T>(key: string) {
    return this.map.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    this.map.set(key, structuredClone(value));
  }
  async delete(key: string) {
    return this.map.delete(key);
  }
  async list<T>({ prefix }: { prefix: string }) {
    return new Map([...this.map].filter(([key]) => key.startsWith(prefix)) as [string, T][]);
  }
}
