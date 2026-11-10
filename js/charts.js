/* Gráficos em SVG/HTML puro, sem bibliotecas. Cores vêm de variáveis CSS (tema claro/escuro). */
(function () {
  'use strict';
  const A = window.App;
  const charts = (A.charts = {});
  let uid = 0;

  /* ---------- tooltip compartilhado ---------- */
  function showTip(html, x, y) {
    const t = document.getElementById('tooltip');
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = Math.max(8, top) + 'px';
  }
  const hideTip = () => { document.getElementById('tooltip').hidden = true; };

  function bindHover(root, htmlFor) {
    root.querySelectorAll('[data-i]').forEach((el) => {
      const show = (e) => showTip(htmlFor(Number(el.dataset.i)), e.clientX, e.clientY);
      el.addEventListener('pointerenter', show);
      el.addEventListener('pointermove', show);
      el.addEventListener('pointerleave', hideTip);
      el.addEventListener('pointercancel', hideTip);
    });
  }
  charts.hideTip = hideTip;

  /* ---------- escala ---------- */
  function niceScale(min, max, n, includeZero) {
    if (includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
    if (max === min) max = min + 1;
    const raw = (max - min) / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let i = 0, c = Math.round((hi - lo) / step); i <= c; i++) ticks.push(lo + i * step);
    return { min: lo, max: hi, ticks };
  }

  const barPath = (x, y, w, h, r) => {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  };

  function frame(W, H, m, sc, n, rows, opts = {}) {
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const y = (v) => m.t + ih - ((v - sc.min) / (sc.max - sc.min)) * ih;
    const gw = iw / n;
    const stride = gw < 44 ? 2 : 1;
    let s = '';
    sc.ticks.forEach((v) => {
      const yy = y(v).toFixed(1);
      const zero = v === 0 && sc.min < 0;
      s += `<line class="${zero ? 'sv-axis' : 'sv-grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      s += `<text class="sv-tick" x="${m.l - 8}" y="${(+yy + 4)}" text-anchor="end">${A.moneyCompact(v).replace(/\s/g, ' ')}</text>`;
    });
    if (!opts.noBase && sc.min >= 0) s += `<line class="sv-axis" x1="${m.l}" x2="${W - m.r}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`;
    const anchor = Math.max(0, rows.findIndex((r) => r.current));
    rows.forEach((r, i) => {
      if ((i - anchor) % stride === 0) {
        s += `<text class="sv-tick${r.current ? ' cur' : ''}" x="${(m.l + gw * (i + 0.5)).toFixed(1)}" y="${H - 8}" text-anchor="middle">${r.label}</text>`;
      }
    });
    const p = rows.findIndex((r) => r.proj);
    if (p > 0) {
      const dx = (m.l + gw * p).toFixed(1);
      s += `<line class="sv-divider" x1="${dx}" x2="${dx}" y1="${m.t}" y2="${m.t + ih}"/>`;
      s += `<text class="sv-note" x="${+dx + 6}" y="${m.t + 10}">Projeção →</text>`;
    }
    return { s, y, gw, iw, ih };
  }

  /* ---------- barras: entradas × saídas ---------- */
  charts.flow = function (el, rows) {
    const W = Math.max(300, el.clientWidth), H = 290;
    const m = { l: 58, r: 10, t: 16, b: 30 };
    const maxV = Math.max(1, ...rows.map((r) => Math.max(r.in, r.out)));
    const sc = niceScale(0, maxV, 4, true);
    const n = rows.length;
    const f = frame(W, H, m, sc, n, rows);
    const id = 'f' + ++uid;
    const bw = Math.min(24, f.gw * 0.34);

    let defs = '';
    for (const [k, c] of [['in', 'var(--s-in)'], ['out', 'var(--s-out)']]) {
      defs += `<pattern id="${id}-${k}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <rect width="6" height="6" style="fill:${c};opacity:.22"/><rect width="2.4" height="6" style="fill:${c}"/></pattern>`;
    }

    let bars = '';
    rows.forEach((r, i) => {
      const cx = m.l + f.gw * (i + 0.5);
      const x0 = m.l + f.gw * i;
      const draw = (v, x, k) => {
        const h = f.y(0) - f.y(v);
        if (h < 0.5) return '';
        const d = barPath(x, f.y(v), bw, h, 4);
        return r.proj
          ? `<path d="${d}" style="fill:url(#${id}-${k});stroke:var(--s-${k});stroke-width:1.5"/>`
          : `<path d="${d}" class="sv-${k}"/>`;
      };
      bars += `<g class="col" data-i="${i}">
        <rect class="col-bg" x="${x0.toFixed(1)}" y="${m.t}" width="${f.gw.toFixed(1)}" height="${f.ih}" rx="6"/>
        ${draw(r.in, cx - bw - 1, 'in')}${draw(r.out, cx + 1, 'out')}
        <rect class="hit" x="${x0.toFixed(1)}" y="${m.t}" width="${f.gw.toFixed(1)}" height="${f.ih}"/></g>`;
    });

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras de entradas e saídas por mês, com projeção. Use o botão Ver tabela para os valores.">
      <defs>${defs}</defs>${f.s}${bars}</svg>`;

    bindHover(el, (i) => {
      const r = rows[i];
      return `<div class="t-title">${A.monthLong(r.key)}${r.proj ? ' · projeção' : r.current ? ' · em andamento' : ''}</div>
        <div class="t-row"><span class="k"><i class="dot dot-in"></i>Entradas</span><b>${A.money(r.in)}</b></div>
        <div class="t-row"><span class="k"><i class="dot dot-out"></i>Saídas</span><b>${A.money(r.out)}</b></div>
        <div class="t-foot">Resultado: <b>${A.money(r.in - r.out)}</b></div>`;
    });
  };

  /* ---------- linha: saldo acumulado + projeção ---------- */
  charts.balance = function (el, rows) {
    const W = Math.max(300, el.clientWidth), H = 270;
    const m = { l: 58, r: 14, t: 30, b: 30 };
    const vals = rows.flatMap((r) => [r.balance, r.lo, r.hi]);
    const sc = niceScale(Math.min(...vals), Math.max(...vals), 4, false);
    const n = rows.length;
    const f = frame(W, H, m, sc, n, rows, { noBase: true });
    const px = (i) => m.l + f.gw * (i + 0.5);
    const ci = rows.findIndex((r) => r.current);
    const hist = rows.filter((r) => !r.proj);
    const proj = rows.filter((r) => r.proj);
    const pt = (i) => `${px(i).toFixed(1)},${f.y(rows[i].balance).toFixed(1)}`;

    let s = f.s;
    if (proj.length && ci >= 0) {
      const up = rows.map((r, i) => (i >= ci ? `${px(i).toFixed(1)},${f.y(r.hi).toFixed(1)}` : null)).filter(Boolean);
      const dn = rows.map((r, i) => (i >= ci ? `${px(i).toFixed(1)},${f.y(r.lo).toFixed(1)}` : null)).filter(Boolean).reverse();
      s += `<polygon class="band" points="${up.concat(dn).join(' ')}"/>`;
    }
    if (hist.length > 1) s += `<polyline class="line-bal" points="${hist.map((_, i) => pt(i)).join(' ')}"/>`;
    if (proj.length && ci >= 0) {
      s += `<polyline class="line-bal line-proj" points="${rows.map((_, i) => (i >= ci ? pt(i) : null)).filter(Boolean).join(' ')}"/>`;
    }

    let cols = '';
    rows.forEach((r, i) => {
      const x0 = m.l + f.gw * i;
      cols += `<g class="col" data-i="${i}">
        <rect class="col-bg" x="${x0.toFixed(1)}" y="${m.t}" width="${f.gw.toFixed(1)}" height="${f.ih}" rx="6"/>
        <line class="xhair" x1="${px(i).toFixed(1)}" x2="${px(i).toFixed(1)}" y1="${m.t}" y2="${m.t + f.ih}"/>
        <circle class="${r.proj ? 'dot-p' : 'dot-h'}" cx="${px(i).toFixed(1)}" cy="${f.y(r.balance).toFixed(1)}" r="4"/>
        <circle class="hdot" cx="${px(i).toFixed(1)}" cy="${f.y(r.balance).toFixed(1)}" r="6.5"/>
        <rect class="hit" x="${x0.toFixed(1)}" y="${m.t}" width="${f.gw.toFixed(1)}" height="${f.ih}"/></g>`;
    });
    s += cols;

    // rótulos diretos: mês atual e último mês projetado
    const label = (i, txt, anchor) => {
      const yy = f.y(rows[i].balance);
      const above = yy - 12 > m.t - 6;
      return `<text class="sv-direct" x="${px(i).toFixed(1)}" y="${(above ? yy - 11 : yy + 20).toFixed(1)}" text-anchor="${anchor}">${txt}</text>`;
    };
    if (ci >= 0) s += label(ci, `Hoje ${A.moneyCompact(rows[ci].balance)}`, ci === 0 ? 'start' : 'middle');
    if (proj.length) s += label(n - 1, A.moneyCompact(rows[n - 1].balance), 'end');

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de linha do saldo acumulado ao fim de cada mês, com projeção tracejada e faixa provável. Use o botão Ver tabela para os valores.">${s}</svg>`;

    bindHover(el, (i) => {
      const r = rows[i];
      const range = r.proj
        ? `<div class="t-foot">Faixa provável:<br><b>${A.money(r.lo)}</b> a <b>${A.money(r.hi)}</b></div>`
        : '';
      return `<div class="t-title">${A.monthLong(r.key)}${r.proj ? ' · projeção' : r.current ? ' · em andamento' : ''}</div>
        <div class="t-row"><span class="k"><i class="dot" style="background:var(--s-bal)"></i>Saldo no fim do mês</span><b>${A.money(r.balance)}</b></div>
        <div class="t-row"><span>Resultado do mês</span><b>${A.money(r.net)}</b></div>${range}`;
    });
  };

  /* ---------- categorias (HTML) ---------- */
  charts.categories = function (el, rows) {
    if (!rows.length) {
      el.innerHTML = '<p class="muted">Sem saídas neste mês.</p>';
      return;
    }
    const max = Math.max(...rows.map((r) => Math.max(r.value, r.budget || 0)));
    const hasBudget = rows.some((r) => r.budget);
    el.innerHTML = `<ul class="cats">${rows.map((r, i) => {
      const over = r.budget && r.value >= r.budget;
      const near = r.budget && !over && r.value >= r.budget * 0.8;
      const flag = over ? '<span class="flag">▲ acima do limite</span>' : near ? '<span class="flag">▲ perto do limite</span>' : '';
      return `<li class="cat" data-i="${i}">
        <span class="name" title="${A.esc(r.name)}">${A.esc(r.name)}</span>
        <span class="track"><span class="bar" style="width:${(r.value / max) * 100}%"></span>${r.budget ? `<span class="limit" style="left:calc(${(r.budget / max) * 100}% - 1px)"></span>` : ''}</span>
        <span class="val">${A.money(r.value)}${flag}</span></li>`;
    }).join('')}</ul>${hasBudget ? '<p class="cats-note"><i></i>Traço = limite mensal definido em Orçamentos</p>' : ''}`;

    bindHover(el, (i) => {
      const r = rows[i];
      const b = r.budget
        ? `<div class="t-row"><span>Limite</span><b>${A.money(r.budget)}</b></div><div class="t-foot">${A.pct(r.value / r.budget)} do limite usado</div>`
        : '';
      return `<div class="t-title">${A.esc(r.name)}</div><div class="t-row"><span>Gasto no mês</span><b>${A.money(r.value)}</b></div>${b}`;
    });
  };
})();
