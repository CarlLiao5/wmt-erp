export interface Overview { revenue: number; orders: number; units: number; freshness: string | null; }
export async function getOverview(): Promise<Overview | null> { const response = await fetch('http://localhost:3000/api/overview', { credentials: 'include' }); if (!response.ok) return null; const body = await response.json() as { data?: Overview }; return body.data ?? null; }
