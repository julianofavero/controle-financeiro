/* Núcleo: utilidades de data/moeda, categorias e armazenamento (Supabase). */
(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const pad = (n) => String(n).padStart(2, '0');

  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  App.CATEGORIES = {
    in: ['Salário', 'Freelance', 'Investimentos', 'Vendas', 'Reembolso', 'Outros'],
    out: ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Compras', 'Impostos', 'Outros'],
  };

  /* ---------- datas (sempre strings AAAA-MM-DD / AAAA-MM, sem fuso) ---------- */
  App.todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  App.monthKey = (dateStr) => dateStr.slice(0, 7);
  App.addMonths = (key, n) => {
    const [y, m] = key.split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
  };
  App.monthRange = (from, to) => {
    const out = [];
    for (let k = from; k <= to; k = App.addMonths(k, 1)) out.push(k);
    return out;
  };
  App.daysInMonth = (key) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  };
  App.monthLabel = (key) => {
    const [y, m] = key.split('-').map(Number);
    return `${MESES[m - 1]}/${String(y).slice(2)}`;
  };
  App.monthLong = (key) => {
    const [y, m] = key.split('-').map(Number);
    return `${MESES_LONGO[m - 1]} de ${y}`;
  };
  App.fmtDate = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  App.fmtDay = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

  /* ---------- formatação ---------- */
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
  App.money = (v) => brl.format(Math.abs(v) < 0.005 ? 0 : v);
  App.moneyCompact = (v) => brlCompact.format(Math.abs(v) < 0.5 ? 0 : v);
  App.pct = (v, digits = 0) => `${(v * 100).toFixed(digits).replace('.', ',')}%`;

  App.esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** UUID v4 (o banco usa uuid como chave dos lançamentos). */
  App.uid = () => {
    const c = window.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    const b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  /* ---------- validação (espelha as restrições do banco) ---------- */
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MAX_MONEY = 1e11; // numeric(14,2) comporta bem mais; este é o teto das checagens

  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
    if (y < 1900 || y > 2200) return false;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  const money2 = (v) => Math.round(v * 100) / 100;

  function cleanTx(t) {
    if (!t || typeof t !== 'object') return null;
    const value = Number(t.value);
    if (t.type !== 'in' && t.type !== 'out') return null;
    if (!Number.isFinite(value) || value <= 0 || value > MAX_MONEY) return null;
    if (!validDate(t.date)) return null;
    return {
      id: typeof t.id === 'string' && UUID_RE.test(t.id) ? t.id.toLowerCase() : App.uid(),
      type: t.type,
      desc: String(t.desc || '').slice(0, 80),
      value: money2(value),
      category: String(t.category || 'Outros').slice(0, 40) || 'Outros',
      date: t.date,
      recurring: !!t.recurring,
    };
  }

  const defaults = () => ({ transactions: [], budgets: {}, openingBalance: 0, theme: 'auto' });

  function sanitize(raw) {
    const s = defaults();
    if (!raw || typeof raw !== 'object') return s;
    if (Array.isArray(raw.transactions)) s.transactions = raw.transactions.map(cleanTx).filter(Boolean);
    if (raw.budgets && typeof raw.budgets === 'object') {
      for (const [k, v] of Object.entries(raw.budgets)) {
        const n = Number(v);
        const cat = String(k).slice(0, 40);
        if (cat && Number.isFinite(n) && n > 0 && n <= MAX_MONEY) s.budgets[cat] = money2(n);
      }
    }
    const ob = Number(raw.openingBalance);
    s.openingBalance = Number.isFinite(ob) && Math.abs(ob) <= MAX_MONEY ? money2(ob) : 0;
    s.theme = ['auto', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'auto';
    return s;
  }

  /* ---------- tema (também guardado no navegador, para a tela de login) ---------- */
  const THEME_KEY = 'controle-financeiro:theme';
  App.localTheme = {
    get() { try { const t = localStorage.getItem(THEME_KEY); return ['auto', 'light', 'dark'].includes(t) ? t : 'auto'; } catch (e) { return 'auto'; } },
    set(t) { try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignora */ } },
  };

  /* ---------- dados antigos (de antes do login, ficavam só no navegador) ---------- */
  const LEGACY_KEY = 'controle-financeiro:v1';
  App.legacy = {
    read() {
      try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (!raw) return null;
        const s = sanitize(JSON.parse(raw));
        return s.transactions.length || Object.keys(s.budgets).length ? s : null;
      } catch (e) { return null; }
    },
    clear() { try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignora */ } },
  };

  /* ---------- conversão entre o app e as linhas do banco ---------- */
  const toRow = (t, uid) => ({
    id: t.id, user_id: uid, type: t.type, description: t.desc, amount: t.value,
    category: t.category, occurred_on: t.date, recurring: t.recurring,
  });
  const fromRow = (r) => ({
    id: r.id, type: r.type, desc: r.description, value: Number(r.amount),
    category: r.category, date: r.occurred_on, recurring: !!r.recurring,
  });
  const toPayload = (t) => ({
    id: t.id, type: t.type, description: t.desc, amount: t.value,
    category: t.category, occurred_on: t.date, recurring: t.recurring,
  });

  /* ---------- armazenamento ----------
   * A interface lê e altera `state` de forma síncrona (rápida). Cada alteração
   * é enviada ao Supabase numa fila, na ordem em que aconteceu. Se alguma
   * gravação falhar, o app avisa e relê tudo do servidor. */
  let state = defaults();
  let uid = null;
  const listeners = [];
  let errorHandler = () => {};
  let chain = Promise.resolve();
  let pending = 0;
  let reloading = false;

  const notify = () => listeners.forEach((fn) => fn());

  function remote(job) {
    pending++;
    chain = chain
      .then(job)
      .catch((err) => { try { errorHandler(err); } catch (e) { /* o contador abaixo precisa rodar */ } })
      .then(() => { pending--; });
    return chain;
  }

  async function fetchState() {
    const api = App.api;
    const [tx, bud, set] = await Promise.all([
      api.selectAll('transactions', 'select=id,type,description,amount,category,occurred_on,recurring&order=occurred_on.asc,id.asc'),
      api.selectAll('budgets', 'select=category,amount&order=category.asc'),
      api.selectAll('user_settings', 'select=opening_balance,theme'),
    ]);
    const budgets = {};
    bud.forEach((b) => { budgets[b.category] = b.amount; });
    return sanitize({
      transactions: tx.map(fromRow),
      budgets,
      openingBalance: set[0] ? set[0].opening_balance : 0,
      theme: set[0] ? set[0].theme : 'auto',
    });
  }

  function saveAll(s) {
    const budgets = {};
    Object.entries(s.budgets).forEach(([k, v]) => { budgets[k] = v; });
    return App.api.rpc('replace_my_data', {
      p_transactions: s.transactions.map(toPayload),
      p_budgets: budgets,
      p_opening: s.openingBalance,
      p_theme: s.theme,
    });
  }

  App.store = {
    get state() { return state; },
    get pending() { return pending; },
    onChange(fn) { listeners.push(fn); },
    onError(fn) { errorHandler = fn; },
    /** Espera todas as gravações pendentes terminarem. */
    flush() { return chain; },

    /** Carrega os dados da conta logada. */
    async load(userId) {
      uid = userId;
      state = await fetchState();
      App.localTheme.set(state.theme);
    },
    /** Relê do servidor depois das gravações pendentes (usado após falhas). */
    reload() {
      if (reloading) return chain;
      reloading = true;
      return remote(async () => {
        try { state = await fetchState(); notify(); } finally { reloading = false; }
      });
    },

    add(tx) {
      const t = cleanTx({ ...tx, id: App.uid() });
      if (t) {
        state.transactions.push(t);
        notify();
        remote(() => App.api.insert('transactions', [toRow(t, uid)]));
      }
      return t;
    },
    update(id, tx) {
      const i = state.transactions.findIndex((t) => t.id === id);
      const t = cleanTx({ ...tx, id });
      if (i >= 0 && t) {
        state.transactions[i] = t;
        notify();
        remote(() => App.api.upsert('transactions', [toRow(t, uid)], 'id'));
      }
    },
    remove(id) {
      const i = state.transactions.findIndex((t) => t.id === id);
      if (i < 0) return null;
      const [removed] = state.transactions.splice(i, 1);
      notify();
      remote(() => App.api.remove('transactions', `id=eq.${App.api.enc(id)}`));
      return removed;
    },
    restore(tx) {
      state.transactions.push(tx);
      notify();
      remote(() => App.api.insert('transactions', [toRow(tx, uid)]));
    },
    setBudget(cat, value, silent) {
      if (value > 0) state.budgets[cat] = Math.min(money2(value), MAX_MONEY); else delete state.budgets[cat];
      if (!silent) notify();
      const amount = state.budgets[cat];
      remote(() => (amount
        ? App.api.upsert('budgets', [{ user_id: uid, category: cat, amount }], 'user_id,category')
        : App.api.remove('budgets', `user_id=eq.${uid}&category=eq.${App.api.enc(cat)}`)));
    },
    setOpening(v) {
      state.openingBalance = Number.isFinite(v) && Math.abs(v) <= MAX_MONEY ? money2(v) : 0;
      const value = state.openingBalance;
      remote(() => App.api.upsert('user_settings', [{ user_id: uid, opening_balance: value }], 'user_id'));
    },
    setTheme(t) {
      state.theme = t;
      App.localTheme.set(t);
      remote(() => App.api.upsert('user_settings', [{ user_id: uid, theme: t }], 'user_id'));
    },
    /** Soma dados importados aos atuais, ignorando lançamentos idênticos. */
    merge(data) {
      const keyOf = (t) => [t.date, t.type, t.desc.trim().toLowerCase(), t.value, t.category, t.recurring].join('|');
      const seen = new Set(state.transactions.map(keyOf));
      const fresh = [];
      let duplicates = 0;
      for (const raw of data.transactions || []) {
        const t = cleanTx({ ...raw, id: App.uid() });
        if (!t) continue;
        const k = keyOf(t);
        if (seen.has(k)) { duplicates++; continue; }
        seen.add(k);
        state.transactions.push(t);
        fresh.push(t);
      }
      const budgetRows = [];
      for (const [cat, v] of Object.entries(data.budgets || {})) {
        const name = String(cat).slice(0, 40);
        if (name && Number.isFinite(v) && v > 0 && v <= MAX_MONEY) {
          state.budgets[name] = money2(v);
          budgetRows.push({ user_id: uid, category: name, amount: state.budgets[name] });
        }
      }
      let opening = null;
      if (Number.isFinite(data.openingBalance) && Math.abs(data.openingBalance) <= MAX_MONEY && !state.openingBalance) {
        state.openingBalance = money2(data.openingBalance);
        opening = state.openingBalance;
      }
      notify();
      remote(async () => {
        if (fresh.length) await App.api.insert('transactions', fresh.map((t) => toRow(t, uid)));
        if (budgetRows.length) await App.api.upsert('budgets', budgetRows, 'user_id,category');
        if (opening !== null) await App.api.upsert('user_settings', [{ user_id: uid, opening_balance: opening }], 'user_id');
      });
      return { added: fresh.length, duplicates };
    },
    /** Troca todos os dados da conta (gera ids novos: o banco exige ids únicos). */
    replace(raw) {
      const s = sanitize(raw);
      s.transactions.forEach((t) => { t.id = App.uid(); });
      state = s;
      App.localTheme.set(s.theme);
      notify();
      remote(() => saveAll(s));
    },
    reset() {
      state = { ...defaults(), theme: state.theme };
      const s = state;
      notify();
      remote(() => saveAll(s));
    },
    exportJSON() { return JSON.stringify(state, null, 2); },
  };

  /* ---------- dados de exemplo (determinísticos) ---------- */
  App.sampleData = function () {
    const cur = App.monthKey(App.todayStr());
    let seed = 20260;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const vary = (base, pctv) => Math.round(base * (1 + (rnd() - 0.5) * 2 * pctv));
    const tx = [];
    const add = (type, desc, value, date, category, recurring) =>
      tx.push({ id: App.uid(), type, desc, value, date, category, recurring: !!recurring });

    const start = App.addMonths(cur, -5);
    add('in', 'Salário', 5200, `${start}-05`, 'Salário', true);
    add('out', 'Aluguel', 1800, `${start}-10`, 'Moradia', true);
    add('out', 'Internet e celular', 160, `${start}-12`, 'Moradia', true);
    add('out', 'Streaming e apps', 75, `${start}-15`, 'Assinaturas', true);
    add('out', 'Plano de saúde', 320, `${start}-08`, 'Saúde', true);

    App.monthRange(start, cur).forEach((m, i) => {
      const isCur = m === cur;
      const lastDay = isCur ? Math.max(1, Number(App.todayStr().slice(8, 10))) : 28;
      const day = (d) => `${m}-${pad(Math.min(d, lastDay))}`;
      add('out', 'Mercado', vary(520 + i * 40, 0.1), day(4), 'Alimentação');
      add('out', 'Mercado', vary(480 + i * 40, 0.1), day(18), 'Alimentação');
      add('out', 'Restaurantes e delivery', vary(260 + i * 55, 0.12), day(14), 'Alimentação');
      add('out', 'Combustível e transporte', vary(300, 0.15), day(9), 'Transporte');
      add('out', 'Cinema, bares e passeios', vary(200 + i * 70, 0.12), day(22), 'Lazer');
      add('out', 'Compras online', vary(150 + i * 80, 0.2), day(20), 'Compras');
      if (i % 2 === 0) add('in', 'Projeto freelance', vary(1100, 0.2), day(25), 'Freelance');
    });

    return { transactions: tx, budgets: { 'Alimentação': 1500, 'Lazer': 500, 'Compras': 400 }, openingBalance: 2400, theme: state.theme };
  };
})();
