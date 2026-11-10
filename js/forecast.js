/* Projeção e avisos.
 *
 * Modelo:
 *  - Lançamentos mensais (recorrentes) entram exatamente, mês a mês.
 *  - Lançamentos avulsos seguem a média dos meses completos, ajustada por uma
 *    tendência (regressão linear) limitada a ±10% da média por mês.
 *  - Lançamentos avulsos já agendados para meses futuros prevalecem se forem
 *    maiores que a estimativa.
 *  - A faixa provável cresce com o desvio do resultado avulso histórico × √meses.
 */
(function () {
  'use strict';
  const A = window.App;

  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const stdev = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Ocorrências de lançamentos em um mês (expande os recorrentes). */
  A.entriesForMonth = function (txs, key) {
    const out = [];
    for (const t of txs) {
      const start = t.date.slice(0, 7);
      if (!t.recurring) {
        if (start === key) out.push({ ...t, txId: t.id });
      } else if (start <= key) {
        const day = Math.min(Number(t.date.slice(8, 10)), A.daysInMonth(key));
        out.push({ ...t, txId: t.id, date: `${key}-${String(day).padStart(2, '0')}` });
      }
    }
    return out;
  };

  A.summarize = function (entries) {
    const r = { in: 0, out: 0, inVar: 0, outVar: 0, byCat: {} };
    for (const e of entries) {
      r[e.type] += e.value;
      if (!e.recurring) r[e.type + 'Var'] += e.value;
      if (e.type === 'out') r.byCat[e.category] = (r.byCat[e.category] || 0) + e.value;
    }
    return r;
  };

  /** Projeta `horizon` valores a partir de uma série mensal (do mais antigo ao mais novo). */
  function projectSeries(series, horizon) {
    const n = series.length;
    const m = mean(series);
    const out = [];
    let base = m;
    let slope = 0;
    if (n >= 3) {
      const xm = (n - 1) / 2;
      let num = 0, den = 0;
      series.forEach((y, x) => { num += (x - xm) * (y - m); den += (x - xm) ** 2; });
      const b = den ? num / den : 0;
      base = (m + (m + b * (n - 1 - xm))) / 2;
      slope = clamp(b, -0.1 * m, 0.1 * m);
    }
    for (let k = 1; k <= horizon; k++) out.push(Math.max(0, base + slope * k));
    return out;
  }

  A.analyze = function (state, horizon = 6) {
    const today = A.todayStr();
    const cur = A.monthKey(today);
    const txs = state.transactions;

    let earliest = cur;
    for (const t of txs) { const k = t.date.slice(0, 7); if (k < earliest) earliest = k; }
    const back = A.addMonths(cur, -5);
    const histStart = back > earliest ? back : earliest;

    let bal = state.openingBalance;
    let nowBalance = state.openingBalance;
    const months = [];

    for (const key of A.monthRange(earliest, cur)) {
      const entries = A.entriesForMonth(txs, key);
      const s = A.summarize(entries);
      bal += s.in - s.out;
      for (const e of entries) if (e.date <= today) nowBalance += e.type === 'in' ? e.value : -e.value;
      if (key >= histStart) {
        months.push({
          key, label: A.monthLabel(key), proj: false, current: key === cur,
          in: s.in, out: s.out, net: s.in - s.out, balance: bal, lo: bal, hi: bal,
          inVar: s.inVar, outVar: s.outVar, byCat: s.byCat,
        });
      }
    }

    const hist = months.slice();
    const complete = hist.filter((m) => !m.current);
    const curM = hist[hist.length - 1];
    let inSeries = complete.map((m) => m.inVar);
    let outSeries = complete.map((m) => m.outVar);
    if (!complete.length) { inSeries = [curM.inVar]; outSeries = [curM.outVar]; }

    const pIn = projectSeries(inSeries, horizon);
    const pOut = projectSeries(outSeries, horizon);
    const sd = stdev(inSeries.map((v, i) => v - outSeries[i]));

    for (let k = 1; k <= horizon; k++) {
      const key = A.addMonths(cur, k);
      const s = A.summarize(A.entriesForMonth(txs, key));
      const inRec = s.in - s.inVar, outRec = s.out - s.outVar;
      const inc = inRec + Math.max(s.inVar, pIn[k - 1]);
      const exp = outRec + Math.max(s.outVar, pOut[k - 1]);
      bal += inc - exp;
      const band = sd * Math.sqrt(k);
      months.push({
        key, label: A.monthLabel(key), proj: true, current: false,
        in: inc, out: exp, net: inc - exp, balance: bal, lo: bal - band, hi: bal + band,
      });
    }

    const basis = complete.length;
    return {
      today, cur, months, nowBalance, basis,
      confidence: basis <= 1 ? 'baixa' : basis <= 3 ? 'média' : 'alta',
      hist, future: months.filter((m) => m.proj),
    };
  };

  /** Avisos ordenados por gravidade. */
  A.buildAlerts = function (state, an) {
    const list = [];
    const push = (level, title, text) => list.push({ level, title, text });
    const { hist, future } = an;
    const curM = hist[hist.length - 1];
    const complete = hist.filter((m) => !m.current);

    if (an.nowBalance < 0) {
      push('critical', 'Saldo negativo hoje', `Você está ${A.money(-an.nowBalance)} abaixo de zero.`);
    }

    const neg = future.find((m) => m.balance < 0);
    if (neg && an.nowBalance >= 0) {
      push('critical', `Saldo pode ficar negativo em ${neg.label}`,
        `No ritmo atual, o saldo previsto para ${A.monthLong(neg.key)} é ${A.money(neg.balance)}.`);
    } else if (!neg) {
      const avgOut = mean(future.map((m) => m.out));
      const low = future.reduce((a, m) => (m.balance < a.balance ? m : a), future[0]);
      if (avgOut > 0 && low.balance < avgOut * 0.5) {
        push('warning', 'Reserva ficando curta',
          `O menor saldo previsto (${A.money(low.balance)}, em ${low.label}) cobre menos de meio mês de saídas.`);
      }
    }

    if (curM.out > curM.in && curM.out > 0) {
      push('critical', 'Saídas maiores que entradas neste mês',
        `Já saíram ${A.money(curM.out)} contra ${A.money(curM.in)} de entradas.`);
    } else if (curM.in > 0 && curM.out / curM.in >= 0.9) {
      push('warning', 'Mês no limite',
        `As saídas já comprometem ${A.pct(curM.out / curM.in)} das entradas do mês.`);
    }

    const deficits = future.filter((m) => m.net < 0);
    if (deficits.length && !neg) {
      push('warning', `${deficits.length} de ${future.length} meses previstos fecham no vermelho`,
        `Começando em ${deficits[0].label}, as saídas projetadas superam as entradas.`);
    }

    if (complete.length >= 2) {
      const recentN = complete.length >= 3 ? 2 : 1;
      const recent = mean(complete.slice(-recentN).map((m) => m.out));
      const before = mean(complete.slice(0, -recentN).map((m) => m.out));
      if (before > 0) {
        const g = recent / before - 1;
        if (g >= 0.08) push('warning', `Saídas em alta: +${A.pct(g)}`, `Média recente de ${A.money(recent)} por mês, contra ${A.money(before)} nos meses anteriores.`);
        else if (g <= -0.08) push('good', `Saídas em queda: ${A.pct(g)}`, `Média recente de ${A.money(recent)} por mês, contra ${A.money(before)} antes.`);
      }
      const rIn = mean(complete.slice(-recentN).map((m) => m.in));
      const bIn = mean(complete.slice(0, -recentN).map((m) => m.in));
      if (bIn > 0 && rIn / bIn - 1 <= -0.1) {
        push('warning', `Entradas em queda: ${A.pct(rIn / bIn - 1)}`, `Média recente de ${A.money(rIn)} por mês, contra ${A.money(bIn)} antes.`);
      }
    }

    for (const [cat, limit] of Object.entries(state.budgets)) {
      const used = curM.byCat[cat] || 0;
      const r = used / limit;
      if (r >= 1) push('critical', `Orçamento de ${cat} estourado`, `${A.money(used)} de ${A.money(limit)} (${A.pct(r)} do limite).`);
      else if (r >= 0.8) push('warning', `${cat} perto do limite`, `${A.money(used)} de ${A.money(limit)} (${A.pct(r)} do limite).`);
    }

    if (complete.length >= 2) {
      let best = null;
      for (const [cat, v] of Object.entries(curM.byCat)) {
        const avg = mean(complete.map((m) => m.byCat[cat] || 0));
        const diff = v - avg;
        if (avg > 0 && v > avg * 1.3 && diff >= 100 && (!best || diff > best.diff)) best = { cat, v, avg, diff };
      }
      if (best && !(state.budgets[best.cat] && best.v >= state.budgets[best.cat] * 0.8)) {
        push('warning', `${best.cat} acima do seu padrão`,
          `${A.money(best.v)} neste mês, ${A.pct(best.v / best.avg - 1)} acima da média de ${A.money(best.avg)}.`);
      }
    }

    if (curM.in > 0 && curM.out <= curM.in) {
      const rate = (curM.in - curM.out) / curM.in;
      if (rate >= 0.2) push('good', `Você está guardando ${A.pct(rate)} das entradas`, `Sobram ${A.money(curM.in - curM.out)} neste mês até agora.`);
    }

    const last = future[future.length - 1];
    if (!neg && last && last.balance > an.nowBalance && !list.some((a) => a.level === 'critical')) {
      push('good', 'Tendência de alta no saldo', `Previsto: ${A.money(last.balance)} em ${last.label}, contra ${A.money(an.nowBalance)} hoje.`);
    }

    if (an.basis < 2) {
      push('info', 'Previsão com pouco histórico',
        'Com menos de 2 meses completos lançados, a projeção é só uma estimativa. Ela melhora a cada mês registrado.');
    }

    const order = { critical: 0, warning: 1, good: 2, info: 3 };
    list.sort((a, b) => order[a.level] - order[b.level]);
    if (!list.length) push('info', 'Nada preocupante por ora', 'Nenhum risco detectado nas entradas, saídas e limites.');
    return list.slice(0, 8);
  };
})();
