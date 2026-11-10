/* Cliente enxuto do Supabase: login por usuário/senha, sessão, REST e funções.
 * Sem bibliotecas: só fetch. Usa as APIs públicas GoTrue (/auth/v1) e
 * PostgREST (/rest/v1) e a Edge Function admin-users (/functions/v1). */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const cfg = window.APP_CONFIG || {};
  const SESSION_KEY = 'controle-financeiro:session';
  const PAGE = 1000; // limite padrão de linhas por resposta do PostgREST
  const CHUNK = 500; // linhas por INSERT em lote

  class ApiError extends Error {
    constructor(message, status, code) {
      super(message);
      this.status = status || 0;
      this.code = code || '';
    }
  }

  const configured =
    /^https?:\/\/[^\s/]+\/?$/i.test(cfg.supabaseUrl || '') &&
    /^(sb_publishable_|eyJ)/.test(cfg.supabaseKey || '') &&
    !!cfg.emailDomain;
  const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');

  /* ---------- sessão (fica no navegador, como no supabase-js) ---------- */
  let session = readSession();
  const expireHandlers = [];

  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (s && s.access_token && s.refresh_token && s.user_id) return s;
    } catch (e) { /* sem storage ou JSON quebrado */ }
    return null;
  }
  function saveSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* storage indisponível: a sessão vale só nesta aba */ }
  }
  function fromToken(r) {
    return {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600),
      user_id: r.user && r.user.id,
    };
  }

  /* ---------- HTTP ---------- */
  const messageOf = (d) =>
    (d && (d.msg || d.message || d.error_description || (typeof d.error === 'string' && d.error))) ||
    (typeof d === 'string' && d.slice(0, 200)) || 'Erro inesperado do servidor.';

  async function http(path, { method = 'GET', body, headers = {}, token } = {}) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          apikey: cfg.supabaseKey,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError('Sem conexão com o servidor.', 0, 'network');
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
    if (!res.ok) throw new ApiError(messageOf(data), res.status, data && (data.error_code || data.code));
    return data;
  }

  let refreshing = null;
  function refresh() {
    if (!session) return Promise.reject(new ApiError('Sessão expirada.', 401, 'no_session'));
    if (!refreshing) {
      refreshing = http('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: session.refresh_token },
      })
        .then((d) => { saveSession(fromToken(d)); })
        .catch((e) => {
          if (e.status >= 400 && e.status < 500) { saveSession(null); expireHandlers.forEach((f) => f()); }
          throw e;
        })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function accessToken() {
    if (!session) throw new ApiError('Sessão expirada.', 401, 'no_session');
    if (session.expires_at - 60 < Date.now() / 1000) await refresh();
    return session.access_token;
  }

  /** Requisição autenticada; se o token for recusado, renova uma vez e tenta de novo. */
  async function authed(path, opts) {
    const token = await accessToken();
    try {
      return await http(path, { ...opts, token });
    } catch (e) {
      if (e.status !== 401 || !session) throw e;
      await refresh();
      return http(path, { ...opts, token: session.access_token });
    }
  }

  /* ---------- REST (PostgREST) ---------- */
  const enc = encodeURIComponent;

  async function selectAll(table, query) {
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
      let rows;
      try {
        rows = await authed(`/rest/v1/${table}?${query}&limit=${PAGE}&offset=${offset}`);
      } catch (e) {
        if (e.status === 416) break; // além do fim
        throw e;
      }
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async function insert(table, rows) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await authed(`/rest/v1/${table}`, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: rows.slice(i, i + CHUNK),
      });
    }
  }

  async function upsert(table, rows, onConflict) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await authed(`/rest/v1/${table}?on_conflict=${enc(onConflict)}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: rows.slice(i, i + CHUNK),
      });
    }
  }

  const remove = (table, filter) => authed(`/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  const rpc = (fn, args) => authed(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });

  /* ---------- autenticação ---------- */
  const emailFor = (username) => `${String(username).trim().toLowerCase()}@${cfg.emailDomain}`;

  async function signIn(username, password) {
    const d = await http('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email: emailFor(username), password },
    });
    saveSession(fromToken(d));
  }

  async function signOut() {
    if (session) {
      try { await http('/auth/v1/logout?scope=local', { method: 'POST', token: session.access_token }); } catch (e) { /* sai mesmo assim */ }
    }
    saveSession(null);
  }

  async function changePassword(username, current, next) {
    await signIn(username, current); // confere a senha atual
    await authed('/auth/v1/user', { method: 'PUT', body: { password: next } });
  }

  const myProfile = async () => {
    const rows = await authed(`/rest/v1/profiles?id=eq.${enc(session.user_id)}&select=id,username,display_name,role,active`);
    return rows[0] || null;
  };

  /* ---------- administração (Edge Function) ---------- */
  const admin = (action, payload) =>
    authed('/functions/v1/admin-users', { method: 'POST', body: { action, ...payload } });

  App.api = {
    configured,
    ApiError,
    get hasSession() { return !!session; },
    get userId() { return session && session.user_id; },
    onExpire(fn) { expireHandlers.push(fn); },
    signIn, signOut, changePassword, myProfile, admin,
    selectAll, insert, upsert, remove, rpc, enc,
  };
})();
