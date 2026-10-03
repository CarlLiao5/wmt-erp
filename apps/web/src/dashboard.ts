import { getOverview } from './api/client.js';
export async function renderDashboard(root: HTMLElement, nav: readonly string[]) {
  root.innerHTML = `<div class="shell"><aside><div class="brand">Walmart<span>ERP</span></div><nav>${nav.map((x,i)=>`<button class="nav ${i===0?'active':''}">${x}</button>`).join('')}</nav><div class="user">管理员</div></aside><main><header><div><p class="eyebrow">经营概览</p><h1>Dashboard</h1></div><div class="fresh">数据更新时间<br><strong>读取中...</strong></div></header><section class="metrics"><article><span>销售额</span><strong>$0.00</strong></article><article><span>订单数</span><strong>0</strong></article><article><span>销售件数</span><strong>0</strong></article><article><span>数据状态</span><strong class="ok">读取中</strong></article></section></main></div>`;
  const data = await getOverview();
  if (!data) return;
  const values = root.querySelectorAll('.metrics strong');
  values[0].textContent = `$${data.revenue.toFixed(2)}`; values[1].textContent = String(data.orders); values[2].textContent = String(data.units); values[3].textContent = '已同步';
  const fresh = root.querySelector('.fresh strong'); if (fresh) fresh.textContent = data.freshness ?? '等待首次同步';
}
