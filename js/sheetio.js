/* Planilha ⇄ dados do app: exportar, baixar modelo e ler lançamentos de um .xlsx. */
(function () {
  'use strict';
  const A = window.App;

  const HEAD = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Valor', 'Mensal'];
  const norm = (v) =>
    String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

  const txRow = (t) => [
    { v: t.date, t: 'd' },
    t.type === 'in' ? 'Entrada' : 'Saída',
    t.desc,
    t.category,
    { v: t.value, t: 'm' },
    t.recurring ? 'Sim' : 'Não',
  ];
  const head = (cols) => cols.map((v) => ({ v, t: 'h' }));

  /* ---------- exportar ---------- */
  function exportBlob(state) {
    const txs = state.transactions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // resumo mensal: todos os meses reais + 6 projetados
    const an = A.analyze(state, 6);
    let earliest = an.cur;
    txs.forEach((t) => { if (t.date.slice(0, 7) < earliest) earliest = t.date.slice(0, 7); });
    let bal = state.openingBalance;
    const summary = [head(['Mês', 'Situação', 'Entradas', 'Saídas', 'Resultado', 'Saldo no fim do mês'])];
    const fmtMonth = (k) => `${k.slice(5)}/${k.slice(0, 4)}`;
    for (const key of A.monthRange(earliest, an.cur)) {
      const s = A.summarize(A.entriesForMonth(state.transactions, key));
      bal += s.in - s.out;
      summary.push([fmtMonth(key), 'Real', { v: s.in, t: 'm' }, { v: s.out, t: 'm' }, { v: s.in - s.out, t: 'm' }, { v: bal, t: 'm' }]);
    }
    for (const m of an.future) {
      summary.push([fmtMonth(m.key), 'Projeção', { v: m.in, t: 'm' }, { v: m.out, t: 'm' }, { v: m.net, t: 'm' }, { v: m.balance, t: 'm' }]);
    }

    const budgets = [head(['Categoria', 'Limite mensal'])].concat(
      A.CATEGORIES.out.map((c) => [c, state.budgets[c] ? { v: state.budgets[c], t: 'm' } : null]),
    );
    Object.keys(state.budgets).filter((c) => !A.CATEGORIES.out.includes(c)).forEach((c) => budgets.push([c, { v: state.budgets[c], t: 'm' }]));

    return A.xlsx.build([
      { name: 'Lançamentos', rows: [head(HEAD)].concat(txs.map(txRow)), widths: [13, 10, 36, 18, 16, 9], filter: true },
      { name: 'Resumo mensal', rows: summary, widths: [11, 11, 16, 16, 16, 20] },
      { name: 'Orçamentos', rows: budgets, widths: [20, 16] },
      { name: 'Configurações', rows: [head(['Item', 'Valor']), ['Saldo inicial', { v: state.openingBalance || 0, t: 'm' }]], widths: [20, 16] },
    ]);
  }

  /* ---------- modelo para preencher ---------- */
  function templateBlob() {
    const m = A.monthKey(A.todayStr());
    const ex = [
      { date: `${m}-05`, type: 'in', desc: 'Salário', category: 'Salário', value: 5000, recurring: true },
      { date: `${m}-10`, type: 'out', desc: 'Aluguel', category: 'Moradia', value: 1500, recurring: true },
      { date: `${m}-12`, type: 'out', desc: 'Mercado', category: 'Alimentação', value: 480.9, recurring: false },
    ];
    const help = [
      ['Como preencher'],
      ['Preencha a aba "Lançamentos", uma linha por lançamento, e importe o arquivo em Ajustes ou em Lançamentos.'],
      [''],
      ['Data: dia do lançamento (ex.: 10/11/2026 ou 2026-11-10).'],
      ['Tipo: Entrada ou Saída.'],
      ['Descrição: texto livre, até 80 caracteres.'],
      ['Categoria: ' + A.CATEGORIES.in.join(', ') + ' (entradas); ' + A.CATEGORIES.out.join(', ') + ' (saídas). Outros nomes também são aceitos.'],
      ['Valor: número positivo (ex.: 1234,56).'],
      ['Mensal: Sim para lançamentos que se repetem todo mês (salário, aluguel, assinaturas); Não para os demais.'],
      [''],
      ['Opcional: a aba "Orçamentos" define limites por categoria e a aba "Configurações" o saldo inicial.'],
    ];
    return A.xlsx.build([
      { name: 'Lançamentos', rows: [head(HEAD)].concat(ex.map(txRow)), widths: [13, 10, 36, 18, 16, 9], filter: true },
      { name: 'Orçamentos', rows: [head(['Categoria', 'Limite mensal']), ['Alimentação', { v: 1200, t: 'm' }]], widths: [20, 16] },
      { name: 'Configurações', rows: [head(['Item', 'Valor']), ['Saldo inicial', { v: 0, t: 'm' }]], widths: [20, 16] },
      { name: 'Como usar', rows: help, widths: [120], noFreeze: true },
    ]);
  }

  /* ---------- ler ---------- */
  function parseDate(v) {
    let y, m, d;
    if (typeof v === 'number' && v >= 1 && v < 80000) v = A.isoFromSerial(v);
    if (typeof v !== 'string') return null;
    const s = v.trim();
    let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else if ((r = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s))) {
      d = +r[1]; m = +r[2]; y = +r[3]; if (y < 100) y += 2000;
    } else return null;
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d || y < 1990 || y > 2100) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function parseMoney(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    let s = v.replace(/R\$|\s/g, '');
    if (!s) return null;
    const neg = /^-|^\(.*\)$/.test(s);
    s = s.replace(/[()\-]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const n = parseFloat(s);
    return neg ? -n : n;
  }

  function parseType(v, value) {
    const s = norm(v);
    if (/^(ent|rec|in|cred|\+)/.test(s)) return 'in';
    if (/^(sai|des|out|gast|deb|-)/.test(s)) return 'out';
    if (!s && typeof value === 'number' && value < 0) return 'out';
    return null;
  }

  const truthy = (v) => v === true || /^(sim|s|true|1|x|yes|y|mensal|recorrente)$/.test(norm(v));

  const ALIASES = {
    date: ['data', 'date', 'dia'],
    type: ['tipo', 'type', 'natureza'],
    desc: ['descricao', 'description', 'historico', 'titulo', 'nome'],
    category: ['categoria', 'category'],
    value: ['valor', 'value', 'quantia', 'montante'],
    recurring: ['mensal', 'recorrente', 'recorrencia', 'repete'],
  };

  async function parse(buffer) {
    const sheets = await A.xlsx.read(buffer);
    const find = (prefix) => sheets.find((s) => norm(s.name).startsWith(prefix));
    const main = find('lancamentos') || sheets[0];

    // localiza a linha de cabeçalho nas primeiras 10 linhas
    let hi = -1, cols = {};
    for (let r = 0; r < Math.min(10, main.rows.length); r++) {
      const names = main.rows[r].map(norm);
      const found = {};
      for (const [k, list] of Object.entries(ALIASES)) {
        const i = names.findIndex((n) => list.includes(n));
        if (i >= 0) found[k] = i;
      }
      if (found.date !== undefined && found.value !== undefined) { hi = r; cols = found; break; }
    }
    if (hi < 0) throw new Error('Não achei as colunas "Data" e "Valor" na aba de lançamentos. Baixe o modelo para ver o formato.');

    const transactions = [];
    const skipped = [];
    for (let r = hi + 1; r < main.rows.length; r++) {
      const row = main.rows[r];
      if (!row || row.every((c) => c === null || c === undefined || c === '')) continue;
      const rowNo = r + 1;
      const date = parseDate(row[cols.date]);
      if (!date) { skipped.push({ row: rowNo, reason: 'data inválida' }); continue; }
      let value = parseMoney(row[cols.value]);
      if (value === null || value === 0) { skipped.push({ row: rowNo, reason: 'valor inválido' }); continue; }
      const type = cols.type !== undefined ? parseType(row[cols.type], value) : value < 0 ? 'out' : 'in';
      if (!type) { skipped.push({ row: rowNo, reason: 'tipo deve ser Entrada ou Saída' }); continue; }
      value = Math.abs(value);
      transactions.push({
        type,
        date,
        value: Math.round(value * 100) / 100,
        desc: String(row[cols.desc] ?? '').trim().slice(0, 80),
        category: String(row[cols.category] ?? '').trim().slice(0, 40) || 'Outros',
        recurring: cols.recurring !== undefined ? truthy(row[cols.recurring]) : false,
      });
      if (transactions.length >= 20000) break;
    }

    const budgets = {};
    const bs = find('orcamento');
    if (bs) {
      for (const row of bs.rows) {
        const name = String(row[0] ?? '').trim();
        const v = parseMoney(row[1]);
        if (name && v !== null && v > 0 && norm(name) !== 'categoria') budgets[name.slice(0, 40)] = v;
      }
    }
    let opening = null;
    const cs = find('configura');
    if (cs) {
      const row = cs.rows.find((r) => norm(r[0]).includes('saldo'));
      if (row) { const v = parseMoney(row[1]); if (v !== null) opening = v; }
    }

    return { transactions, skipped, budgets, opening, sheetName: main.name };
  }

  A.sheetio = { exportBlob, templateBlob, parse };
})();
