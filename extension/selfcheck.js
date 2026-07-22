/**
 * selfcheck.js — runnable asserts for the DOM-free modules
 * (sweep.js / grouping.js / ai-grouping.js).
 *
 * Run: node extension/selfcheck.js
 * Prints "selfcheck OK" and exits 0, or throws on the first failure.
 * Not loaded by the extension; node-only.
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// Each DOM-free module is a plain script with top-level const/function.
// vm.runInThisContext gives it node's globals (URL, JSON, ...); the
// appended expression evaluates to the module's public surface.
function loadModule(file, exportExpr) {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  return vm.runInThisContext(`${code}\n;${exportExpr}`, { filename: file });
}

const sweep = loadModule('sweep.js',
  '({ isStaleTab, partitionSweepTargets, nextSweepTime, AUTO_CLOSE_DEFAULTS, DAY_MS })');

let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok  ${name}`); }
  else { failures++; console.error(`FAIL  ${name}`); }
}

const NOW = 1_800_000_000_000; // fixed instant, makes tests deterministic
const DAY = 24 * 60 * 60 * 1000;

// ---- isStaleTab ----
const base = { id: 1, url: 'https://a.com/', active: false, pinned: false, audible: false, isDashboard: false, lastAccessed: NOW - 2 * DAY };
check('stale: old idle tab is stale',            sweep.isStaleTab({ ...base }, DAY, NOW) === true);
check('stale: active tab is never stale',        sweep.isStaleTab({ ...base, active: true }, DAY, NOW) === false);
check('stale: pinned tab is never stale',        sweep.isStaleTab({ ...base, pinned: true }, DAY, NOW) === false);
check('stale: audible tab is never stale',       sweep.isStaleTab({ ...base, audible: true }, DAY, NOW) === false);
check('stale: dashboard page is never stale',      sweep.isStaleTab({ ...base, isDashboard: true }, DAY, NOW) === false);
check('stale: missing lastAccessed never stale', !sweep.isStaleTab({ ...base, lastAccessed: undefined }, DAY, NOW));
check('stale: fresh tab is not stale',           sweep.isStaleTab({ ...base, lastAccessed: NOW - 1000 }, DAY, NOW) === false);

// ---- partitionSweepTargets ----
const staleA = { id: 10, groupId: -1, lastAccessed: NOW - 2 * DAY };
const freshB = { id: 11, groupId: -1, lastAccessed: NOW - 1000 };
const grpOld1 = { id: 20, groupId: 5, lastAccessed: NOW - 4 * DAY };
const grpOld2 = { id: 21, groupId: 5, lastAccessed: NOW - 4 * DAY };
const grpMixed1 = { id: 30, groupId: 6, lastAccessed: NOW - 4 * DAY };
const grpMixed2 = { id: 31, groupId: 6, lastAccessed: NOW - 1000 };

let targets = sweep.partitionSweepTargets(
  [staleA, freshB], { tabStaleMs: DAY, groupStaleMs: 3 * DAY, now: NOW });
check('partition: ungrouped stale tab swept',  targets.some(t => t.id === 10));
check('partition: ungrouped fresh tab kept',  !targets.some(t => t.id === 11));

targets = sweep.partitionSweepTargets(
  [grpOld1, grpOld2], { tabStaleMs: DAY, groupStaleMs: 3 * DAY, now: NOW });
check('partition: all-stale group swept as a unit', targets.length === 2);

targets = sweep.partitionSweepTargets(
  [grpMixed1, grpMixed2], { tabStaleMs: DAY, groupStaleMs: 3 * DAY, now: NOW });
check('partition: one fresh member keeps whole group', targets.length === 0);

// ---- ai-grouping: parseGrouperResponse ----
const ai = loadModule('ai-grouping.js',
  '({ parseGrouperResponse, buildGrouperPayload, applyKeepRules, mergeGroupsIntoCache, trimUrlForPrompt, resolveApiEndpoints, extractResponseText, classifyUrlType, buildOpenerGraph, clusterByTime, calculateTabImportance, AI_GROUP_MAX_TABS })');

const ptabs = [
  { id: 1, url: 'https://github.com/a' },
  { id: 2, url: 'https://stackoverflow.com/b' },
  { id: 3, url: 'https://news.ycombinator.com/c' },
  { id: 4, url: 'https://x.com/d' },
];

let res = ai.parseGrouperResponse(
  '{"groups":[{"label":"Debug auth","ids":[1,2]},{"label":"News","ids":[3,4]}]}', ptabs);
check('parse: two valid groups', res.groups.length === 2);
check('parse: label kept',       res.groups[0].label === 'Debug auth');
check('parse: ids mapped to urls', res.groups[0].urls.join(',') === 'https://github.com/a,https://stackoverflow.com/b');
check('parse: empty dupes/close arrays', res.dupes.length === 0 && res.close.length === 0);

res = ai.parseGrouperResponse(
  '```json\n{"groups":[{"label":"X","ids":[1,99,2]}]}\n```', ptabs);
check('parse: fenced JSON accepted, hallucinated id dropped',
  res.groups.length === 1 && res.groups[0].urls.length === 2);

res = ai.parseGrouperResponse(
  '{"groups":[{"label":"Dup","ids":[1,2]},{"label":"Dup2","ids":[2,3]}]}', ptabs);
check('parse: id claimed by first group only',
  res.groups.length === 1 && res.groups[0].label === 'Dup');

res = ai.parseGrouperResponse(
  '{"groups":[{"label":"Tiny","ids":[1]}]}', ptabs);
check('parse: sub-2 group dropped', res.groups.length === 0);

res = ai.parseGrouperResponse(
  '{"groups":[{"label":"Str","ids":["1","2"]}]}', ptabs);
check('parse: string ids coerced', res.groups.length === 1);

res = ai.parseGrouperResponse(
  '{"dupes":[[1,2],[2,3],[4]],"close":[{"id":3,"reason":"done reading"},{"id":99,"reason":"ghost"},{"id":4}]}', ptabs);
check('parse: dupe id claimed once, sub-2 cluster dropped',
  res.dupes.length === 1 && res.dupes[0].join(',') === 'https://github.com/a,https://stackoverflow.com/b');
check('parse: close ghost id dropped, missing reason → empty string',
  res.close.length === 2 && res.close[0].reason === 'done reading' && res.close[1].reason === '');

const manyTabs = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, url: `https://m.com/${i}` }));
res = ai.parseGrouperResponse(
  '{"close":[' + manyTabs.map(t => `{"id":${t.id}}`).join(',') + ']}', manyTabs);
check('parse: close capped at 50', res.close.length === 50);

let threw = false;
try { ai.parseGrouperResponse('no json here', ptabs); } catch { threw = true; }
check('parse: garbage content throws', threw);

// ---- ai-grouping: applyKeepRules ----
// non-root paths (depth ≥ 2) so these aren't incidentally classified urlType:'root' → core
const keepTabs = [
  { id: 1, url: 'https://a.com/', pinned: true },
  { id: 2, url: 'https://b.com/page/detail' },
  { id: 3, url: 'https://c.com/page/detail' },
];
const kr = ai.applyKeepRules({
  groups: [],
  dupes: [['https://b.com/page/detail', 'https://a.com/', 'https://c.com/page/detail']],
  close: [{ url: 'https://a.com/', reason: 'x' }, { url: 'https://b.com/page/detail', reason: 'y' }],
}, keepTabs);
check('keep: close filters pinned/active/audible urls',
  kr.close.length === 1 && kr.close[0].url === 'https://b.com/page/detail');
check('keep: dupe cluster reordered so keep url is first',
  kr.dupes[0][0] === 'https://a.com/');

const coreTabs = [
  { id: 1, url: 'https://github.com/user/repo', pinned: false, active: false, audible: false },
  { id: 2, url: 'https://google.com/search?q=old+stuff', pinned: false, active: false, audible: false, lastAccessed: NOW - 30 * DAY },
];
const krCore = ai.applyKeepRules({
  groups: [],
  dupes: [],
  close: [{ url: 'https://github.com/user/repo', reason: 'x' }, { url: 'https://google.com/search?q=old+stuff', reason: 'y' }],
}, coreTabs);
check('keep: close drops core tab (github repo root), ephemeral survives',
  krCore.close.length === 1 && krCore.close[0].url === 'https://google.com/search?q=old+stuff');

// ---- ai-grouping: mergeGroupsIntoCache ----
let mg = ai.mergeGroupsIntoCache(
  [{ label: 'Work', urls: ['https://a.com/', 'https://b.com/'] }, { label: 'Fun', urls: ['https://c.com/', 'https://d.com/'] }],
  [{ label: 'Work', urls: ['https://e.com/'] }, { label: 'New', urls: ['https://f.com/', 'https://g.com/'] }]);
check('merge: label hit unions urls',
  mg.find(g => g.label === 'Work').urls.join(',') === 'https://a.com/,https://b.com/,https://e.com/');
check('merge: new label appended, old untouched',
  mg.some(g => g.label === 'New') && mg.find(g => g.label === 'Fun').urls.length === 2);

mg = ai.mergeGroupsIntoCache(
  [{ label: 'A', urls: ['u1', 'u2'] }, { label: 'B', urls: ['u3', 'u4'] }],
  [{ label: 'B', urls: ['u1'] }]);
check('merge: fresh claim steals url, shrunk group dropped',
  mg.length === 1 && mg[0].label === 'B' && mg[0].urls.join(',') === 'u3,u4,u1');

// ---- ai-grouping: buildGrouperPayload ----
const bp = ai.buildGrouperPayload([
  { id: 1, title: 't1', url: 'https://a.com/', pinned: true, lastAccessed: 1000 },
  { id: 2, title: 't2', url: 'https://b.com/', lastAccessed: 1000 },
], [{ label: 'Old', urls: ['https://b.com/'] }], 1000 + 2 * DAY);
check('payload: keep flag on pinned only',
  bp.payload[0].keep === true && bp.payload[1].keep === undefined);
check('payload: grouped flag from cache urls',
  bp.payload[1].grouped === true && bp.payload[0].grouped === undefined);
check('payload: age in whole days', bp.payload[0].age === 2 && bp.payload[1].age === 2);
check('payload: existing labels listed in prompt', bp.systemPrompt.includes('"Old"'));

const bpFull = ai.buildGrouperPayload([{ id: 1, title: 't', url: 'https://a.com/' }], [], 1000);
check('payload: full mode has no labels line', !bpFull.systemPrompt.includes('Reuse an existing label'));

const bpQuery = ai.buildGrouperPayload([{ id: 1, title: 't', url: 'https://a.com/x?path=/b/c/d' }], [], 1000);
check('payload: pathDepth counted from pathname, not query-string slashes',
  bpQuery.payload[0].pathDepth === 1);

const bpZh = ai.buildGrouperPayload([{ id: 1, title: 't', url: 'https://a.com/' }], [], 1000, 'zh');
check('payload: labelLang zh pins labels to Simplified Chinese', bpZh.systemPrompt.includes('简体中文'));
const bpEn = ai.buildGrouperPayload([{ id: 1, title: 't', url: 'https://a.com/' }], [], 1000, 'en');
check('payload: labelLang en pins labels to English', bpEn.systemPrompt.includes('in English.'));
check('payload: no labelLang falls back to dominant language',
  bpFull.systemPrompt.includes('dominant language'));

check('trimUrl: hash stripped',
  ai.trimUrlForPrompt('https://a.com/p?q=1#frag') === 'https://a.com/p?q=1');
check('trimUrl: long query truncated to 60 chars',
  ai.trimUrlForPrompt('https://a.com/p?' + 'x'.repeat(200)).length <= 'https://a.com/p?'.length + 61);

// ---- ai-grouping: extractResponseText ----
check('extract: anthropic text block',
  ai.extractResponseText('anthropic', { content: [{ type: 'text', text: '{"groups":[]}' }] }) === '{"groups":[]}');
check('extract: thinking blocks skipped, all text blocks joined',
  ai.extractResponseText('anthropic', { content: [
    { type: 'thinking', thinking: 'hmm' },
    { type: 'text', text: 'a' },
    { type: 'text', text: 'b' },
  ] }) === 'a\nb');
check('extract: string content tolerated (proxies)',
  ai.extractResponseText('anthropic', { content: 'plain' }) === 'plain');
check('extract: openai choice content',
  ai.extractResponseText('openai', { choices: [{ message: { content: 'x' } }] }) === 'x');
check('extract: empty/malformed → empty string',
  ai.extractResponseText('anthropic', { content: [] }) === ''
  && ai.extractResponseText('anthropic', {}) === ''
  && ai.extractResponseText('openai', {}) === '');

const apiEq = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
check('api: openai chat url passes through, sibling /models',
  apiEq(ai.resolveApiEndpoints('https://api.openai.com/v1/chat/completions'),
    { format: 'openai', chatUrl: 'https://api.openai.com/v1/chat/completions', modelsUrl: 'https://api.openai.com/v1/models' }));
check('api: anthropic base → /v1/messages',
  apiEq(ai.resolveApiEndpoints('https://api.anthropic.com'),
    { format: 'anthropic', chatUrl: 'https://api.anthropic.com/v1/messages', modelsUrl: 'https://api.anthropic.com/v1/models' }));
check('api: anthropic base with /v1 → no double v1',
  apiEq(ai.resolveApiEndpoints('https://api.anthropic.com/v1'),
    { format: 'anthropic', chatUrl: 'https://api.anthropic.com/v1/messages', modelsUrl: 'https://api.anthropic.com/v1/models' }));
check('api: deepseek anthropic proxy (models on openai root, bearer auth)',
  apiEq(ai.resolveApiEndpoints('https://api.deepseek.com/anthropic'),
    { format: 'anthropic', chatUrl: 'https://api.deepseek.com/anthropic/v1/messages', modelsUrl: 'https://api.deepseek.com/v1/models', modelsAuth: 'bearer' }));
check('api: /messages suffix → anthropic, sibling /models',
  apiEq(ai.resolveApiEndpoints('https://proxy.example.com/v1/messages'),
    { format: 'anthropic', chatUrl: 'https://proxy.example.com/v1/messages', modelsUrl: 'https://proxy.example.com/v1/models' }));
check('api: bare openai base → /chat/completions appended',
  apiEq(ai.resolveApiEndpoints('http://localhost:8000/v1'),
    { format: 'openai', chatUrl: 'http://localhost:8000/v1/chat/completions', modelsUrl: 'http://localhost:8000/v1/models' }));
check('api: trailing slashes stripped',
  apiEq(ai.resolveApiEndpoints('https://api.openai.com/v1/chat/completions/'),
    { format: 'openai', chatUrl: 'https://api.openai.com/v1/chat/completions', modelsUrl: 'https://api.openai.com/v1/models' }));
check('api: empty → null', ai.resolveApiEndpoints('') === null);

// ---- grouping: mapCachedGroupsToTabs ----
const grp = loadModule('grouping.js', '({ mapCachedGroupsToTabs, mapCachedDupesToTabs })');

const liveTabs = [
  { id: 101, url: 'https://github.com/a' },
  { id: 102, url: 'https://stackoverflow.com/b' },
  { id: 103, url: 'https://x.com/c' },
  { id: 104, url: 'https://x.com/c' }, // same URL open twice
];

let mapped = grp.mapCachedGroupsToTabs(liveTabs, [
  { label: 'Debug auth', urls: ['https://github.com/a', 'https://stackoverflow.com/b'] },
]);
check('map: urls map to live tab ids',
  mapped.length === 1 && mapped[0].tabIds.join(',') === '101,102');
check('map: label passes through, rootTabId null',
  mapped[0].label === 'Debug auth' && mapped[0].rootTabId === null);

mapped = grp.mapCachedGroupsToTabs(liveTabs, [
  { label: 'Gone', urls: ['https://closed.com/x', 'https://closed.com/y'] },
]);
check('map: group of closed urls dissolves', mapped.length === 0);

mapped = grp.mapCachedGroupsToTabs(liveTabs, [
  { label: 'Dupes', urls: ['https://x.com/c', 'https://x.com/c'] },
]);
check('map: duplicate urls claim distinct tabs',
  mapped.length === 1 && mapped[0].tabIds.join(',') === '103,104');

mapped = grp.mapCachedGroupsToTabs(liveTabs, [
  { label: 'Partial', urls: ['https://github.com/a', 'https://closed.com/x'] },
]);
check('map: group shrunk below 2 is dropped', mapped.length === 0);

let dm = grp.mapCachedDupesToTabs(liveTabs, [['https://github.com/a', 'https://stackoverflow.com/b']]);
check('dupes: cluster maps to keep + extras',
  dm.length === 1 && dm[0].keepId === 101 && dm[0].extraIds.join(',') === '102');

dm = grp.mapCachedDupesToTabs(liveTabs, [['https://x.com/c', 'https://x.com/c']]);
check('dupes: duplicate urls claim distinct tabs',
  dm.length === 1 && dm[0].keepId === 103 && dm[0].extraIds.join(',') === '104');

dm = grp.mapCachedDupesToTabs(liveTabs, [['https://github.com/a', 'https://closed.com/x']]);
check('dupes: cluster shrunk below 2 dissolves', dm.length === 0);

// ---- sweep: nextSweepTime ----
check('sweepTime: empty → null',      sweep.nextSweepTime('') === null);
check('sweepTime: undefined → null',  sweep.nextSweepTime(undefined) === null);
check('sweepTime: garbage → null',    sweep.nextSweepTime('abc') === null);
const soon = new Date(Date.now() + 60 * 60 * 1000);
const soonHHMM = `${soon.getHours()}:${String(soon.getMinutes()).padStart(2, '0')}`;
const atSoon = sweep.nextSweepTime(soonHHMM);
check('sweepTime: valid HH:MM → future timestamp within 24h',
  typeof atSoon === 'number' && atSoon > Date.now() && atSoon <= Date.now() + DAY);
check('sweepTime: keeps the requested clock time',
  new Date(atSoon).getHours() === soon.getHours() && new Date(atSoon).getMinutes() === soon.getMinutes());
const past = new Date(Date.now() - 60 * 60 * 1000);
const pastHHMM = `${past.getHours()}:${String(past.getMinutes()).padStart(2, '0')}`;
const atPast = sweep.nextSweepTime(pastHHMM);
check('sweepTime: past clock time → next occurrence (future, ≤24h)',
  typeof atPast === 'number' && atPast > Date.now() && atPast <= Date.now() + DAY);

// ---- i18n ----
const i18n = loadModule('i18n.js', '({ I18N, pickLang, setLang, currentLang, t })');

check('i18n: pickLang zh variants', i18n.pickLang('zh-CN') === 'zh' && i18n.pickLang('zh') === 'zh' && i18n.pickLang('zh-TW') === 'zh');
check('i18n: pickLang non-zh → en', i18n.pickLang('en-US') === 'en' && i18n.pickLang('') === 'en' && i18n.pickLang(undefined) === 'en');
check('i18n: setLang normalizes', (i18n.setLang('zh'), i18n.currentLang()) === 'zh' && (i18n.setLang('fr'), i18n.currentLang()) === 'en');

i18n.setLang('en');
check('i18n: t en lookup', i18n.t('cmdSmartGroup') === '> Smart group');
check('i18n: t interpolation', i18n.t('cmdCloseAll', { n: 7 }) === '> Close all 7');
check('i18n: t plural var', i18n.t('tabsCount', { n: 1, s: '' }) === '1 tab' && i18n.t('itemsCount', { n: 3, s: 's' }) === '3 items');
i18n.setLang('zh');
check('i18n: t zh lookup', i18n.t('cmdSmartGroup') === '> 智能分组');
check('i18n: t zh interpolation', i18n.t('cmdCloseAll', { n: 7 }) === '> 关闭全部 7');
check('i18n: unknown key falls back to en then key',
  i18n.t('tabsCount', { n: 2, s: 's' }) === '2 个标签' && i18n.t('no-such-key') === 'no-such-key');
i18n.setLang('en');

// dictionary parity: every en key exists in zh and vice versa
const enKeys = Object.keys(i18n.I18N.en).sort().join(',');
const zhKeys = Object.keys(i18n.I18N.zh).sort().join(',');
check('i18n: en/zh key parity', enKeys === zhKeys);

// ---- classifyUrlType ----
check('classify: google search → search',    ai.classifyUrlType('https://google.com/search?q=test', '') === 'search');
check('classify: github repo root → root',    ai.classifyUrlType('https://github.com/user/repo', '') === 'root');
check('classify: github issues list → list',  ai.classifyUrlType('https://github.com/user/repo/issues', '') === 'list');
check('classify: github issue detail → detail', ai.classifyUrlType('https://github.com/user/repo/issues/42', '') === 'detail');
check('classify: github code blob → code',    ai.classifyUrlType('https://github.com/user/repo/blob/main/file.js', '') === 'code');
check('classify: MDN → doc',                  ai.classifyUrlType('https://developer.mozilla.org/en-US/docs/Web', '') === 'doc');
check('classify: stackoverflow → doc',        ai.classifyUrlType('https://stackoverflow.com/questions/123', '') === 'doc');
check('classify: reddit feed → social',       ai.classifyUrlType('https://reddit.com/r/programming', '') === 'social');
check('classify: x/twitter home → social',    ai.classifyUrlType('https://x.com/home', '') === 'social');
check('classify: root path → root',           ai.classifyUrlType('https://example.com/', '') === 'root');
check('classify: deep path → detail',         ai.classifyUrlType('https://example.com/a/b/c/d', '') === 'detail');
check('classify: malformed → detail fallback', ai.classifyUrlType('invalid-url', '') === 'detail');

// ---- buildOpenerGraph ----
{
  const tabs = [
    {id: 1, openerTabId: undefined}, // orphan
    {id: 2, openerTabId: 1},         // 1→2
    {id: 3, openerTabId: 2},         // 1→2→3
    {id: 4, openerTabId: 1},         // 1→4 (sibling of 2)
  ];
  const graph = ai.buildOpenerGraph(tabs);
  check('opener: root has no ancestors', graph.get(1).ancestors.length === 0);
  check('opener: root chainDepth=0', graph.get(1).chainDepth === 0);
  check('opener: root has 2 children', graph.get(1).descendants.length === 2);
  check('opener: leaf has 2 ancestors', graph.get(3).ancestors.length === 2);
  check('opener: leaf ancestor[0]=parent', graph.get(3).ancestors[0] === 2);
  check('opener: leaf ancestor[1]=grandparent', graph.get(3).ancestors[1] === 1);
  check('opener: leaf chainDepth=2', graph.get(3).chainDepth === 2);
  check('opener: leaf has no descendants', graph.get(3).descendants.length === 0);
}

// Cycle guard
{
  const tabs = [
    {id: 1, openerTabId: 2},
    {id: 2, openerTabId: 1},
  ];
  const graph = ai.buildOpenerGraph(tabs);
  check('opener: cycle detected, ancestors stopped', graph.get(1).ancestors.length === 1);
  check('opener: cycle symmetric', graph.get(2).ancestors.length === 1);
}

// Orphan tab
{
  const tabs = [{id: 1, openerTabId: undefined}];
  const graph = ai.buildOpenerGraph(tabs);
  check('opener: orphan has no ancestors', graph.get(1).ancestors.length === 0);
  check('opener: orphan chainDepth=0', graph.get(1).chainDepth === 0);
}

// ---- ai-grouping: clusterByTime ----
{
  const now = Date.now();
  const tabs = [
    {id: 1, lastAccessed: now - 60 * 60 * 1000},        // 1 hour ago
    {id: 2, lastAccessed: now - 50 * 60 * 1000},        // 50 min ago (same cluster as 1)
    {id: 3, lastAccessed: now - 10 * 60 * 1000},        // 10 min ago (new cluster)
    {id: 4, lastAccessed: now - 5 * 60 * 1000},         // 5 min ago (same cluster as 3)
  ];
  const clusters = ai.clusterByTime(tabs, 30);
  check('time: tabs within 30min share cluster', clusters.get(1) === clusters.get(2));
  check('time: recent tabs clustered together', clusters.get(3) === clusters.get(4));
  check('time: 40min gap creates new cluster', clusters.get(1) !== clusters.get(3));
  check('time: cluster ID format tc_NNN', /^tc_\d{3}$/.test(clusters.get(1)));
}

// Fallback to id when lastAccessed missing
{
  const tabs = [
    {id: 100, lastAccessed: undefined},
    {id: 200, lastAccessed: undefined},
  ];
  const clusters = ai.clusterByTime(tabs, 30);
  check('time: missing lastAccessed falls back to id', clusters.get(100) !== undefined);
  check('time: all tabs get a cluster', clusters.get(200) !== undefined);
}

// ---- ai-grouping: calculateTabImportance ----
{
  const tabs = [
    {id: 1, url: 'https://github.com/user/repo', title: 'Repo', pinned: false, openerTabId: undefined},
    {id: 2, url: 'https://google.com/search?q=test', title: 'Search', pinned: false, openerTabId: 1},
    {id: 3, url: 'https://developer.mozilla.org/docs', title: 'MDN', pinned: false, openerTabId: 1},
    {id: 4, url: 'https://example.com/article', title: 'Article', pinned: true, openerTabId: undefined},
    {id: 5, url: 'https://reddit.com/r/programming', title: 'Reddit', pinned: false, openerTabId: undefined},
  ];
  const graph = ai.buildOpenerGraph(tabs);

  check('importance: repo root → core', ai.calculateTabImportance(tabs[0], graph, tabs) === 'core');
  check('importance: search → ephemeral', ai.calculateTabImportance(tabs[1], graph, tabs) === 'ephemeral');
  check('importance: doc → core', ai.calculateTabImportance(tabs[2], graph, tabs) === 'core');
  check('importance: pinned → core', ai.calculateTabImportance(tabs[3], graph, tabs) === 'core');
  check('importance: social feed → ephemeral', ai.calculateTabImportance(tabs[4], graph, tabs) === 'ephemeral');
}

// Hub tab (referenced by multiple tabs)
{
  const tabs = [
    {id: 1, url: 'https://example.com/hub', title: 'Hub', pinned: false, openerTabId: undefined},
    {id: 2, url: 'https://example.com/a', title: 'A', pinned: false, openerTabId: 1},
    {id: 3, url: 'https://example.com/b', title: 'B', pinned: false, openerTabId: 1},
    {id: 4, url: 'https://example.com/c', title: 'C', pinned: false, openerTabId: 1},
  ];
  const graph = ai.buildOpenerGraph(tabs);
  check('importance: hub with 3 descendants → core', ai.calculateTabImportance(tabs[0], graph, tabs) === 'core');
}

// List page with no descendants
{
  const tabs = [
    {id: 1, url: 'https://github.com/user/repo/issues', title: 'Issues', pinned: false, openerTabId: undefined},
  ];
  const graph = ai.buildOpenerGraph(tabs);
  check('importance: list page with no children → ephemeral', ai.calculateTabImportance(tabs[0], graph, tabs) === 'ephemeral');
}

// ---- ai-grouping: buildGrouperPayload integration test ----
{
  const tabs = [
    {id: 1, url: 'https://github.com/user/repo', title: 'Repo', pinned: false, active: false, audible: false,
     openerTabId: undefined, windowId: 1, groupId: -1, lastAccessed: Date.now() - 5 * 86400000},
    {id: 2, url: 'https://google.com/search?q=test', title: 'Search', pinned: false, active: false, audible: false,
     openerTabId: 1, windowId: 1, groupId: -1, lastAccessed: Date.now() - 1000},
  ];
  const { payload, systemPrompt } = ai.buildGrouperPayload(tabs, [], Date.now());

  check('payload: 2 entries', payload.length === 2);
  check('payload: tab 1 urlType=root', payload[0].urlType === 'root');
  check('payload: tab 1 importance=core', payload[0].importance === 'core');
  check('payload: tab 1 openerChain=0', payload[0].openerChain === 0);
  check('payload: tab 1 has descendants', payload[0].hasDescendants === true);
  check('payload: tab 1 has timeCluster', typeof payload[0].timeCluster === 'string');
  check('payload: tab 1 windowId=1', payload[0].windowId === 1);
  check('payload: tab 1 chromeGroup=null (no native group)', payload[0].chromeGroup === null);
  check('payload: tab 1 age=5 days', payload[0].age === 5);

  check('payload: tab 2 urlType=search', payload[1].urlType === 'search');
  check('payload: tab 2 importance=ephemeral', payload[1].importance === 'ephemeral');
  check('payload: tab 2 openerChain=1', payload[1].openerChain === 1);
  check('payload: tab 2 no descendants', payload[1].hasDescendants === false);

  check('payload: system prompt mentions urlType', systemPrompt.includes('urlType'));
  check('payload: system prompt mentions importance', systemPrompt.includes('importance'));
}

if (failures > 0) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('selfcheck OK');
