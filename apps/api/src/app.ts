import { loadProductProfit } from './routes/product-profit-snapshot.js';
import { profitRouter } from './routes/profit.js';
import { wfsCostsRouter } from './routes/wfs-costs.js';
import { productReviewsRouter } from './routes/product-reviews.js';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { healthRouter } from './routes/health.js';
import { dashboardRouter, mysqlDashboardSource, mysqlDashboardExtras } from './routes/dashboard.js';
import { syncStatusRouter } from './routes/sync-status.js';
import { itemsRouter, mysqlItemsSource } from './routes/items.js';
import { membersRouter, mysqlMembersSource } from './routes/members.js';
import { ordersRouter } from './routes/orders.js';
import { mysqlProductChineseNameResolver, returnsRouter } from './routes/returns.js';
import { inventoryRouter } from './routes/inventory.js';
import { mysqlWfsHistorySource, mysqlWfsReceiptSource, wfsRouter } from './routes/wfs.js';
import { overviewRouter } from './routes/overview.js';
import { performanceRouter, mysqlPerformanceSource } from './routes/performance.js';
import { pricingRouter, mysqlPricingSource } from './routes/pricing.js';
import { advertisingRouter, mysqlAdvertisingSource } from './routes/advertising.js';
import { opsRouter } from './routes/ops.js';
import { importsRouter } from './routes/imports.js';
import { authRouter, requestSession, mysqlUserFinder, type UserFinder } from './routes/auth.js';
import { storeManagementRouter } from './routes/store-management.js';
import { mysqlStoresRouter } from './routes/mysql-stores.js';
import { mysqlCommerceSource, unavailableCommerceSource, CommerceUnavailableError, type CommerceSource } from './routes/commerce-source.js';
import { mysqlAssignmentLoader, mysqlCustomerGrantLoader, resolveCommerceVisibility, type AssignmentLoader, type CustomerGrantLoader } from './routes/commerce-visibility.js';
import { createSyncRouter } from './routes/sync.js';
import { createSyncQueue, enqueueSync, reportQueueNameForStore, syncQueueNameForResource, weatherQueueName } from '../../worker/src/queue.js';
import { mysqlInventorySource } from './routes/inventory.js';
import { monthlyTargetsRouter } from './routes/monthlyTargetsRouter.js';
import { mysqlProductImageResolver } from './routes/product-images.js';
import { mysqlWecomConfigSource, wecomRouter } from './routes/wecom.js';
import { allSkuRouter, mysqlAllSkuSource } from './routes/smartsheet.js';
import { mysqlSyncPlanStore, syncPlansRouter } from './routes/sync-plans.js';
import { brightDataRouter, mysqlBrightDataCreateItem, mysqlBrightDataInventorySource, mysqlBrightDataItemsSource, mysqlBrightDataScheduleSource, mysqlBrightDataScheduleUpdater } from './routes/brightdata.js';
import { productAnalysisRouter, mysqlProductAnalysisAds, mysqlProductAnalysisOnsiteTerms, mysqlProductAnalysisProducts, mysqlProductAnalysisTerms } from './routes/product-analysis.js';
import { lingxingRouter, mysqlLingxingConfigSource } from './routes/lingxing.js';
import { weatherRouter, mysqlWeatherSource } from './routes/weather.js';
function awaitableInventorySource() { return mysqlInventorySource(); }
export interface AppOptions { commerce?: CommerceSource; findUser?: UserFinder; assignments?: AssignmentLoader; customerGrants?: CustomerGrantLoader; }
export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173'); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS'); if (req.method === 'OPTIONS') return res.sendStatus(204); next(); });
  app.use(express.json());
  // Normalize the compatibility Bearer token into the session cookie expected
  // by legacy route handlers. The browser may have localStorage only after a
  // previous login, while the HttpOnly cookie is unavailable to JavaScript.
  app.use((req, _res, next) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    if (bearer) req.headers.cookie = `erp_session=${bearer}`;
    next();
  });
  app.use((_req, res, next) => { res.locals.requestId = randomUUID(); next(); });
  app.use('/api', healthRouter());
  app.use('/api', wfsCostsRouter());
  app.use('/api', profitRouter());
  if (process.env.MYSQL_URL) app.use('/api', wecomRouter(mysqlWecomConfigSource()));
  if (process.env.MYSQL_URL) app.use('/api', lingxingRouter(mysqlLingxingConfigSource()));
  if (process.env.MYSQL_URL) app.use('/api', allSkuRouter(mysqlAllSkuSource()));
  app.use('/api', membersRouter(process.env.MYSQL_URL ? mysqlMembersSource() : undefined));
  const assignments = options.assignments ?? (process.env.MYSQL_URL ? mysqlAssignmentLoader() : async () => []);
  const customerGrants = options.customerGrants ?? (process.env.MYSQL_URL ? mysqlCustomerGrantLoader() : async () => []);
  const visibility = async (req: express.Request) => {
    const session = await requestSession(req);
    return session ? resolveCommerceVisibility(session, assignments, new Date(), customerGrants) : undefined;
  };
  if (process.env.MYSQL_URL) {
    const reviewProducts = mysqlProductAnalysisProducts();
    const reviewNames = mysqlProductChineseNameResolver();
    const reviewImages = mysqlProductImageResolver();
    app.use('/api', productReviewsRouter({ visibility, products: async (tenantId) => {
      const products = await reviewProducts(tenantId);
      const [names, images] = await Promise.all([reviewNames(tenantId, products), reviewImages(tenantId, products)]);
      return products.map(product => {
        const key = `${product.storeId}:${product.sku.trim().toLocaleUpperCase('en-US')}`;
        return { ...product, imageUrl: images.get(key) ?? product.imageUrl, chineseName: names.get(key) ?? null };
      });
    } }));
  }
  app.use('/api', syncStatusRouter({ visibility }));
  app.use('/api', brightDataRouter({
    inventory: process.env.MYSQL_URL ? mysqlBrightDataInventorySource() : async () => [],
    items: process.env.MYSQL_URL ? mysqlBrightDataItemsSource() : async () => [],
    createItem: process.env.MYSQL_URL ? mysqlBrightDataCreateItem() : async () => { throw new Error('Bright Data database unavailable'); },
    schedule: process.env.MYSQL_URL ? mysqlBrightDataScheduleSource() : async () => ({ enabled: false, timezone: 'Asia/Shanghai', nextRunAt: null, lastRunAt: null }),
    setSchedule: process.env.MYSQL_URL ? mysqlBrightDataScheduleUpdater() : async () => { throw new Error('Bright Data database unavailable'); },
    visibility,
  }));
  if (process.env.MYSQL_URL) app.use('/api', syncPlansRouter({
    store: mysqlSyncPlanStore(),
    session: async (req) => {
      const scope = await visibility(req);
      return scope?.tenantId ? { tenantId: scope.tenantId, role: scope.role, storeIds: scope.storeIds, skus: scope.skus } : undefined;
    },
  }));
  const dashboardSource = process.env.MYSQL_URL ? mysqlDashboardSource() : async () => [];
  const dashboardExtras = process.env.MYSQL_URL ? mysqlDashboardExtras() : undefined;
  app.use('/api', dashboardRouter(async (req) => { const v = await visibility(req); if (!v?.tenantId) return []; const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined; if (storeId && v.role !== 'admin' && !v.storeIds.has(storeId)) return []; return dashboardSource(v.tenantId, storeId, { skuId: typeof req.query.skuId === 'string' ? req.query.skuId : undefined, from: typeof req.query.from === 'string' ? req.query.from : undefined, to: typeof req.query.to === 'string' ? req.query.to : undefined }, v); }, async (req) => { const v = await visibility(req); if (!v?.tenantId || !dashboardExtras) return { stores: [], stockoutRisk: [], adSpend: { today: null, month: null, trend: [] }, highAcos: [] }; return dashboardExtras(v.tenantId, { storeId: typeof req.query.storeId === 'string' ? req.query.storeId : undefined, skuId: typeof req.query.skuId === 'string' ? req.query.skuId : undefined, from: typeof req.query.from === 'string' ? req.query.from : undefined, to: typeof req.query.to === 'string' ? req.query.to : undefined }, v); }, visibility));
  if (process.env.MYSQL_URL) app.use('/api', itemsRouter({ list: async (tenantId, storeId) => mysqlItemsSource()(tenantId, storeId), visibility: (req) => visibility(req as express.Request) }));
  const syncQueues = new Map<string, ReturnType<typeof createSyncQueue>>();
  app.use('/api', weatherRouter({
    source: process.env.MYSQL_URL ? mysqlWeatherSource() : undefined,
    visibility: async (req) => { const scope = await visibility(req); return scope?.tenantId ? { tenantId: scope.tenantId, role: scope.role } : undefined; },
    enqueue: async ({ tenantId, state, period, batchId }) => {
      let syncQueue = syncQueues.get(weatherQueueName);
      if (!syncQueue) { syncQueue = createSyncQueue(undefined, weatherQueueName); syncQueues.set(weatherQueueName, syncQueue); }
      const now = new Date().toISOString();
      return enqueueSync({ tenantId, storeId: '__tenant__', resource: 'weather', window: { from: now, to: now }, batchId, state, period }, syncQueue.queue);
    },
  }));
  app.use('/api', createSyncRouter(async (request) => {
    const queueName = syncQueueNameForResource(request.resource) === 'walmart-sync-reports' && request.storeId ? reportQueueNameForStore(request.storeId) : syncQueueNameForResource(request.resource);
    let syncQueue = syncQueues.get(queueName);
    if (!syncQueue) { syncQueue = createSyncQueue(undefined, queueName); syncQueues.set(queueName, syncQueue); }
    return enqueueSync(request, syncQueue.queue);
  }, visibility));
  const commerce = options.commerce ?? (process.env.MYSQL_URL ? mysqlCommerceSource() : unavailableCommerceSource());
  // Order and return tables only need images for the current page. Resolve those
  // SKUs directly instead of loading the full item catalog (which also parses
  // ALLSKU ownership metadata) on every commerce page request.
  const productImages = process.env.MYSQL_URL ? mysqlProductImageResolver() : undefined;
  app.use('/api', importsRouter({ visibility, orders: commerce.listOrders }));
  const productImageResolver = productImages;
  app.use('/api', monthlyTargetsRouter({ visibility, orders: commerce.listOrders, inventory: process.env.MYSQL_URL ? awaitableInventorySource() : async () => [], productImages: productImageResolver }));
  app.use('/api', ordersRouter({ list: commerce.listOrders, listPage: commerce.listOrdersPage, getOrderLines: commerce.getOrderLines, returns: commerce.listReturns, visibility, productImages, productChineseNames: process.env.MYSQL_URL ? mysqlProductChineseNameResolver() : undefined }));
  app.use('/api', returnsRouter({ list: commerce.listReturns, listPage: commerce.listReturnsPage, orders: commerce.listOrders, history: commerce.listReturnSnapshots, visibility, productImages, productChineseNames: process.env.MYSQL_URL ? mysqlProductChineseNameResolver() : undefined }));
  app.use('/api', inventoryRouter(process.env.MYSQL_URL ? (awaitableInventorySource()) : async () => [], commerce.listOrders, visibility));
  const wfsHistory = process.env.MYSQL_URL ? mysqlWfsHistorySource() : async () => [];
  const wfsReceipts = process.env.MYSQL_URL ? mysqlWfsReceiptSource() : async () => [];
  app.use('/api', wfsRouter(wfsHistory, visibility, wfsReceipts));
  app.use('/api', overviewRouter());
  app.use('/api', performanceRouter({ list: mysqlPerformanceSource(), visibility }));
  app.use('/api', pricingRouter({ list: mysqlPricingSource(), visibility, productImages: productImageResolver }));
  app.use('/api', advertisingRouter({ list: mysqlAdvertisingSource(), visibility }));
  app.use('/api', productAnalysisRouter({ visibility, profit: process.env.MYSQL_URL ? loadProductProfit : undefined, products: process.env.MYSQL_URL ? mysqlProductAnalysisProducts() : async () => [], orders: commerce.listOrders, returns: commerce.listReturns, ads: process.env.MYSQL_URL ? mysqlProductAnalysisAds() : async () => [], semTerms: process.env.MYSQL_URL ? mysqlProductAnalysisTerms() : async () => [], onsiteTerms: process.env.MYSQL_URL ? mysqlProductAnalysisOnsiteTerms() : async () => [] }));
  app.use('/api', opsRouter());
  app.use('/api', authRouter(options.findUser ?? (process.env.MYSQL_URL ? mysqlUserFinder() : undefined)));
  app.use('/api', process.env.MYSQL_URL ? mysqlStoresRouter() : storeManagementRouter());
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const rawMessage = error instanceof Error ? error.message : 'Internal Server Error';
    const message = /Failed query:|ER_[A-Z_]+|Incorrect .* value for column/i.test(rawMessage)
      ? `数据库保存失败，草稿未完成更新，请重试。问题编号：${res.locals.requestId}`
      : rawMessage;
    return res.status(error instanceof CommerceUnavailableError ? 503 : 500).json({ requestId: res.locals.requestId, data: null, error: { message } });
  };
  app.use(errors);
  return app;
}
