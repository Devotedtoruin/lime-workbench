// Pure offline utility toolbox calculations across developer, creator, student, freelance, and general roles.

function sortObjectDeep(val) {
  if (Array.isArray(val)) return val.map(sortObjectDeep);
  if (val && typeof val === 'object') {
    const out = {};
    for (const k of Object.keys(val).sort()) out[k] = sortObjectDeep(val[k]);
    return out;
  }
  return val;
}

export function formatJsonTool(raw, { indent = 2, sortKeys = false, minify = false } = {}) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, output: '', error: '请先输入 JSON 文本' };
  try {
    let parsed = JSON.parse(text);
    if (sortKeys) parsed = sortObjectDeep(parsed);
    const output = minify ? JSON.stringify(parsed) : JSON.stringify(parsed, null, indent);
    const kind = Array.isArray(parsed) ? `数组 (${parsed.length} 项)` : typeof parsed === 'object' && parsed !== null ? `对象 (${Object.keys(parsed).length} 键)` : typeof parsed;
    return { ok: true, output, stats: `${kind} · ${output.length} 字符`, error: '' };
  } catch (err) {
    return { ok: false, output: '', error: `语法错误：${err?.message || 'JSON 解析失败'}` };
  }
}

export function testRegexTool(pattern, flags = 'g', sample = '') {
  const pat = String(pattern || '');
  if (!pat) return { ok: false, matches: [], error: '请输入正则表达式' };
  if (pat.length > 300) return { ok: false, matches: [], error: '正则表达式过长' };
  const cleanFlags = [...new Set(String(flags || '').replace(/[^gimsuy]/g, ''))].join('');
  try {
    const rx = new RegExp(pat, cleanFlags);
    const text = String(sample || '');
    const matches = [];
    if (cleanFlags.includes('g')) {
      let m;
      let guard = 0;
      while ((m = rx.exec(text)) !== null && guard < 100) {
        guard++;
        matches.push({ text: m[0], index: m.index, groups: m.slice(1) });
        if (m[0] === '') rx.lastIndex++;
      }
    } else {
      const m = rx.exec(text);
      if (m) matches.push({ text: m[0], index: m.index, groups: m.slice(1) });
    }
    return { ok: true, matches, error: '' };
  } catch (err) {
    return { ok: false, matches: [], error: `正则无效：${err?.message || '语法错误'}` };
  }
}

export function convertTimestampTool(raw) {
  const val = String(raw || '').trim();
  if (!val) return { ok: false, error: '请输入时间戳或日期时间字符串' };
  let ms;
  if (/^-?\d+(\.\d+)?$/.test(val)) {
    const num = Number(val);
    ms = Math.abs(num) < 1e11 ? Math.round(num * 1000) : Math.round(num);
  } else {
    ms = Date.parse(val);
  }
  if (!Number.isFinite(ms)) return { ok: false, error: '无法识别该时间格式，请尝试 10/13 位时间戳或 YYYY-MM-DD HH:mm:ss' };
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return { ok: false, error: '日期超出可解析范围' };
  return {
    ok: true,
    seconds: Math.floor(ms / 1000),
    milliseconds: ms,
    iso: d.toISOString(),
    local: d.toLocaleString('zh-CN', { hour12: false }),
    error: ''
  };
}

export function encodeDecodeTool(mode, raw) {
  const text = String(raw ?? '');
  try {
    if (mode === 'url-enc') return { ok: true, output: encodeURIComponent(text), error: '' };
    if (mode === 'url-dec') return { ok: true, output: decodeURIComponent(text), error: '' };
    if (mode === 'base64-enc') {
      const bytes = new TextEncoder().encode(text);
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return { ok: true, output: btoa(bin), error: '' };
    }
    if (mode === 'base64-dec') {
      const bin = atob(text.trim());
      const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
      return { ok: true, output: new TextDecoder().decode(bytes), error: '' };
    }
    return { ok: false, output: '', error: '未知编解码模式' };
  } catch {
    return { ok: false, output: '', error: '输入内容无法按所选格式转换' };
  }
}

export function generateUuids(count = 4) {
  const n = Math.min(20, Math.max(1, Math.round(Number(count) || 1)));
  const out = [];
  for (let i = 0; i < n; i++) {
    if (globalThis.crypto?.randomUUID) {
      out.push(globalThis.crypto.randomUUID());
    } else {
      out.push('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      }));
    }
  }
  return out;
}

function parseHexRgb(hex) {
  const clean = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16)
    ];
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16)
    ];
  }
  return null;
}

function rgbToHsl([r, g, b]) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

function relLuminance([r, g, b]) {
  const chan = [r, g, b].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

export function contrastRatioTool(hexFg, hexBg) {
  const fg = parseHexRgb(hexFg);
  const bg = parseHexRgb(hexBg);
  if (!fg || !bg) return { ok: false, error: '请输入有效的 3 位或 6 位 HEX 颜色值' };
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return {
    ok: true,
    ratio,
    ratioText: `${ratio.toFixed(2)}:1`,
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3.0,
    aaaNormal: ratio >= 7.0,
    aaaLarge: ratio >= 4.5,
    fgRgb: `rgb(${fg.join(', ')})`,
    bgRgb: `rgb(${bg.join(', ')})`,
    fgHsl: rgbToHsl(fg),
    bgHsl: rgbToHsl(bg),
    error: ''
  };
}

export function typeScaleTool(basePx = 16, ratio = 1.25) {
  const base = Math.max(10, Math.min(32, Number(basePx) || 16));
  const r = Math.max(1.05, Math.min(2.0, Number(ratio) || 1.25));
  const defs = [
    { token: 'text-xs', exp: -2, label: '辅助角标' },
    { token: 'text-sm', exp: -1, label: '次要标签' },
    { token: 'text-base', exp: 0, label: '正文基准' },
    { token: 'text-lg', exp: 1, label: '卡片标题' },
    { token: 'text-xl', exp: 2, label: '区块标题' },
    { token: 'text-2xl', exp: 3, label: '页面主标题' },
    { token: 'text-3xl', exp: 4, label: '展示标题' }
  ];
  return defs.map(d => {
    const px = Number((base * Math.pow(r, d.exp)).toFixed(1));
    return {
      ...d,
      px,
      rem: Number((px / 16).toFixed(3))
    };
  });
}

export function calculateGpa(courses, scale = 4) {
  const s = scale === 5 ? 5 : 4;
  let totalCredits = 0;
  let totalPoints = 0;
  let validCount = 0;
  for (const c of Array.isArray(courses) ? courses : []) {
    const credit = Number(c?.credit);
    const score = Number(c?.score);
    if (!Number.isFinite(credit) || credit <= 0 || !Number.isFinite(score) || score < 0 || score > 100) continue;
    let gp = 0;
    if (s === 4) {
      if (score >= 90) gp = 4.0;
      else if (score >= 85) gp = 3.7;
      else if (score >= 82) gp = 3.3;
      else if (score >= 78) gp = 3.0;
      else if (score >= 75) gp = 2.7;
      else if (score >= 72) gp = 2.3;
      else if (score >= 68) gp = 2.0;
      else if (score >= 64) gp = 1.5;
      else if (score >= 60) gp = 1.0;
      else gp = 0;
    } else {
      gp = score >= 60 ? Math.max(1.0, Math.min(5.0, (score - 50) / 10)) : 0;
    }
    totalCredits += credit;
    totalPoints += credit * gp;
    validCount++;
  }
  const gpa = totalCredits > 0 ? Number((totalPoints / totalCredits).toFixed(2)) : 0;
  return { totalCredits: Number(totalCredits.toFixed(1)), gpa, count: validCount };
}

export function formatCitation(style, fields = {}) {
  const author = String(fields.author || '作者').trim();
  const year = String(fields.year || new Date().getFullYear()).trim();
  const title = String(fields.title || '文献题名').trim();
  const source = String(fields.source || '期刊或出版机构').trim();
  const pages = String(fields.pages || '').trim();
  if (style === 'apa') {
    return `${author} (${year}). ${title}. ${source}${pages ? `, ${pages}` : ''}.`;
  }
  return `${author}. ${title}[J]. ${source}, ${year}${pages ? `: ${pages}` : ''}.`;
}

export function calculateFreelanceQuote({ hourlyRate = 300, hours = 40, bufferPct = 15, taxPct = 6 } = {}) {
  const rate = Math.max(0, Number(hourlyRate) || 0);
  const h = Math.max(0, Number(hours) || 0);
  const buf = Math.max(0, Math.min(100, Number(bufferPct) || 0));
  const tax = Math.max(0, Math.min(50, Number(taxPct) || 0));
  const base = rate * h;
  const bufferAmount = base * (buf / 100);
  const subtotal = base + bufferAmount;
  const taxAmount = subtotal * (tax / 100);
  const total = subtotal + taxAmount;
  const netRate = h > 0 ? subtotal / h : 0;
  return {
    base: Number(base.toFixed(2)),
    bufferAmount: Number(bufferAmount.toFixed(2)),
    subtotal: Number(subtotal.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    total: Number(total.toFixed(2)),
    netRate: Number(netRate.toFixed(2))
  };
}

export function splitContractPhases(totalAmount, phases) {
  const total = Math.max(0, Number(totalAmount) || 0);
  return (Array.isArray(phases) ? phases : []).map(p => {
    const pct = Math.max(0, Math.min(100, Number(p?.pct) || 0));
    return {
      name: String(p?.name || '阶段款项').trim(),
      pct,
      amount: Number(((total * pct) / 100).toFixed(2))
    };
  });
}

export function dateDiffTool(startStr, endStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startStr || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endStr || ''))) {
    return { ok: false, error: '请选择有效的开始与结束日期' };
  }
  const s = new Date(`${startStr}T00:00:00`);
  const e = new Date(`${endStr}T00:00:00`);
  const step = s <= e ? 1 : -1;
  const totalDays = Math.round((e - s) / 86400000);
  let workdays = 0;
  let weekends = 0;
  const cursor = new Date(s);
  const count = Math.abs(totalDays);
  for (let i = 0; i <= count; i++) {
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) weekends++;
    else workdays++;
    cursor.setDate(cursor.getDate() + step);
  }
  return {
    ok: true,
    totalDays,
    absDays: count,
    workdays,
    weekends,
    weeks: Number((count / 7).toFixed(1)),
    error: ''
  };
}

export function convertUnitTool(category, value, fromUnit, toUnit, customRate = 7.2) {
  const v = Number(value);
  if (!Number.isFinite(v)) return { ok: false, result: 0, error: '请输入有效数字' };
  if (category === 'currency') {
    const r = Math.max(0.0001, Number(customRate) || 7.2);
    if (fromUnit === toUnit) return { ok: true, result: Number(v.toFixed(4)), error: '' };
    const res = fromUnit === 'USD' && toUnit === 'CNY' ? v * r : v / r;
    return { ok: true, result: Number(res.toFixed(2)), error: '' };
  }
  const factors = {
    length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, inch: 0.0254, ft: 0.3048 },
    weight: { kg: 1, g: 0.001, jin: 0.5, lb: 0.45359237 },
    data: { MB: 1, KB: 1 / 1024, GB: 1024, TB: 1024 * 1024 }
  };
  const table = factors[category];
  if (!table || !table[fromUnit] || !table[toUnit]) return { ok: false, result: 0, error: '不支持的单位换算' };
  const base = v * table[fromUnit];
  const out = base / table[toUnit];
  return { ok: true, result: Number(out.toFixed(6).replace(/\.?0+$/, '')) || 0, error: '' };
}
