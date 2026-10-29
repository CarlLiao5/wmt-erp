import './styles.css';
import { renderDashboard, visibleNavigation } from './dashboard.js';
const root = document.querySelector<HTMLDivElement>('#root')!;
root.innerHTML = '<div class="login"><div class="login-card"><div class="brand">Walmart<span>ERP</span></div><p>正在验证登录状态...</p></div></div>';
const readToken = () => localStorage.getItem('erp_session') || '';
const saveToken = (token: string) => { localStorage.setItem('erp_session', token); };
// Keep every API call on the same session as the auth gate. This also covers
// direct localhost:3000 calls left by older page modules during development.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const isApi = rawUrl.startsWith('/api/') || rawUrl.startsWith('http://localhost:3000/api/');
  if (!isApi) return nativeFetch(input, init);
  // Older page modules use localhost:3000 directly. Rewrite those calls to the
  // Vite same-origin proxy so Authorization does not trigger a blocked CORS preflight.
  const requestUrl = rawUrl.startsWith('http://localhost:3000/api/')
    ? new URL(rawUrl).pathname + new URL(rawUrl).search
    : rawUrl;
  const token = readToken();
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
  return nativeFetch(requestUrl, { ...init, headers, credentials: init.credentials ?? 'include' });
};
const nav = ['Dashboard','Items','Orders','Returns','Inventory','WFS','面板','商品分析','ALLSKU2026','Pricing','Advertising','Performance','Targets','Weather','Members','Stores','Sync Status'];
function dashboard(role: 'admin' | 'member' = 'admin') { return renderDashboard(root, visibleNavigation(nav, role), role); }
function authUnavailable() { root.innerHTML = '<div class="login"><div class="login-card"><div class="brand">Walmart<span>ERP</span></div><h1>暂时无法验证登录</h1><p>登录状态已保留，请检查 API 服务后重试。</p><button id="retry-auth" type="button">重试</button><button id="show-login" type="button">重新登录</button></div></div>'; root.querySelector<HTMLButtonElement>('#retry-auth')!.onclick = () => { void startAuthenticatedApp(); }; root.querySelector<HTMLButtonElement>('#show-login')!.onclick = () => loginPage(); }
function loginPage() { document.querySelector<HTMLDivElement>('#root')!.innerHTML = `<div class="login"><div class="login-showcase"><div class="login-brand"><span class="login-brand-mark">W</span><span>Walmart<strong>ERP</strong></span></div><div class="login-showcase-copy"><p class="login-kicker">OPERATIONS WORKSPACE</p><h1>把每一次经营决策，<br><em>落到数据上。</em></h1><p>订单、库存、广告与绩效统一管理，让团队更快看清业务变化。</p></div><div class="login-showcase-footer"><span>Walmart Marketplace Operations</span><span>·</span><span>安全登录</span></div></div><div class="login-panel"><div class="login-panel-inner"><div class="login-panel-mobile-brand">Walmart<strong>ERP</strong></div><p class="login-kicker">欢迎回来</p><h2>登录运营工作台</h2><p class="login-subtitle">使用 ERP 账号进入系统</p><form id="login"><label for="login-email">邮箱地址</label><input id="login-email" name="email" type="email" autocomplete="username" value="admin@example.com" required><label for="login-password">密码</label><input id="login-password" name="password" type="password" autocomplete="current-password" value="admin123" required><button class="login-submit" type="submit"><span>登录</span><span aria-hidden="true">→</span></button><small id="error" role="alert"></small></form><p class="login-hint">请使用已分配的 ERP 账号登录</p></div></div></div>`; document.querySelector<HTMLFormElement>('#login')!.onsubmit = async (e) => { e.preventDefault(); const form = new FormData(e.currentTarget as HTMLFormElement); const submit = document.querySelector<HTMLButtonElement>('.login-submit')!; const error = document.querySelector<HTMLElement>('#error')!; submit.disabled = true; submit.querySelector('span')!.textContent = '登录中...'; error.textContent = ''; try { const result = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(Object.fromEntries(form)) }); if (result.ok) { const body = await result.json() as { data?: { token?: string; role?: 'admin' | 'member' } }; if (body.data?.token) saveToken(body.data.token); await dashboard(body.data?.role === 'member' ? 'member' : 'admin'); } else { error.textContent = '账号或密码错误，请重试'; } } catch { error.textContent = '暂时无法连接服务，请稍后重试'; } finally { submit.disabled = false; submit.querySelector('span')!.textContent = '登录'; } }; }
async function startAuthenticatedApp() {
  root.innerHTML = '<div class="login"><div class="login-card"><div class="brand">Walmart<span>ERP</span></div><p>正在验证登录状态...</p></div></div>';
  const candidate = readToken();
  let role: 'admin' | 'member' = 'admin';
  try {
    let response = await fetch('/api/auth/me', { credentials: 'include', headers: candidate ? { Authorization: 'Bearer ' + candidate } : undefined });
    // The HttpOnly cookie is the durable session source. A stale compatibility
    // token in localStorage must not invalidate an otherwise valid cookie.
    if (response.status === 401 && candidate) {
      response = await nativeFetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) localStorage.removeItem('erp_session');
    }
    const authenticated = response.ok;
    if (!authenticated && response.status !== 401) { authUnavailable(); return; }
    if (!authenticated) {
      localStorage.removeItem('erp_session');
      loginPage();
      return;
    }
    if (response.ok) {
      const body = await response.json() as { data?: { role?: 'admin' | 'member' } };
      role = body.data?.role === 'member' ? 'member' : 'admin';
    }
    if (location.search) history.replaceState(null, '', '/');
  } catch {
    authUnavailable();
    return;
  }
  // A data-loading failure must never be treated as an authentication failure.
  // Keep the authenticated shell visible and let the page render its own error state.
  await dashboard(role);
}
void startAuthenticatedApp();
