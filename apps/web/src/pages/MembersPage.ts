interface Member {
  id: string;
  email: string;
  username?: string | null;
  displayName: string | null;
  role: 'admin' | 'member';
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
);

async function request<T>(path = '', method?: string, data?: object): Promise<T> {
  const response = await fetch('/api/members' + path, {
    credentials: 'include', method,
    ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload?.error?.message ?? `请求失败（HTTP ${response.status}）`);
  return payload.data as T;
}

export async function renderMembersPage(main: HTMLElement): Promise<void> {
  main.innerHTML = `
    <div class="members-page">
      <header class="members-header"><div><p class="eyebrow">成员与权限</p><h1>成员管理</h1>
        <p class="muted">显示姓名用于匹配 ALLSKU 当前负责人。</p></div>
        <button type="button" class="primary" data-add disabled>＋ 添加成员</button>
      </header>
      <section class="panel members-panel" aria-label="成员列表">
        <div class="members-toolbar"><h2>成员列表 <span data-count></span></h2>
          <input type="search" aria-label="搜索成员" placeholder="搜索姓名、用户名或邮箱" disabled>
        </div>
        <div data-members-status role="status"></div>
        <div data-member-list><div class="empty">正在读取成员…</div></div>
      </section>
      <dialog class="members-dialog" aria-labelledby="member-dialog-title"></dialog>
    </div>`;
  const page = main.querySelector<HTMLElement>('.members-page')!;
  const list = page.querySelector<HTMLElement>('[data-member-list]')!;
  const count = page.querySelector<HTMLElement>('[data-count]')!;
  const notice = page.querySelector<HTMLElement>('[data-members-status]')!;
  const add = page.querySelector<HTMLButtonElement>('[data-add]')!;
  const search = page.querySelector<HTMLInputElement>('input[type=search]')!;
  const dialog = page.querySelector<HTMLDialogElement>('dialog')!;
  let members: Member[];

  function draw() {
    const filter = search.value.trim().toLowerCase();
    const visible = members.filter((member) =>
      [member.displayName, member.username, member.email].some((value) => value?.toLowerCase().includes(filter)),
    );
    count.textContent = filter ? `${visible.length} / ${members.length} 人` : `${members.length} 人`;
    list.innerHTML = visible.length ? `
      <div class="member-columns member-columns-heading" aria-hidden="true"><span>成员</span><span>角色</span><span>操作</span></div>
      <ul class="member-roster">${visible.map((member, index) => {
        const name = member.displayName || '未设置显示姓名';
        const initial = Array.from(member.displayName || member.email)[0]?.toUpperCase() ?? '?';
        return `<li class="member-columns">
          <div class="member-identity"><span class="member-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
            <div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(member.email)}</span><span>登录用户名：${escapeHtml(member.username || '未设置')}</span></div>
          </div><span class="member-role ${member.role === 'admin' ? 'is-admin' : ''}">${member.role === 'admin' ? '管理员' : '普通成员'}</span>
          ${member.id === 'admin' ? '' : `<div class="member-account-actions"><button type="button" class="secondary" data-username="${index}">设置用户名</button><button type="button" class="secondary" data-reset="${index}" aria-label="重设 ${escapeHtml(member.email)} 的密码">重设密码</button></div>`}
        </li>`;
      }).join('')}</ul>` : `<div class="empty">${filter ? '没有匹配的成员' : '暂无成员'}</div>`;
    list.querySelectorAll<HTMLButtonElement>('[data-username]').forEach((button) => {
      button.onclick = () => openUsernameForm(visible[Number(button.dataset.username)]!);
    });
    list.querySelectorAll<HTMLButtonElement>('[data-reset]').forEach((button) => {
      button.onclick = () => openForm(visible[Number(button.dataset.reset)]);
    });
  }

  function openUsernameForm(member: Member) {
    notice.textContent = '';
    dialog.innerHTML = `
      <form autocomplete="off">
        <h2 id="member-dialog-title">设置登录用户名</h2>
        <p class="muted">${escapeHtml(member.displayName || member.email)}</p>
        <label>登录用户名<input name="username" maxlength="64" pattern="[a-zA-Z0-9_]{1,64}" value="${escapeHtml(member.username || '')}" autocomplete="off" autofocus></label>
        <p class="muted">支持字母、数字和下划线，忽略大小写。留空可取消用户名，仍可使用邮箱登录。</p>
        <p data-form-status role="alert"></p>
        <div class="member-dialog-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit" class="primary">保存用户名</button></div>
      </form>`;
    const form = dialog.querySelector('form')!;
    const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    const cancel = form.querySelector<HTMLButtonElement>('[data-cancel]')!;
    const status = form.querySelector<HTMLElement>('[role=alert]')!;
    cancel.onclick = () => dialog.close();
    dialog.oncancel = event => { if (submit.disabled) event.preventDefault(); };
    dialog.onclose = () => form.reset();
    form.onsubmit = async event => {
      event.preventDefault();
      submit.disabled = cancel.disabled = true;
      status.textContent = '';
      try {
        const data = await request<{ username: string | null }>('/' + encodeURIComponent(member.id) + '/username', 'PATCH', {
          username: String(new FormData(form).get('username') ?? '').trim(),
        });
        member.username = data.username;
        draw();
        notice.textContent = '登录用户名已更新。';
        dialog.close();
      } catch (error) { status.textContent = error instanceof Error ? error.message : '保存失败'; }
      finally { submit.disabled = cancel.disabled = false; }
    };
    dialog.showModal();
  }

  function openForm(member?: Member) {
    notice.textContent = '';
    dialog.innerHTML = `
      <form autocomplete="off">
        <h2 id="member-dialog-title">${member ? '重设密码' : '添加成员'}</h2>
        ${member ? `<div class="member-reset-account"><strong>${escapeHtml(member.displayName || member.email)}</strong>
          ${member.displayName ? `<span>${escapeHtml(member.email)}</span>` : ''}
          <p>保存后，该成员需要用新密码重新登录。</p></div>`
          : '<label>邮箱<input name="email" type="email" maxlength="320" required autofocus></label><label>登录用户名（选填）<input name="username" maxlength="64" pattern="[a-zA-Z0-9_]{1,64}" placeholder="例如 lqh"></label><label>显示姓名<input name="displayName" maxlength="160"></label><label>角色<select name="role"><option value="member">普通成员</option><option value="admin">管理员</option></select></label>'}
        <label>${member ? '新密码' : '初始密码'}<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="至少 8 位" required ${member ? 'autofocus' : ''}></label>
        ${member ? '<label>确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>' : ''}
        <p data-form-status role="alert"></p>
        <div class="member-dialog-actions"><button type="button" class="secondary" data-cancel>取消</button>
          <button type="submit" class="primary">${member ? '保存新密码' : '添加成员'}</button></div>
      </form>`;
    const form = dialog.querySelector('form')!;
    const status = form.querySelector<HTMLElement>('[data-form-status]')!;
    const cancel = form.querySelector<HTMLButtonElement>('[data-cancel]')!;
    const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    cancel.onclick = () => dialog.close();
    dialog.oncancel = (event) => { if (submit.disabled) event.preventDefault(); };
    dialog.onclose = () => { form.reset(); };
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const password = String(values.get('password') ?? '');
      if (!password.trim()) { status.textContent = '密码不能全为空白'; return; }
      if (member && password !== values.get('confirmPassword')) { status.textContent = '两次输入的密码不一致'; return; }
      submit.disabled = cancel.disabled = true;
      status.textContent = '';
      form.setAttribute('aria-busy', 'true');
      const label = submit.textContent;
      submit.textContent = '正在保存…';
      try {
        if (member) {
          await request('/' + encodeURIComponent(member.id) + '/password', 'PATCH', { password });
          notice.textContent = '密码已更新。';
        } else {
          const created = await request<Member>('', 'POST', {
            email: values.get('email'), username: values.get('username'), displayName: values.get('displayName'), role: values.get('role'), password,
          });
          members.push(created);
          search.value = '';
          draw();
          notice.textContent = '成员已添加。';
        }
        dialog.close();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : '保存失败，请重试';
      } finally {
        submit.textContent = label;
        submit.disabled = cancel.disabled = false;
        form.removeAttribute('aria-busy');
      }
    };
    dialog.showModal();
  }

  try {
    members = await request<Member[]>();
    draw();
    add.disabled = search.disabled = false;
    add.onclick = () => openForm();
    search.oninput = draw;
  } catch (error) {
    const message = error instanceof Error ? error.message : '成员读取失败';
    list.innerHTML = `<div class="empty error">${escapeHtml(message)} <button type="button" class="secondary">重试</button></div>`;
    list.querySelector('button')!.onclick = () => { void renderMembersPage(main); };
  }
}
