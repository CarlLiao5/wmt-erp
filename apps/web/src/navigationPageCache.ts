export function createNavigationPageCache<T>(initialKey: string, initialValue: T) {
  const pages = new Map<string, T>([[initialKey, initialValue]]);
  const initialized = new Set<string>();
  const initializing = new Map<string, Promise<void>>();

  return {
    getOrCreate(key: string, create: () => T): T {
      if (pages.has(key)) return pages.get(key)!;
      const value = create();
      pages.set(key, value);
      return value;
    },
    isInitialized(key: string): boolean {
      return initialized.has(key);
    },
    async initialize(key: string, render: (value: T) => Promise<void>): Promise<void> {
      if (initialized.has(key)) return;
      const active = initializing.get(key);
      if (active) return active;
      if (!pages.has(key)) throw new Error(`Navigation page is not cached: ${key}`);
      const value = pages.get(key);
      if (value === undefined) throw new Error(`Navigation page is not cached: ${key}`);
      const pending = render(value).then(() => {
        initialized.add(key);
      }).finally(() => {
        initializing.delete(key);
      });
      initializing.set(key, pending);
      return pending;
    },
  };
}
