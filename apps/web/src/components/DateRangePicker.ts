const pad = (value: number) => String(value).padStart(2, '0');
const dateValue = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const monthTitle = (date: Date) => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(date);
const activePickers = new Set<HTMLElement>();
let dismissHandlerInstalled = false;

function installDismissHandler() {
  if (dismissHandlerInstalled) return;
  dismissHandlerInstalled = true;
  document.addEventListener('pointerdown', (event) => {
    for (const picker of activePickers) {
      if (!picker.isConnected || !picker.contains(event.target as Node)) {
        const popover = picker.querySelector<HTMLElement>('.date-range-popover');
        if (popover) popover.hidden = true;
        picker.closest<HTMLElement>('.panel')?.classList.remove('date-range-panel-open');
        activePickers.delete(picker);
      }
    }
  });
}

export function validDateRange(from: string, to: string): boolean {
  if (from && to && from > to) return false;
  const valid = (value: string) => {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00`);
    return !Number.isNaN(date.getTime()) && dateValue(date) === value;
  };
  return valid(from) && valid(to);
}

function monthMarkup(month: Date, from: string, to: string, activeField: 'from' | 'to') {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = first.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: string[] = [];
  for (let index = 0; index < 42; index++) {
    const day = index - offset + 1;
    if (day < 1 || day > days) {
      cells.push('<span class="date-range-empty" aria-hidden="true"></span>');
      continue;
    }
    const value = dateValue(new Date(month.getFullYear(), month.getMonth(), day));
    const selected = value === from || value === to;
    const range = from && to && value > from && value < to;
    const disabled = activeField === 'to' && from && value < from || activeField === 'from' && to && value > to;
    cells.push(`<button type="button" class="date-range-day${selected ? ' is-selected' : ''}${range ? ' is-in-range' : ''}" data-date-value="${value}"${selected ? ' aria-pressed="true"' : ''}${disabled ? ' disabled' : ''}>${day}</button>`);
  }
  return `<section class="date-range-month"><header><strong>${monthTitle(month)}</strong></header><div class="date-range-weekdays" aria-hidden="true"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="date-range-days">${cells.join('')}</div></section>`;
}

export function dateRangePickerMarkup(prefix: string, from: string, to: string) {
  return `<div class="date-range-picker" data-date-range-picker="${prefix}" data-active-field="from"><div class="date-range-fields"><div class="date-range-field"><label><span>开始日期</span><input type="text" name="from" inputmode="none" readonly data-date-range-from data-marketing-from aria-label="开始日期" value="${from}" placeholder="选择开始日期"></label><button type="button" data-date-range-open="from" aria-label="选择开始日期">▦</button></div><span class="date-range-separator">至</span><div class="date-range-field"><label><span>结束日期</span><input type="text" name="to" inputmode="none" readonly data-date-range-to data-marketing-to aria-label="结束日期" value="${to}" placeholder="选择结束日期"></label><button type="button" data-date-range-open="to" aria-label="选择结束日期">▦</button></div></div><div class="date-range-popover" hidden><div class="date-range-toolbar"><button type="button" data-date-range-prev aria-label="上个月">‹</button><div data-date-range-month-title></div><button type="button" data-date-range-next aria-label="下个月">›</button></div><div class="date-range-months" data-date-range-months></div><div class="date-range-footer"><span data-date-range-hint>先选择开始日期</span><button type="button" data-date-range-clear>清除日期</button></div></div><span class="date-range-error" role="alert" data-date-range-error></span></div>`;
}

export function mountDateRangePicker(root: ParentNode, prefix: string, onChange?: () => void) {
  const picker = root.querySelector<HTMLElement>(`[data-date-range-picker="${prefix}"]`);
  if (!picker) return;
  const fromInput = picker.querySelector<HTMLInputElement>('[data-date-range-from]')!;
  const toInput = picker.querySelector<HTMLInputElement>('[data-date-range-to]')!;
  const popover = picker.querySelector<HTMLElement>('.date-range-popover')!;
  const monthsHost = picker.querySelector<HTMLElement>('[data-date-range-months]')!;
  const hint = picker.querySelector<HTMLElement>('[data-date-range-hint]')!;
  const error = picker.querySelector<HTMLElement>('[data-date-range-error]')!;
  let visibleMonth = new Date(); visibleMonth.setDate(1);
  let activeField: 'from' | 'to' = 'from';
  const setError = (message = '') => { error.textContent = message; picker.classList.toggle('has-error', Boolean(message)); };
  const render = () => {
    const from = fromInput.value;
    const to = toInput.value;
    const second = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    picker.dataset.activeField = activeField;
    picker.querySelector<HTMLElement>('[data-date-range-month-title]')!.textContent = `${monthTitle(visibleMonth)} · ${monthTitle(second)}`;
    monthsHost.innerHTML = monthMarkup(visibleMonth, from, to, activeField) + monthMarkup(second, from, to, activeField);
    hint.textContent = !from ? '请选择开始日期' : !to ? '请选择结束日期' : `${from} 至 ${to}`;
    picker.querySelector('[data-date-range-prev]')!.toggleAttribute('disabled', false);
    monthsHost.querySelectorAll<HTMLButtonElement>('[data-date-value]').forEach((button) => button.onclick = () => {
      const value = button.dataset.dateValue!;
      if (activeField === 'from') {
        fromInput.value = value;
        toInput.value = '';
        activeField = 'to';
        picker.querySelector<HTMLButtonElement>('[data-date-range-open="to"]')!.focus();
      } else {
        if (fromInput.value && value < fromInput.value) { setError('结束日期不能早于开始日期'); return; }
        toInput.value = value;
        setError();
        popover.hidden = true;
        picker.closest<HTMLElement>('.panel')?.classList.remove('date-range-panel-open');
        activePickers.delete(picker);
        onChange?.();
      }
      render();
    });
    monthsHost.querySelectorAll<HTMLButtonElement>('[data-date-value]').forEach((button) => button.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const date = new Date(`${button.dataset.dateValue}T00:00:00`);
      date.setDate(date.getDate() + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : 7));
      const target = dateValue(date);
      const targetMonth = date.getFullYear() * 12 + date.getMonth();
      const firstMonth = visibleMonth.getFullYear() * 12 + visibleMonth.getMonth();
      if (targetMonth < firstMonth || targetMonth > firstMonth + 1) visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      render();
      monthsHost.querySelector<HTMLButtonElement>(`[data-date-value="${target}"]`)?.focus();
    });
  };
  const open = (field: 'from' | 'to') => { activeField = field; const value = field === 'from' ? fromInput.value : toInput.value; if (value) { const parsed = new Date(`${value}T00:00:00`); if (!Number.isNaN(parsed.getTime())) visibleMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1); } popover.hidden = false; picker.closest<HTMLElement>('.panel')?.classList.add('date-range-panel-open'); activePickers.add(picker); installDismissHandler(); render(); };
  picker.querySelectorAll<HTMLButtonElement>('[data-date-range-open]').forEach((button) => button.onclick = () => open(button.dataset.dateRangeOpen as 'from' | 'to'));
  fromInput.onfocus = () => open('from'); toInput.onfocus = () => open('to');
  picker.querySelector('[data-date-range-prev]')!.addEventListener('click', () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1); render(); });
  picker.querySelector('[data-date-range-next]')!.addEventListener('click', () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1); render(); });
  picker.querySelector('[data-date-range-clear]')!.addEventListener('click', () => { fromInput.value = ''; toInput.value = ''; activeField = 'from'; setError(); render(); popover.hidden = true; picker.closest<HTMLElement>('.panel')?.classList.remove('date-range-panel-open'); activePickers.delete(picker); onChange?.(); });
  picker.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !popover.hidden) { popover.hidden = true; picker.closest<HTMLElement>('.panel')?.classList.remove('date-range-panel-open'); activePickers.delete(picker); picker.querySelector<HTMLButtonElement>('[data-date-range-open="from"]')?.focus(); } });
  render();
}

export function validateDateRangePicker(root: ParentNode, prefix: string) {
  const picker = root.querySelector<HTMLElement>(`[data-date-range-picker="${prefix}"]`);
  if (!picker) return true;
  const from = picker.querySelector<HTMLInputElement>('[data-date-range-from]')!;
  const to = picker.querySelector<HTMLInputElement>('[data-date-range-to]')!;
  const error = picker.querySelector<HTMLElement>('[data-date-range-error]')!;
  const valid = validDateRange(from.value, to.value);
  const message = valid ? '' : from.value && to.value && from.value > to.value ? '开始日期不能晚于结束日期' : '日期格式无效';
  error.textContent = message;
  picker.classList.toggle('has-error', !valid);
  return valid;
}
