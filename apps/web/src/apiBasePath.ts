export function resolveApiRequestUrl(rawUrl: string, basePath = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') : string {
  const isApi = rawUrl.startsWith('/api/') || rawUrl.startsWith('http://localhost:3000/api/');
  if (!isApi) return rawUrl;
  const path = rawUrl.startsWith('http://localhost:3000/api/')
    ? new URL(rawUrl).pathname + new URL(rawUrl).search
    : rawUrl;
  const normalizedBase = basePath === '/' ? '' : basePath.replace(/\/$/, '');
  return normalizedBase && !path.startsWith(`${normalizedBase}/`) ? `${normalizedBase}${path}` : path;
}
