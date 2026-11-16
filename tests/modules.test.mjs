import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdownSafe, noteWordStats } from '../js/markdown.js';
import {
  formatJsonTool,
  testRegexTool,
  convertTimestampTool,
  encodeDecodeTool,
  generateUuids,
  contrastRatioTool,
  typeScaleTool,
  calculateGpa,
  formatCitation,
  calculateFreelanceQuote,
  splitContractPhases,
  dateDiffTool,
  convertUnitTool
} from '../js/toolbox.js';

test('renderMarkdownSafe escapes HTML, blocks javascript: URIs, and renders safe Markdown blocks', () => {
  const xssAttempt = '<script>alert(1)</script>\n\n[Click](javascript:alert(1)) & [Docs](https://developer.mozilla.org)';
  const rendered = renderMarkdownSafe(xssAttempt);
  assert.equal(rendered.includes('<script>'), false);
  assert.equal(rendered.includes('javascript:'), false);
  assert.equal(rendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
  assert.equal(rendered.includes('<a href="https://developer.mozilla.org/" target="_blank" rel="noopener noreferrer">Docs</a>'), true);

  const md = '# 标题\n- [x] 已完成\n- [ ] 待办\n```js\nconst a = 1 < 2;\n```';
  const html = renderMarkdownSafe(md);
  assert.equal(html.includes('<h1>标题</h1>'), true);
  assert.equal(html.includes('class="md-task-list"'), true);
  assert.equal(html.includes('class="is-checked"'), true);
  assert.equal(html.includes('const a = 1 &lt; 2;'), true);

  const stats = noteWordStats('第一行内容\n第二行');
  assert.equal(stats.lines, 2);
  assert.equal(stats.chars, 8);
  assert.equal(stats.readMinutes, 1);
});

test('developer tools in js/toolbox.js format JSON, match regex groups, convert timestamps, and generate UUIDs', () => {
  const formatted = formatJsonTool('{"b":2,"a":1}', { sortKeys: true });
  assert.equal(formatted.ok, true);
  assert.ok(formatted.output.indexOf('"a"') < formatted.output.indexOf('"b"'));

  const badJson = formatJsonTool('{bad json}');
  assert.equal(badJson.ok, false);
  assert.ok(badJson.error.length > 0);

  const rx = testRegexTool('(\\d{4})-(\\d{2})', 'g', '2026-11 and 2026-12');
  assert.equal(rx.ok, true);
  assert.equal(rx.matches.length, 2);
  assert.deepEqual(rx.matches[0].groups, ['2026', '11']);

  const ts = convertTimestampTool('1700000000');
  assert.equal(ts.ok, true);
  assert.equal(ts.seconds, 1700000000);
  assert.equal(ts.milliseconds, 1700000000000);

  const b64 = encodeDecodeTool('base64-enc', '青柠工作台');
  assert.equal(b64.ok, true);
  const back = encodeDecodeTool('base64-dec', b64.output);
  assert.equal(back.ok, true);
  assert.equal(back.output, '青柠工作台');

  const ids = generateUuids(3);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
});

test('design, student, freelance, and general tools in js/toolbox.js calculate accurately', () => {
  const contrast = contrastRatioTool('#000000', '#FFFFFF');
  assert.equal(contrast.ok, true);
  assert.equal(contrast.ratio, 21);
  assert.equal(contrast.aaNormal, true);
  assert.equal(contrast.aaaNormal, true);

  const scale = typeScaleTool(16, 1.25);
  assert.equal(scale.find(r => r.token === 'text-base')?.px, 16);
  assert.equal(scale.find(r => r.token === 'text-lg')?.px, 20);

  const gpa = calculateGpa([{ credit: 4, score: 92 }, { credit: 2, score: 78 }], 4);
  assert.equal(gpa.totalCredits, 6);
  assert.equal(gpa.count, 2);
  assert.equal(gpa.gpa, Number(((4 * 4.0 + 2 * 3.0) / 6).toFixed(2)));

  const cite = formatCitation('gb', { author: '李明', year: '2026', title: '测试论文', source: '软件学报', pages: '1-9' });
  assert.equal(cite.includes('[J]'), true);
  assert.equal(cite.includes('李明'), true);

  const quote = calculateFreelanceQuote({ hourlyRate: 200, hours: 10, bufferPct: 10, taxPct: 5 });
  assert.equal(quote.base, 2000);
  assert.equal(quote.bufferAmount, 200);
  assert.equal(quote.subtotal, 2200);
  assert.equal(quote.taxAmount, 110);
  assert.equal(quote.total, 2310);

  const phases = splitContractPhases(10000, [{ name: '首付', pct: 40 }, { name: '尾款', pct: 60 }]);
  assert.equal(phases[0].amount, 4000);
  assert.equal(phases[1].amount, 6000);

  const diff = dateDiffTool('2026-11-16', '2026-11-20'); // Mon to Fri
  assert.equal(diff.ok, true);
  assert.equal(diff.absDays, 4);
  assert.equal(diff.workdays, 5);
  assert.equal(diff.weekends, 0);

  const fx = convertUnitTool('currency', 100, 'USD', 'CNY', 7.25);
  assert.equal(fx.ok, true);
  assert.equal(fx.result, 725);
});
