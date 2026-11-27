export interface BatchSnapshot {
    status: string;
    data: Array<{
        html?: string;
        rawHtml?: string;
        markdown?: string;
        metadata?: Record<string, unknown>;
    }>;
    creditsUsed?: number;
}
export class FirecrawlClient {
    private fetcher: typeof fetch;
    private sleep: (ms: number) => Promise<void>;
    constructor(private key: string, deps: {
        fetch?: typeof fetch;
        sleep?: (ms: number) => Promise<void>;
    } = {}) { this.fetcher = deps.fetch ?? fetch; this.sleep = deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms))); }
    private async request(path: string, body?: unknown): Promise<any> {
        const url = new URL(path, 'https://api.firecrawl.dev/v2/');
        if (url.origin !== 'https://api.firecrawl.dev' || !url.pathname.startsWith('/v2/batch/scrape'))
            throw new Error('拒绝非法 Firecrawl 结果地址');
        for (let retry = 0; retry <= 5; retry++) {
            let response: Response;
            try {
                response = await this.fetcher(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
            }
            catch {
                throw new Error(body ? 'Firecrawl 提交结果未知，已暂停以避免重复扣费' : 'Firecrawl 状态读取失败，保留原批次等待继续');
            }
            if (response.status === 429 && retry < 5) {
                const header = response.headers.get('retry-after');
                const numeric = Number(header);
                const ms = header ? (Number.isFinite(numeric) ? numeric * 1000 : Math.max(0, Date.parse(header) - Date.now())) : Math.min(60000, 2000 * 2 ** retry) + Math.random() * 500;
                await this.sleep(Number.isFinite(ms) ? ms : 60000);
                continue;
            }
            if (!response.ok)
                throw Object.assign(new Error(`Firecrawl HTTP ${response.status}`), { definitive: response.status >= 400 && response.status < 500 });
            let result: any;
            try {
                result = await response.json();
            }
            catch {
                throw new Error('Firecrawl 返回了非JSON响应');
            }
            if (result.success === false)
                throw Object.assign(new Error('Firecrawl 请求失败，请检查服务配置或额度'), { definitive: true });
            return result;
        }
        throw new Error('Firecrawl 限流重试耗尽');
    }
    async submit(urls: string[]): Promise<{
        batchId: string;
    }> {
        if (urls.length !== 1)
            throw new Error('评论抓取逐页提交');
        const result = await this.request('batch/scrape', { urls, formats: ['rawHtml', 'markdown'], onlyMainContent: false, maxConcurrency: 1, ignoreInvalidURLs: false });
        if (!result.id)
            throw new Error('Firecrawl 提交结果未知，缺少批次ID');
        return { batchId: result.id };
    }
    async poll(batchId: string): Promise<BatchSnapshot> {
        let path = `batch/scrape/${encodeURIComponent(batchId)}`;
        const data: BatchSnapshot['data'] = [];
        const seen = new Set<string>();
        let status = 'scraping';
        let creditsUsed: number | undefined;
        for (let i = 0; i < 100; i++) {
            const canonical = new URL(path, 'https://api.firecrawl.dev/v2/').href;
            if (seen.has(canonical))
                throw new Error('Firecrawl 结果分页循环');
            seen.add(canonical);
            const result = await this.request(path);
            status = result.status;
            creditsUsed = result.creditsUsed ?? creditsUsed;
            data.push(...(result.data ?? []));
            if (!result.next || (status !== 'completed' && new URL(result.next, 'https://api.firecrawl.dev/v2/').href === canonical))
                return { status, data, creditsUsed };
            path = result.next;
        }
        throw new Error('Firecrawl 结果分页超过安全上限');
    }
}
