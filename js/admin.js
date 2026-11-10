/* Tela "Usuários": só o administrador vê. Fala com a Edge Function admin-users. */
(function () {
  'use strict';
  const A = window.App;
  const api = A.api;
  const $ = (s, r = document) => r.querySelector(s);

  const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
  let users = [];
  let loading = false;
  let loadError = '';
  let selfId = null;
  let target = null; // usuário cuja senha está sendo redefinida

  const toast = (...a) => A.ui.toast(...a);

  /** Senha aleatória de 14 caracteres, sem letras que se confundem (0/O, 1/l/I). */
  function randomPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const limit = Math.floor(0x100000000 / alphabet.length) * alphabet.length;
    let out = '';
    const buf = new Uint32Array(1);
    while (out.length < 14) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) out += alphabet[buf[0] % alphabet.length];
    }
    return out;
  }

  const friendly = (e) =>
    e && e.status === 404
      ? 'A função admin-users ainda não foi publicada no Supabase. Veja o README, seção "Contas e dados (Supabase)".'
      : (e && e.message) || 'Algo deu errado. Tente de novo.';

  const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca entrou');

  /* ---------- lista ---------- */
  function draw() {
    const ul = $('#users');
    if (loadError) {
      ul.innerHTML = `<li class="empty-list">${A.esc(loadError)}</li>`;
    } else if (loading && !users.length) {
      ul.innerHTML = '<li class="empty-list">Carregando…</li>';
    } else {
      ul.innerHTML = users.map((u) => {
        const self = u.id === selfId;
        const tags =
          (u.role === 'admin' ? '<span class="badge">Administrador</span>' : '') +
          (u.active ? '' : '<span class="badge off">Desativado</span>') +
          (self ? '<span class="badge">você</span>' : '');
        const actions = self ? '' :
          `<button type="button" class="btn small" data-act="pw">Redefinir senha</button>
           <button type="button" class="btn small" data-act="role">${u.role === 'admin' ? 'Tornar usuário' : 'Tornar admin'}</button>
           <button type="button" class="btn small" data-act="active">${u.active ? 'Desativar' : 'Reativar'}</button>
           <button type="button" class="btn small danger" data-act="del">Excluir</button>`;
        return `<li class="usr${u.active ? '' : ' inactive'}" data-id="${A.esc(u.id)}">
          <div class="usr-main"><strong>${A.esc(u.display_name || u.username)}</strong>
            <span>@${A.esc(u.username)} · último acesso: ${A.esc(fmtWhen(u.last_sign_in_at))}</span></div>
          <div class="usr-tags">${tags}</div>
          <div class="usr-actions">${actions}</div></li>`;
      }).join('') || '<li class="empty-list">Nenhum usuário.</li>';
    }
    const active = users.filter((u) => u.active).length;
    $('#users-sub').textContent = users.length ? `${users.length} contas, ${active} ativas` : 'Contas com acesso ao sistema';
  }

  async function load() {
    loading = true;
    draw();
    try {
      users = (await api.admin('list')).users;
      loadError = '';
    } catch (e) {
      loadError = friendly(e);
    }
    loading = false;
    draw();
  }

  async function run(job, okMsg) {
    try {
      await job();
      toast(okMsg);
    } catch (e) {
      toast(friendly(e));
    }
    await load();
  }

  $('#users').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const u = users.find((x) => x.id === btn.closest('.usr').dataset.id);
    if (!u) return;
    const name = u.display_name || u.username;

    if (btn.dataset.act === 'pw') {
      target = u;
      $('#upw-who').textContent = `Nova senha para ${name} (@${u.username}).`;
      $('#upw-form').reset();
      $('#upw-form').elements.password.type = 'password';
      $('#upw-error').hidden = true;
      $('#upw-dialog').showModal();
      $('#upw-form').elements.password.focus();
    } else if (btn.dataset.act === 'role') {
      const to = u.role === 'admin' ? 'user' : 'admin';
      const msg = to === 'admin'
        ? `Tornar ${name} administrador? Esse usuário poderá criar, desativar e excluir contas.`
        : `Tirar o acesso de administrador de ${name}?`;
      if (confirm(msg)) run(() => api.admin('update', { id: u.id, role: to }), 'Perfil atualizado');
    } else if (btn.dataset.act === 'active') {
      if (u.active && !confirm(`Desativar ${name}? Essa conta não conseguirá mais entrar, mas os dados ficam guardados e podem ser reativados.`)) return;
      run(() => api.admin('update', { id: u.id, active: !u.active }), u.active ? 'Usuário desativado' : 'Usuário reativado');
    } else if (btn.dataset.act === 'del') {
      if (confirm(`Excluir ${name}? A conta e TODOS os lançamentos dessa conta serão apagados e isso não pode ser desfeito.`)) {
        run(() => api.admin('delete', { id: u.id }), 'Usuário excluído');
      }
    }
  });

  $('#users-refresh').addEventListener('click', load);

  /* ---------- criar usuário ---------- */
  const form = $('#user-form');
  $('#user-gen').addEventListener('click', () => {
    form.elements.password.type = 'text'; // mostra para o admin conseguir copiar
    form.elements.password.value = randomPassword();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const err = $('#user-error');
    const username = f.username.value.trim().toLowerCase();
    err.hidden = true;
    if (!USERNAME_RE.test(username)) {
      err.textContent = 'Usuário: 3 a 32 caracteres, só letras minúsculas sem acento, números, ponto, hífen e sublinhado.';
      err.hidden = false;
      return;
    }
    if (f.password.value.length < 8) { err.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; err.hidden = false; return; }
    const btn = $('#user-create');
    btn.disabled = true;
    try {
      await api.admin('create', {
        username,
        password: f.password.value,
        display_name: f.display_name.value.trim(),
        role: f.role.value,
      });
      form.reset();
      f.password.type = 'password';
      toast(`Usuário @${username} criado`);
      await load();
    } catch (ex) {
      err.textContent = friendly(ex);
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- redefinir senha de outro usuário ---------- */
  const upw = $('#upw-form');
  $('#upw-cancel').addEventListener('click', () => $('#upw-dialog').close());
  $('#upw-gen').addEventListener('click', () => {
    upw.elements.password.type = 'text';
    upw.elements.password.value = randomPassword();
  });
  upw.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#upw-error');
    err.hidden = true;
    if (!target) return;
    const btn = $('#upw-save');
    btn.disabled = true;
    try {
      await api.admin('update', { id: target.id, password: upw.elements.password.value });
      $('#upw-dialog').close();
      toast(`Senha de @${target.username} alterada`);
    } catch (ex) {
      err.textContent = friendly(ex);
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  A.admin = {
    setSelf(id) { selfId = id; },
    render: load,
  };
})();
