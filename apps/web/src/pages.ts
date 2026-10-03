export const pages = ['dashboard', 'items', 'orders', 'returns', 'inventory', 'wfs', 'pricing', 'performance', 'members', 'stores', 'sync-status'] as const;
export type Page = typeof pages[number];
export function pageTitle(page: Page): string { return page.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
