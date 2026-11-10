/* Leitor e gravador mínimo de arquivos .xlsx, sem dependências.
 *
 * Gravação: monta um ZIP (sem compressão) com as partes XML do Office Open XML.
 * Leitura: abre o ZIP, descompacta com DecompressionStream (nativo do navegador)
 * e converte as planilhas em matrizes de valores. Fórmulas não são executadas;
 * vale o último valor calculado salvo no arquivo.
 *
 * API:
 *   App.xlsx.build([{ name, rows, widths }]) -> Blob
 *     célula: valor simples ou { v, t } com t = 's' texto | 'n' número | 'd' data (AAAA-MM-DD) | 'm' dinheiro | 'h' cabeçalho
 *   App.xlsx.read(arrayBuffer) -> Promise<[{ name, rows }]>   (datas viram 'AAAA-MM-DD')
 */
(function () {
  'use strict';
  const A = window.App;
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  const MAX_UNZIPPED = 50 * 1024 * 1024;
  const MAX_ROWS = 50000;
  const MAX_COLS = 100;

  /* ---------- CRC32 ---------- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* ---------- ZIP (gravação, método "store") ---------- */
  function zip(files) {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = enc.encode(f.text);
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true); // nomes em UTF-8
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  /* ---------- gravação do XLSX ---------- */
  const xmlEsc = (s) =>
    String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  const serialFromIso = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  };

  // estilos: 0 normal, 1 cabeçalho, 2 data, 3 dinheiro
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;R$&quot; #,##0.00;[Red]-&quot;R$&quot; #,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9E8E2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function cellXml(cell, ref) {
    if (cell === null || cell === undefined || cell === '') return '';
    const o = typeof cell === 'object' ? cell : { v: cell };
    const t = o.t || (typeof o.v === 'number' ? 'n' : 's');
    const str = (style) =>
      `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(o.v)}</t></is></c>`;
    switch (t) {
      case 'h': return str(1);
      case 'd': return `<c r="${ref}" s="2"><v>${serialFromIso(o.v)}</v></c>`;
      case 'm': return `<c r="${ref}" s="3"><v>${Number(o.v)}</v></c>`;
      case 'n': return `<c r="${ref}"><v>${Number(o.v)}</v></c>`;
      default: return str(0);
    }
  }

  function sheetXml(sh) {
    const nCols = Math.max(0, ...sh.rows.map((r) => r.length));
    const rows = sh.rows.map((row, r) => `<row r="${r + 1}">${row.map((c, i) => cellXml(c, colName(i) + (r + 1))).join('')}</row>`).join('');
    const cols = sh.widths ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const dim = sh.rows.length && nCols ? `<dimension ref="A1:${colName(nCols - 1)}${sh.rows.length}"/>` : '';
    const view = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    const filter = sh.filter && sh.rows.length > 1 ? `<autoFilter ref="A1:${colName(nCols - 1)}${sh.rows.length}"/>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dim}${sh.noFreeze ? '' : view}${cols}<sheetData>${rows}</sheetData>${filter}</worksheet>`;
  }

  function build(sheets) {
    const safeName = (n, i) => String(n).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || `Planilha${i + 1}`;
    const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const files = [
      {
        name: '[Content_Types].xml',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
      },
      {
        name: '_rels/.rels',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      {
        name: 'xl/workbook.xml',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(safeName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`,
      },
      { name: 'xl/styles.xml', text: STYLES },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })),
    ];
    return zip(files);
  }

  /* ---------- leitura: ZIP ---------- */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador não consegue abrir planilhas compactadas. Atualize o navegador.');
    }
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_UNZIPPED) { reader.cancel(); throw new Error('Planilha grande demais para abrir.'); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  function openZip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    }
    if (e < 0) throw new Error('O arquivo não é um .xlsx válido.');
    const count = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    if (count > 5000 || p >= u8.length) throw new Error('O arquivo não é um .xlsx válido.');
    const entries = {};
    for (let i = 0; i < count; i++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('O arquivo não é um .xlsx válido.');
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      entries[dec.decode(u8.subarray(p + 46, p + 46 + nl))] = {
        method: dv.getUint16(p + 10, true),
        csize: dv.getUint32(p + 20, true),
        usize: dv.getUint32(p + 24, true),
        lo: dv.getUint32(p + 42, true),
      };
      p += 46 + nl + el + cl;
    }
    return {
      has: (n) => Object.prototype.hasOwnProperty.call(entries, n),
      async text(name) {
        const f = entries[name];
        if (!f) return null;
        if (f.usize > MAX_UNZIPPED) throw new Error('Planilha grande demais para abrir.');
        if (f.lo + 30 > u8.length || dv.getUint32(f.lo, true) !== 0x04034b50) throw new Error('O arquivo está corrompido.');
        const start = f.lo + 30 + dv.getUint16(f.lo + 26, true) + dv.getUint16(f.lo + 28, true);
        if (start + f.csize > u8.length) throw new Error('O arquivo está corrompido.');
        const raw = u8.subarray(start, start + f.csize);
        if (f.method === 0) return dec.decode(raw);
        if (f.method === 8) return dec.decode(await inflateRaw(raw));
        throw new Error('Método de compactação não suportado.');
      },
    };
  }

  /* ---------- leitura: XML ---------- */
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('O arquivo está corrompido.');
    return doc;
  }
  const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
  const child = (node, tag) => Array.from(node.children).find((c) => c.localName === tag) || null;

  function siText(si) {
    let s = '';
    for (const c of Array.from(si.children)) {
      if (c.localName === 't') s += c.textContent;
      else if (c.localName === 'r') { const t = child(c, 't'); if (t) s += t.textContent; }
    }
    return s;
  }

  const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  function dateStyles(doc) {
    const codes = {};
    all(doc, 'numFmt').forEach((n) => { codes[n.getAttribute('numFmtId')] = n.getAttribute('formatCode') || ''; });
    const cx = all(doc, 'cellXfs')[0];
    const xfs = cx ? Array.from(cx.children) : [];
    return xfs.map((xf) => {
      const id = Number(xf.getAttribute('numFmtId')) || 0;
      if (BUILTIN_DATE_FMT.has(id)) return true;
      const code = (codes[id] || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
      return /[dy]/i.test(code);
    });
  }

  function isoFromSerial(n) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  A.isoFromSerial = isoFromSerial;

  function colIndex(ref) {
    const m = /^([A-Z]+)/i.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function parseSheet(doc, shared, isDate) {
    const rows = [];
    let seq = 0;
    for (const row of all(doc, 'row')) {
      seq += 1;
      const r = (Number(row.getAttribute('r')) || seq) - 1;
      seq = r + 1;
      if (r >= MAX_ROWS) continue;
      const out = [];
      let seqCol = 0;
      for (const c of Array.from(row.children)) {
        if (c.localName !== 'c') continue;
        let ci = colIndex(c.getAttribute('r'));
        if (ci < 0) ci = seqCol;
        seqCol = ci + 1;
        if (ci >= MAX_COLS) continue;
        const t = c.getAttribute('t');
        const s = Number(c.getAttribute('s')) || 0;
        const vEl = child(c, 'v');
        const v = vEl ? vEl.textContent : null;
        let val = null;
        if (t === 's') val = v === null ? null : shared[Number(v)] ?? null;
        else if (t === 'inlineStr') { const is = child(c, 'is'); val = is ? siText(is) : null; }
        else if (t === 'str') val = v;
        else if (t === 'b') val = v === '1';
        else if (t === 'e') val = null;
        else if (v !== null && v !== '') {
          const n = Number(v);
          val = Number.isFinite(n) ? (isDate[s] ? isoFromSerial(n) : n) : null;
        }
        out[ci] = val;
      }
      rows[r] = Array.from(out, (x) => (x === undefined ? null : x));
    }
    return Array.from(rows, (r) => r || []);
  }

  async function read(buf) {
    const z = openZip(buf);
    const wbText = await z.text('xl/workbook.xml');
    if (!wbText) throw new Error('O arquivo não parece uma planilha do Excel (.xlsx).');
    const wb = parseXml(wbText);
    const relsText = (await z.text('xl/_rels/workbook.xml.rels')) || '';
    const targets = {};
    if (relsText) all(parseXml(relsText), 'Relationship').forEach((r) => { targets[r.getAttribute('Id')] = r.getAttribute('Target') || ''; });

    const ssText = await z.text('xl/sharedStrings.xml');
    const shared = ssText ? all(parseXml(ssText), 'si').map(siText) : [];
    const stText = await z.text('xl/styles.xml');
    const isDate = stText ? dateStyles(parseXml(stText)) : [];

    const sheets = [];
    for (const sh of all(wb, 'sheet')) {
      const rid = sh.getAttributeNS(NS_R, 'id') || sh.getAttribute('r:id');
      let target = targets[rid];
      if (!target) continue;
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const text = await z.text(target);
      if (!text) continue;
      sheets.push({ name: sh.getAttribute('name') || '', rows: parseSheet(parseXml(text), shared, isDate) });
    }
    if (!sheets.length) throw new Error('Nenhuma aba encontrada na planilha.');
    return sheets;
  }

  A.xlsx = { build, read };
})();
