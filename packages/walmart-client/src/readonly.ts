export function assertReadOnly(method: string, path: string): void { if (method.toUpperCase() !== 'GET') throw new Error(`Walmart integration is read-only: ${method} ${path}`); }
