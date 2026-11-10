/* Acesso: tela de login, carregamento da conta e início do app. */
(function () {
  'use strict';
  const A = window.App;
  const api = A.api;
  const $ = (s) => document.querySelector(s);

  const NOTICE_KEY = 'controle-financeiro:notice';
  const form = $('#login-form');

  function show(which) {
    $('#auth-loading').hidden = which !== 'loading';
    form.hidden = which !== 'login';
    $('#auth-setup').hidden = which !== 'setup';
    $('#auth').hidden = which === 'app';
    $('#app').hidden = which !== 'app';
  }

  function showLogin(message) {
    show('login');
    const err = $('#login-error');
    err.textContent = message || '';
    err.hidden = !message;
    form.elements.password.value = '';
    (form.elements.username.value ? form.elements.password : form.elements.username).focus();
  }

  const takeNotice = () => {
    try {
      const n = sessionStorage.getItem(NOTICE_KEY);
      sessionStorage.removeItem(NOTICE_KEY);
      return n || '';
    } catch (e) { return ''; }
  };

  function loginMessage(e) {
    if (e.status === 0) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
    if (e.status === 429) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    if (e.code === 'user_banned' || /banned/i.test(e.message)) return 'Este acesso está desativado. Fale com o administrador.';
    if (e.status === 400 || e.status === 401) return 'Usuário ou senha incorretos.';
    return 'Não foi possível entrar agora. Tente de novo em instantes.';
  }

  /** Dados salvos neste navegador antes de existir login: oferece levar para a conta. */
  function offerLegacy(me) {
    const old = A.legacy.read();
    if (!old || A.store.state.transactions.length) return;
    const declinedKey = 'controle-financeiro:legacy-declined:' + me.id;
    try { if (localStorage.getItem(declinedKey)) return; } catch (e) { /* segue */ }
    const n = old.transactions.length;
    const what = n === 1 ? '1 lançamento salvo' : `${n} lançamentos salvos`;
    if (confirm(`Encontramos ${what} neste navegador, de antes do login. Importar para a conta @${me.username}?`)) {
      A.store.replace(old);
      A.legacy.clear();
    } else {
      try { localStorage.setItem(declinedKey, '1'); } catch (e) { /* segue */ }
    }
  }

  /** Com a sessão ativa: confere o perfil, carrega os dados e abre o app. */
  async function enter() {
    const me = await api.myProfile();
    if (!me || !me.active) {
      await api.signOut();
      const err = new Error('sem acesso');
      err.noAccess = true;
      throw err;
    }
    await A.store.load(api.userId);
    offerLegacy(me);
    show('app'); // antes do start: os gráficos medem a largura da tela
    A.start(me);
    api.onExpire(() => {
      try { sessionStorage.setItem(NOTICE_KEY, 'Sua sessão expirou. Entre novamente.'); } catch (e) { /* segue */ }
      location.reload();
    });
  }

  const NO_ACCESS = 'Esta conta não tem acesso ao sistema. Fale com o administrador.';
  const loadFailed = (e) =>
    e.status === 0
      ? 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
      : `Não foi possível carregar seus dados (${e.message}). Se o problema continuar, avise o administrador.`;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = form.elements.username.value.trim().toLowerCase();
    const password = form.elements.password.value;
    const btn = $('#login-submit');
    $('#login-error').hidden = true;
    btn.disabled = true;
    try {
      try {
        await api.signIn(username, password);
      } catch (ex) {
        showLogin(loginMessage(ex));
        return;
      }
      try {
        await enter();
      } catch (ex) {
        if (api.hasSession) await api.signOut();
        showLogin(ex.noAccess ? NO_ACCESS : loadFailed(ex));
      }
    } finally {
      btn.disabled = false;
    }
  });

  (async function boot() {
    if (!api.configured) { show('setup'); return; }
    show('loading');
    let note = takeNotice();
    if (api.hasSession) {
      try {
        await enter();
        return;
      } catch (e) {
        note = e.noAccess ? NO_ACCESS : api.hasSession ? loadFailed(e) : 'Sua sessão expirou. Entre novamente.';
      }
    }
    showLogin(note);
  })();
})();
