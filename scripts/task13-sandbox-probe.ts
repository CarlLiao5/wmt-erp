import { randomUUID } from 'node:crypto';
import { mysqlConnectionLoader } from '../apps/worker/src/queue.js';
import { getAccessToken } from '../packages/walmart-client/src/auth/token.js';
import { walmartRequest } from '../packages/walmart-client/src/request.js';

process.env.MYSQL_URL ??= 'mysql://walmart:walmart_dev@127.0.0.1:3306/walmart_erp';

const storeId = '001';
const context = { tenantId: 'default', storeId, resource: 'orders', window: { from: '', to: '' } };
const connection = await mysqlConnectionLoader(context);
if (connection.environment !== 'sandbox' || new URL(connection.baseUrl).hostname !== 'sandbox.walmartapis.com') {
  throw new Error('Refusing probe: store 001 is not connected to Walmart Sandbox');
}

const { accessToken } = await getAccessToken(connection);
const now = new Date();
const dateTime = (value: Date) => value.toISOString().replace(/\.\d{3}Z$/, 'Z');
const url = new URL('/v3/orders', connection.baseUrl);
url.searchParams.set('createdStartDate', dateTime(new Date(now.getTime() - 3 * 86_400_000)));
url.searchParams.set('createdEndDate', dateTime(now));
for (const shipNodeType of ['SellerFulfilled', 'WFSFulfilled']) {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set('shipNodeType', shipNodeType);
  const response = await walmartRequest(connection, requestUrl, {
    headers: {
      Accept: 'application/json',
      WM_SANDBOX: 'v2',
      Authorization: `Bearer ${accessToken}`,
      'WM_SEC.ACCESS_TOKEN': accessToken,
      'WM_QOS.CORRELATION_ID': randomUUID(),
      'WM_SVC.NAME': 'Walmart Marketplace',
      WM_MARKET: 'us',
      WM_GLOBAL_VERSION: '3.1',
    },
  });
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = {}; }
  const errors = (Array.isArray(body.errors) ? body.errors : [body.errors?.error?.[0] ?? body.error ?? body]).map((error: any) => ({
    code: typeof error?.code === 'string' ? error.code : undefined,
    description: String(error?.description ?? error?.message ?? '').replace(/(access[_ -]?token|client[_ -]?(secret|id)|authorization|password)\s*[:=]\s*[^,;\s]+/gi, '$1=[redacted]').slice(0, 200),
  })).filter((error: any) => error.code || error.description);
  console.log(JSON.stringify({ environment: connection.environment, storeId, resource: 'orders', shipNodeType, status: response.status, errors }));
}
