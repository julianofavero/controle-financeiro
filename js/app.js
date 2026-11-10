/* Interface: navegação, dashboard, lançamentos, orçamentos, ajustes. */
(function () {
  'use strict';
  const A = window.App;
  const S = A.store;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const VIEWS = {
    dashboard: 'Dashboard',
    lancamentos: 'Lançamentos',
    orcamentos: 'Orçamentos',
    ajustes: 'Ajustes',
  };
  let view = 'dashboard';
  const filters = { month: 'cur', type: '', query: '' };

  /* ================= utilidades de UI ================= */
  let toastTimer;
  function toast(msg, actionLabel, onAction) {
    const t = $('#toast');
    t.innerHTML = `<span>${A.esc(msg)}</span>`;
    if (actionLabel) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = actionLabel;
      b.addEventListener('click', () => { onAction(); t.hidden = true; });
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, actionLabel ? 7000 : 3500);
  }

  function download(name, text, type) {
    const blob = text instanceof Blob ? text : new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const ICONS = {
    critical: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--st-crit)"/><path d="M12 7v6M12 16.5v.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
    warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z" fill="var(--st-warn)" stroke="var(--st-warn)" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5M12 17.5v.5" stroke="#0b0b0b" stroke-width="2.2" stroke-linecap="round"/></svg>',
    good: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--st-good)"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="var(--ink2)" stroke-width="2"/><path d="M12 11v6M12 7.5v.5" stroke="var(--ink2)" stroke-width="2.2" stroke-linecap="round"/></svg>',
  };
  const TAGS = { critical: 'Crítico', warning: 'Atenção', good: 'Positivo', info: 'Info' };

  /* ================= navegação ================= */
  function currentFromHash() {
    const h = location.hash.replace('#', '');
    return Object.prototype.hasOwnProperty.call(VIEWS, h) ? h : 'dashboard';
  }

  function render() {
    view = currentFromHash();
    $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + view; });
    $$('.nav a').forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('#page-title').textContent = VIEWS[view];
    document.title = `${VIEWS[view]} · Controle Financeiro`;
    A.charts.hideTip();

    const subs = {
      dashboard: (() => { const t = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); })(),
      lancamentos: 'Todas as entradas e saídas registradas',
      orcamentos: 'Controle quanto gastar em cada categoria',
      ajustes: 'Saldo inicial, backup e dados',
    };
    $('#page-sub').textContent = subs[view];

    if (view === 'dashboard') renderDashboard();
    if (view === 'lancamentos') renderTransactions();
    if (view === 'orcamentos') renderBudgets();
    if (view === 'ajustes') renderSettings();
  }

  /* ================= dashboard ================= */
  function deltaHtml(cur, prev, label, higherIsBad) {
    if (!prev || prev <= 0) return '';
    const g = cur / prev - 1;
    if (Math.abs(g) < 0.005) return `<span class="sub">igual a ${label}</span>`;
    const up = g > 0;
    const bad = higherIsBad ? up : !up;
    return `<span class="delta ${bad ? 'bad' : 'good'}">${up ? '▲' : '▼'} ${A.pct(Math.abs(g))} ${up ? 'acima' : 'abaixo'}</span> <span class="sub">de ${label}</span>`;
  }

  function tile(label, value, sub, dot) {
    return `<div class="kpi"><div class="label">${dot ? `<span class="dot ${dot}"></span>` : ''}${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  }

  function tableHtml(months) {
    return `<table class="data"><thead><tr><th>Mês</th><th>Entradas</th><th>Saídas</th><th>Resultado</th><th>Saldo no fim</th></tr></thead><tbody>${months.map((m) =>
      `<tr><td>${A.monthLabel(m.key)}${m.proj ? '<span class="badge">projeção</span>' : m.current ? '<span class="badge">em andamento</span>' : ''}</td>
      <td>${A.money(m.in)}</td><td>${A.money(m.out)}</td><td>${A.money(m.net)}</td><td>${A.money(m.balance)}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderDashboard() {
    const st = S.state;
    const empty = st.transactions.length === 0;
    $('#dash-empty').hidden = !empty;
    $('#dash-content').hidden = empty;
    if (empty) return;

    const an = A.analyze(st, 6);
    const cur = an.hist[an.hist.length - 1];
    const prev = an.hist.length > 1 ? an.hist[an.hist.length - 2] : null;
    const f3 = an.future[2], f6 = an.future[5];

    const rate = cur.in > 0 ? (cur.in - cur.out) / cur.in : null;
    $('#kpis').innerHTML =
      tile('Saldo hoje', A.money(an.nowBalance), `Previsto em 3 meses: <b>${A.money(f3.balance)}</b>`) +
      tile('Entradas do mês', A.money(cur.in), prev ? deltaHtml(cur.in, prev.in, A.monthLabel(prev.key), false) : 'Primeiro mês lançado', 'dot-in') +
      tile('Saídas do mês', A.money(cur.out), prev ? deltaHtml(cur.out, prev.out, A.monthLabel(prev.key), true) : 'Primeiro mês lançado', 'dot-out') +
      tile('Resultado do mês', A.money(cur.in - cur.out), rate === null ? 'Sem entradas no mês' : `${rate >= 0 ? 'Guardando' : 'Faltando'} ${A.pct(Math.abs(rate))} das entradas`);

    // gráficos
    const draw = () => {
      A.charts.flow($('#chart-flow'), an.months);
      A.charts.balance($('#chart-balance'), an.months);
    };
    draw();
    const tbl = tableHtml(an.months);
    $$('#card-flow .table-box, #card-balance .table-box').forEach((b) => { b.innerHTML = tbl; });

    // categorias do mês
    $('#cats-sub').textContent = `${A.monthLong(an.cur)} (até agora)`;
    const catRows = Object.entries(cur.byCat)
      .map(([name, value]) => ({ name, value, budget: st.budgets[name] || 0 }))
      .sort((a, b) => b.value - a.value);
    let shown = catRows;
    if (catRows.length > 8) {
      const rest = catRows.slice(7);
      shown = catRows.slice(0, 7).concat({ name: 'Demais', value: rest.reduce((s, r) => s + r.value, 0), budget: 0 });
    }
    A.charts.categories($('#chart-cats'), shown);

    // avisos
    $('#alerts').innerHTML = A.buildAlerts(st, an).map((a) =>
      `<li class="alert ${a.level}">${ICONS[a.level]}<div><div class="tag">${TAGS[a.level]}</div><div class="title">${A.esc(a.title)}</div><div class="text">${A.esc(a.text)}</div></div></li>`).join('');

    // tendências
    const avg = (k) => an.future.reduce((s, m) => s + m[k], 0) / an.future.length;
    const histAvg = (k) => {
      const c = an.hist.filter((m) => !m.current);
      return c.length ? c.reduce((s, m) => s + m[k], 0) / c.length : 0;
    };
    const rel = (now, before) => (before > 0 ? `${now >= before ? '▲' : '▼'} ${A.pct(Math.abs(now / before - 1))} vs média dos meses completos` : 'Sem meses completos para comparar');
    $('#trends').innerHTML =
      tile(`Saldo em ${f3.label}`, A.money(f3.balance), `Faixa provável: ${A.moneyCompact(f3.lo)} a ${A.moneyCompact(f3.hi)}`) +
      tile(`Saldo em ${f6.label}`, A.money(f6.balance), `Faixa provável: ${A.moneyCompact(f6.lo)} a ${A.moneyCompact(f6.hi)}`) +
      tile('Entradas médias previstas', A.money(avg('in')), rel(avg('in'), histAvg('in')), 'dot-in') +
      tile('Saídas médias previstas', A.money(avg('out')), rel(avg('out'), histAvg('out')), 'dot-out');
    $('#forecast-note').textContent =
      `Confiança da previsão: ${an.confidence} (${an.basis} ${an.basis === 1 ? 'mês completo' : 'meses completos'} de histórico). ` +
      'Lançamentos mensais entram exatamente; o restante segue a média e a tendência recente, limitada a ±10% por mês. É uma estimativa, não uma garantia.';
  }

  /* alternar gráfico/tabela */
  $$('.toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.card');
      const showTable = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(showTable));
      btn.textContent = showTable ? 'Ver gráfico' : 'Ver tabela';
      $('.chart-box', card).hidden = showTable;
      $('.table-box', card).hidden = !showTable;
      $('.legend', card).hidden = showTable;
      if (!showTable && view === 'dashboard') renderDashboard();
    });
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (view === 'dashboard' && !$('#dash-content').hidden) renderDashboard(); }, 150);
  });

  /* ================= lançamentos ================= */
  function renderTransactions() {
    const st = S.state;
    const cur = A.monthKey(A.todayStr());
    let earliest = cur;
    st.transactions.forEach((t) => { if (t.date.slice(0, 7) < earliest) earliest = t.date.slice(0, 7); });
    const keys = A.monthRange(earliest, A.addMonths(cur, 6)).reverse();
    const sel = $('#f-month');
    const want = filters.month === 'cur' ? cur : filters.month;
    sel.innerHTML = keys.map((k) => `<option value="${k}">${A.monthLong(k)}${k === cur ? ' (atual)' : ''}</option>`).join('') + '<option value="all">Todos (cada lançamento uma vez)</option>';
    sel.value = keys.includes(want) || want === 'all' ? want : cur;
    $('#f-type').value = filters.type;
    $('#f-query').value = filters.query;

    const all = sel.value === 'all';
    let list = all
      ? st.transactions.map((t) => ({ ...t, txId: t.id }))
      : A.entriesForMonth(st.transactions, sel.value);
    if (filters.type) list = list.filter((t) => t.type === filters.type);
    const q = filters.query.trim().toLowerCase();
    if (q) list = list.filter((t) => (t.desc + ' ' + t.category).toLowerCase().includes(q));
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const sumIn = list.filter((t) => t.type === 'in').reduce((s, t) => s + t.value, 0);
    const sumOut = list.filter((t) => t.type === 'out').reduce((s, t) => s + t.value, 0);
    $('#tx-sums').innerHTML = all
      ? `<div>Lançamentos<strong>${list.length}</strong></div>`
      : `<div>Entradas<strong>${A.money(sumIn)}</strong></div><div>Saídas<strong>${A.money(sumOut)}</strong></div><div>Resultado<strong>${A.money(sumIn - sumOut)}</strong></div>`;

    const pencil = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
    const trash = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>';
    $('#tx-list').innerHTML = list.length
      ? list.map((t) => `<li class="tx" data-id="${A.esc(t.txId)}">
          <div class="tx-date">${all ? A.fmtDate(t.date).slice(0, 5) + '<br>' + t.date.slice(0, 4) : A.fmtDay(t.date)}</div>
          <div class="tx-main"><strong>${A.esc(t.desc || '(sem descrição)')}</strong><span>${A.esc(t.category)}${t.recurring ? ' <span class="badge">mensal</span>' : ''}</span></div>
          <div class="tx-val"><span class="dot ${t.type === 'in' ? 'dot-in' : 'dot-out'}"></span>${t.type === 'in' ? '+' : '−'} ${A.money(t.value)}</div>
          <div class="tx-actions">
            <button type="button" class="icon-btn" data-act="edit" aria-label="Editar ${A.esc(t.desc)}" title="Editar">${pencil}</button>
            <button type="button" class="icon-btn" data-act="del" aria-label="Apagar ${A.esc(t.desc)}" title="Apagar">${trash}</button>
          </div></li>`).join('')
      : '<li class="empty-list">Nenhum lançamento aqui. Use os botões Entrada e Saída no topo.</li>';
  }

  $('#f-month').addEventListener('change', (e) => { filters.month = e.target.value; renderTransactions(); });
  $('#f-type').addEventListener('change', (e) => { filters.type = e.target.value; renderTransactions(); });
  $('#f-query').addEventListener('input', (e) => { filters.query = e.target.value; renderTransactions(); });

  $('#tx-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.tx').dataset.id;
    const tx = S.state.transactions.find((t) => t.id === id);
    if (!tx) return;
    if (btn.dataset.act === 'edit') return openForm(tx.type, tx);
    const msg = tx.recurring ? 'Lançamento removido (inclui todas as repetições mensais)' : 'Lançamento removido';
    const removed = S.remove(id);
    if (removed) toast(msg, 'Desfazer', () => S.restore(removed));
  });

  /* ================= formulário ================= */
  const dlg = $('#tx-dialog');
  const form = $('#tx-form');
  let editingId = null;

  function fillCategories(type, selected) {
    const sel = form.elements.category;
    sel.innerHTML = A.CATEGORIES[type].map((c) => `<option>${A.esc(c)}</option>`).join('');
    if (selected && !A.CATEGORIES[type].includes(selected)) sel.insertAdjacentHTML('beforeend', `<option>${A.esc(selected)}</option>`);
    sel.value = selected || A.CATEGORIES[type][0];
  }

  function openForm(type, tx) {
    editingId = tx ? tx.id : null;
    form.reset();
    $('#tx-error').hidden = true;
    $('#tx-title').textContent = tx ? 'Editar lançamento' : 'Novo lançamento';
    form.elements.type.value = type;
    fillCategories(type, tx && tx.category);
    form.elements.date.value = tx ? tx.date : A.todayStr();
    if (tx) {
      form.elements.desc.value = tx.desc;
      form.elements.value.value = tx.value;
      form.elements.recurring.checked = tx.recurring;
    }
    dlg.showModal();
    form.elements.desc.focus();
  }

  $$('[data-new]').forEach((b) => b.addEventListener('click', () => openForm(b.dataset.new)));
  $$('input[name="type"]', form).forEach((r) => r.addEventListener('change', () => fillCategories(r.value)));
  $('#tx-cancel').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    const value = Number(f.value.value);
    const err = $('#tx-error');
    if (!f.desc.value.trim()) { err.textContent = 'Informe uma descrição.'; err.hidden = false; return; }
    if (!Number.isFinite(value) || value <= 0) { err.textContent = 'Informe um valor maior que zero.'; err.hidden = false; return; }
    if (!f.date.value) { err.textContent = 'Informe a data.'; err.hidden = false; return; }
    const tx = {
      type: f.type.value,
      desc: f.desc.value.trim(),
      value,
      date: f.date.value,
      category: f.category.value,
      recurring: f.recurring.checked,
    };
    if (editingId) S.update(editingId, tx); else S.add(tx);
    dlg.close();
    toast(editingId ? 'Lançamento atualizado' : tx.type === 'in' ? 'Entrada registrada' : 'Saída registrada');
  });

  /* ================= orçamentos ================= */
  function budgetProgress(used, limit) {
    if (!limit) return '<div class="info"><span>Sem limite definido</span><span>' + A.money(used) + ' gastos</span></div>';
    const r = used / limit;
    const status = r >= 1 ? '<span class="status over">▲ Estourado</span>' : r >= 0.8 ? '<span class="status over">▲ Perto do limite</span>' : '<span class="status">Dentro do limite</span>';
    return `<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(r * 100))}"><div class="fill" style="width:${Math.min(100, r * 100)}%"></div></div>
      <div class="info"><span>${A.money(used)} de ${A.money(limit)} (${A.pct(r)})</span>${status}</div>`;
  }

  function renderBudgets() {
    const st = S.state;
    const cur = A.monthKey(A.todayStr());
    const sum = A.summarize(A.entriesForMonth(st.transactions, cur));
    $('#bud-sub').textContent = `${A.monthLong(cur)}. Defina quanto pretende gastar; você recebe aviso ao passar de 80%.`;
    $('#budgets').innerHTML = A.CATEGORIES.out.map((c) => `<li class="bud" data-cat="${A.esc(c)}">
      <span class="name">${A.esc(c)}</span>
      <label><input type="number" min="0" step="10" inputmode="decimal" placeholder="Sem limite" aria-label="Limite mensal de ${A.esc(c)}" value="${st.budgets[c] || ''}"></label>
      <div class="prog">${budgetProgress(sum.byCat[c] || 0, st.budgets[c])}</div></li>`).join('');
  }

  $('#budgets').addEventListener('change', (e) => {
    const li = e.target.closest('.bud');
    if (!li) return;
    const cat = li.dataset.cat;
    const v = Number(e.target.value);
    S.setBudget(cat, Number.isFinite(v) && v > 0 ? v : 0, true);
    const cur = A.monthKey(A.todayStr());
    const used = A.summarize(A.entriesForMonth(S.state.transactions, cur)).byCat[cat] || 0;
    $('.prog', li).innerHTML = budgetProgress(used, S.state.budgets[cat]);
  });

  /* ================= ajustes ================= */
  function renderSettings() {
    $('#opening').value = S.state.openingBalance || '';
  }

  $('#opening').addEventListener('change', (e) => { S.setOpening(Number(e.target.value) || 0); toast('Saldo inicial salvo'); });

  $('#btn-export-json').addEventListener('click', () => download(`controle-financeiro-${A.todayStr()}.json`, S.exportJSON(), 'application/json'));

  $('#btn-export-csv').addEventListener('click', () => {
    const safe = (v) => {
      let s = String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas em planilhas
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = S.state.transactions.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const lines = ['Data;Tipo;Descrição;Categoria;Valor;Mensal'].concat(rows.map((t) =>
      [t.date, t.type === 'in' ? 'Entrada' : 'Saída', safe(t.desc), safe(t.category), String(t.value).replace('.', ','), t.recurring ? 'Sim' : 'Não'].join(';')));
    download(`lancamentos-${A.todayStr()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  });

  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.transactions)) throw new Error('formato');
      if (!confirm('Restaurar este backup substitui todos os dados atuais. Continuar?')) return;
      S.replace(data);
      toast(`Backup restaurado: ${S.state.transactions.length} lançamentos`);
    } catch (err) {
      toast('Arquivo inválido: use um backup JSON baixado por este site');
    }
  });

  /* ================= planilha XLSX ================= */
  const impDlg = $('#import-dialog');
  let pendingImport = null;

  $$('[data-xlsx]').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.xlsx;
    if (act === 'import') return $('#file-xlsx').click();
    if (act === 'template') return download('modelo-controle-financeiro.xlsx', A.sheetio.templateBlob());
    if (!S.state.transactions.length) { toast('Ainda não há lançamentos para exportar. Baixe o modelo para preencher.'); return; }
    download(`controle-financeiro-${A.todayStr()}.xlsx`, A.sheetio.exportBlob(S.state));
    toast('Planilha gerada');
  }));

  $('#file-xlsx').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('Arquivo grande demais (máximo 10 MB)'); return; }
    try {
      const res = await A.sheetio.parse(await file.arrayBuffer());
      if (!res.transactions.length) {
        const why = res.skipped.length ? ` ${res.skipped.length} linhas foram ignoradas (ex.: linha ${res.skipped[0].row}: ${res.skipped[0].reason}).` : '';
        toast('Nenhum lançamento válido encontrado.' + why);
        return;
      }
      pendingImport = res;
      const nIn = res.transactions.filter((t) => t.type === 'in').length;
      const nOut = res.transactions.length - nIn;
      $('#imp-summary').textContent =
        `${file.name}: ${res.transactions.length} lançamentos válidos (${nIn} entradas, ${nOut} saídas)` +
        (Object.keys(res.budgets).length ? `, ${Object.keys(res.budgets).length} limites de orçamento` : '') +
        (res.skipped.length ? `. ${res.skipped.length} linhas serão ignoradas.` : '.');
      $('#imp-skipped').innerHTML = res.skipped.slice(0, 5).map((s) => `<li>Linha ${s.row}: ${A.esc(s.reason)}</li>`).join('') +
        (res.skipped.length > 5 ? `<li>e mais ${res.skipped.length - 5}…</li>` : '');
      $('#import-form').elements.mode.value = S.state.transactions.length ? 'merge' : 'replace';
      impDlg.showModal();
    } catch (err) {
      toast(err && err.message ? err.message : 'Não consegui ler essa planilha.');
    }
  });

  $('#imp-cancel').addEventListener('click', () => { pendingImport = null; impDlg.close(); });
  $('#import-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!pendingImport) return impDlg.close();
    const mode = $('#import-form').elements.mode.value;
    const data = pendingImport;
    pendingImport = null;
    impDlg.close();
    if (mode === 'replace') {
      S.replace({ transactions: data.transactions, budgets: data.budgets, openingBalance: data.opening || 0, theme: S.state.theme });
      toast(`Planilha importada: ${S.state.transactions.length} lançamentos`);
    } else {
      const r = S.merge({ transactions: data.transactions, budgets: data.budgets, openingBalance: data.opening });
      toast(`${r.added} lançamentos adicionados` + (r.duplicates ? `, ${r.duplicates} repetidos ignorados` : ''));
    }
  });

  function loadSample() {
    if (S.state.transactions.length && !confirm('Os dados de exemplo substituem os dados atuais. Continuar?')) return;
    S.replace(A.sampleData());
    location.hash = '#dashboard';
    render();
    toast('Dados de exemplo carregados');
  }
  $('#btn-sample').addEventListener('click', loadSample);
  $('#btn-sample-2').addEventListener('click', loadSample);

  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Apagar TODOS os lançamentos, limites e o saldo inicial? Isso não pode ser desfeito. Faça um backup antes se precisar.')) return;
    S.reset();
    toast('Todos os dados foram apagados');
  });

  /* ================= tema ================= */
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_NAMES = { auto: 'auto', light: 'claro', dark: 'escuro' };
  function applyTheme() {
    const t = S.state.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    $('#theme-label').textContent = 'Tema: ' + THEME_NAMES[t];
  }
  $('#theme-btn').addEventListener('click', () => {
    S.setTheme(THEMES[(THEMES.indexOf(S.state.theme) + 1) % THEMES.length]);
    applyTheme();
  });

  /* ================= início ================= */
  S.onChange(render);
  window.addEventListener('hashchange', render);
  applyTheme();
  render();
})();
