/* Núcleo: utilidades de data/moeda, categorias e armazenamento local. */
(function () {
  'use strict';

  const App = (window.App = {});
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

  App.uid = () =>
    (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  /* ---------- armazenamento ---------- */
  const KEY = 'controle-financeiro:v1';
  const defaults = () => ({ transactions: [], budgets: {}, openingBalance: 0, theme: 'auto' });

  function cleanTx(t) {
    if (!t || typeof t !== 'object') return null;
    const value = Number(t.value);
    if (t.type !== 'in' && t.type !== 'out') return null;
    if (!Number.isFinite(value) || value <= 0) return null;
    if (typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return null;
    return {
      id: typeof t.id === 'string' && t.id ? t.id.slice(0, 64) : App.uid(),
      type: t.type,
      desc: String(t.desc || '').slice(0, 80),
      value: Math.round(value * 100) / 100,
      category: String(t.category || 'Outros').slice(0, 40),
      date: t.date,
      recurring: !!t.recurring,
    };
  }

  function sanitize(raw) {
    const s = defaults();
    if (!raw || typeof raw !== 'object') return s;
    if (Array.isArray(raw.transactions)) s.transactions = raw.transactions.map(cleanTx).filter(Boolean);
    if (raw.budgets && typeof raw.budgets === 'object') {
      for (const [k, v] of Object.entries(raw.budgets)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) s.budgets[String(k).slice(0, 40)] = n;
      }
    }
    const ob = Number(raw.openingBalance);
    s.openingBalance = Number.isFinite(ob) ? ob : 0;
    s.theme = ['auto', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'auto';
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return sanitize(JSON.parse(raw));
    } catch (e) { /* sem storage ou JSON quebrado: começa vazio */ }
    return defaults();
  }

  let state = load();
  const listeners = [];

  function commit(silent) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage indisponível */ }
    if (!silent) listeners.forEach((fn) => fn());
  }

  App.store = {
    get state() { return state; },
    onChange(fn) { listeners.push(fn); },
    add(tx) {
      const t = cleanTx({ ...tx, id: App.uid() });
      if (t) { state.transactions.push(t); commit(); }
      return t;
    },
    update(id, tx) {
      const i = state.transactions.findIndex((t) => t.id === id);
      const t = cleanTx({ ...tx, id });
      if (i >= 0 && t) { state.transactions[i] = t; commit(); }
    },
    remove(id) {
      const i = state.transactions.findIndex((t) => t.id === id);
      if (i < 0) return null;
      const [removed] = state.transactions.splice(i, 1);
      commit();
      return removed;
    },
    restore(tx) { state.transactions.push(tx); commit(); },
    setBudget(cat, value, silent) {
      if (value > 0) state.budgets[cat] = value; else delete state.budgets[cat];
      commit(silent);
    },
    setOpening(v) { state.openingBalance = Number.isFinite(v) ? v : 0; commit(true); },
    setTheme(t) { state.theme = t; commit(true); },
    /** Soma dados importados aos atuais, ignorando lançamentos idênticos. */
    merge(data) {
      const keyOf = (t) => [t.date, t.type, t.desc.trim().toLowerCase(), t.value, t.category, t.recurring].join('|');
      const seen = new Set(state.transactions.map(keyOf));
      let added = 0, duplicates = 0;
      for (const raw of data.transactions || []) {
        const t = cleanTx({ ...raw, id: App.uid() });
        if (!t) continue;
        const k = keyOf(t);
        if (seen.has(k)) { duplicates++; continue; }
        seen.add(k);
        state.transactions.push(t);
        added++;
      }
      for (const [cat, v] of Object.entries(data.budgets || {})) {
        if (Number.isFinite(v) && v > 0) state.budgets[String(cat).slice(0, 40)] = v;
      }
      if (Number.isFinite(data.openingBalance) && !state.openingBalance) state.openingBalance = data.openingBalance;
      commit();
      return { added, duplicates };
    },
    replace(raw) { state = sanitize(raw); commit(); },
    reset() { state = defaults(); commit(); },
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
