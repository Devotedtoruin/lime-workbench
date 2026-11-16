import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  ROLE_IDS,
  ROLE_PROFILES,
  ALL_NAV_PAGES,
  WEBSITE_CATEGORIES,
  WEBSITE_CATALOG,
  NOTE_FOLDERS,
  NOTE_TEMPLATES,
  canonicalUrlKey,
  isValidRoleId,
  getRoleProfile,
  getRolePresetLinks,
  getWebsiteCatalog,
  resolveRoleBlocks,
  planLinkImports
} from '../js/roles.js';
import { TEXT_LIMITS, validateWorkspaceUrl, validateWorkspaceTitle } from '../js/state.js';
import { upsertLink } from '../js/workspace.js';

const DEFAULT_BLOCK_FIXTURE = [
  { id: 'role-hub', title: '职业专属工作台', span: 12, core: true },
  { id: 'matrix', title: '四象限优先级矩阵', span: 8, widget: 'tasks' },
  { id: 'tasks', title: '今日任务清单', span: 4, core: true },
  { id: 'charts', title: '月度收支与分类图表', span: 8, widget: 'ledger' },
  { id: 'ledger', title: '本月收支与预算', span: 4, widget: 'ledger' },
  { id: 'notes', title: '工作便签（瀑布流）', span: 4, widget: 'notes' },
  { id: 'links', title: '工作链接', span: 4, widget: 'links' },
  { id: 'reminders', title: '近期提醒', span: 4, widget: 'reminders' },
  { id: 'rhythm', title: '近 7 天趋势', span: 6, widget: 'rhythm' },
  { id: 'review', title: '今日复盘', span: 6, widget: 'work' }
];

test('ROLE_PROFILES define valid icons, navPages, mobileTabs, kpiOrder, homeTools, and block layouts', () => {
  const iconDir = path.resolve(process.cwd(), 'assets/icons');
  const validKpis = new Set(['tasks', 'focus', 'ledger', 'shift']);
  const validBlocks = new Set(DEFAULT_BLOCK_FIXTURE.map(b => b.id));
  const validToolGroups = new Set(['dev', 'design', 'study', 'finance', 'general']);
  const validProjectModes = new Set(['milestone', 'client', 'course']);

  assert.equal(ROLE_IDS.length, 5);
  assert.equal(ALL_NAV_PAGES.length, 14);

  for (const id of ROLE_IDS) {
    assert.equal(isValidRoleId(id), true);
    const profile = getRoleProfile(id);
    assert.equal(profile.id, id);
    assert.ok(profile.name.length > 0);
    assert.ok(profile.tagline.length > 0);
    assert.equal(validToolGroups.has(profile.defaultToolGroup), true);
    assert.equal(validProjectModes.has(profile.defaultProjectMode), true);
    assert.ok(Array.isArray(profile.homeTools) && profile.homeTools.length >= 2);

    const iconFile = path.join(iconDir, `${profile.icon}.svg`);
    assert.equal(fs.existsSync(iconFile), true, `Missing role icon SVG: ${profile.icon}.svg`);

    assert.equal(profile.navPages.includes('home'), true);
    assert.equal(profile.navPages.includes('bookmarks'), true);
    assert.equal(profile.navPages.includes('notes'), true);
    assert.equal(profile.navPages.includes('toolbox'), true);
    assert.equal(profile.navPages.includes('projects'), true);
    assert.equal(profile.navPages.includes('me'), true);
    for (const page of profile.navPages) {
      assert.equal(ALL_NAV_PAGES.includes(page), true, `Unknown page id "${page}" in role "${id}"`);
    }

    assert.equal(profile.mobileTabs.length, 4);
    for (const tab of profile.mobileTabs) {
      assert.equal(ALL_NAV_PAGES.includes(tab), true, `Unknown mobileTab "${tab}" in role "${id}"`);
    }

    assert.equal(profile.kpiOrder.length, 4);
    assert.equal(new Set(profile.kpiOrder).size, 4);
    for (const kpi of profile.kpiOrder) {
      assert.equal(validKpis.has(kpi), true);
    }

    assert.equal(profile.blocksLayout[0].id, 'role-hub');
    for (const blk of profile.blocksLayout) {
      assert.equal(validBlocks.has(blk.id), true);
      assert.equal([4, 6, 8, 12].includes(blk.span), true);
    }
  }

  assert.equal(isValidRoleId('nonexistent'), false);
  assert.equal(getRoleProfile('nonexistent').id, 'general');
});

test('resolveRoleBlocks partitions all dashboard blocks without loss or duplication', () => {
  for (const id of ROLE_IDS) {
    const resolved = resolveRoleBlocks(id, DEFAULT_BLOCK_FIXTURE);
    assert.equal(resolved.blocks.length, DEFAULT_BLOCK_FIXTURE.length);
    const ids = resolved.blocks.map(b => b.id);
    assert.equal(new Set(ids).size, DEFAULT_BLOCK_FIXTURE.length);
    assert.equal(ids[0], 'role-hub');
    for (const hiddenId of resolved.hiddenBlocks) {
      assert.equal(ids.includes(hiddenId), true);
    }
  }

  const dev = resolveRoleBlocks('developer', DEFAULT_BLOCK_FIXTURE);
  assert.equal(dev.blocks[1].id, 'tasks');
  assert.equal(dev.hiddenBlocks.includes('charts'), true);

  const freelance = resolveRoleBlocks('freelance', DEFAULT_BLOCK_FIXTURE);
  assert.equal(freelance.blocks[1].id, 'charts');
  assert.equal(freelance.hiddenBlocks.includes('matrix'), true);
});

test('WEBSITE_CATALOG and NOTE_TEMPLATES satisfy workspace rules and deduplicate URLs', () => {
  assert.ok(WEBSITE_CATALOG.length >= 30);
  const seenUrls = new Set();

  for (const site of WEBSITE_CATALOG) {
    assert.equal(WEBSITE_CATEGORIES.includes(site.category), true);
    assert.equal(validateWorkspaceTitle(site.title, TEXT_LIMITS.linkTitle), true, `Invalid title: ${site.title}`);
    assert.equal(validateWorkspaceUrl(site.url), true, `Invalid URL: ${site.url}`);
    const key = canonicalUrlKey(site.url);
    assert.equal(seenUrls.has(key), false, `Duplicate canonical URL in catalog: ${site.url}`);
    seenUrls.add(key);
    assert.ok(Array.isArray(site.roles) && site.roles.length > 0);
  }

  for (const roleId of ROLE_IDS) {
    const presets = getRolePresetLinks(roleId);
    assert.ok(presets.length >= 5, `Role ${roleId} should have at least 5 preset links`);
  }

  assert.equal(getWebsiteCatalog('开发研发').every(s => s.category === '开发研发'), true);

  assert.ok(NOTE_FOLDERS.length >= 4);
  for (const tpl of NOTE_TEMPLATES) {
    assert.equal(NOTE_FOLDERS.includes(tpl.folder), true);
    assert.ok(tpl.title.length > 0 && tpl.body.length > 0);
  }
});

test('planLinkImports deduplicates canonical URLs and upserts safely via upsertLink', () => {
  const existing = [
    { id: 1, title: 'GitHub', url: 'https://github.com/', createdAt: 1000 }
  ];
  const candidates = [
    { title: 'GitHub Duplicate', url: 'https://GITHUB.com' },
    { title: 'MDN', url: 'https://developer.mozilla.org' },
    { title: 'MDN Repeat', url: 'https://developer.mozilla.org/' }
  ];

  const planned = planLinkImports(existing, candidates);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].title, 'MDN');

  const updated = upsertLink(existing, planned[0], 2000);
  assert.equal(updated.length, 2);
  assert.equal(updated[1].title, 'MDN');
});
