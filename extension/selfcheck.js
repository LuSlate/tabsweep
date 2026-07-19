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
check('stale: missing lastAccessed never stale', sweep.isStaleTab({ ...base, lastAccessed: undefined }, DAY, NOW) === false);
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

// ---- ai-grouping: parseGroupsResponse ----
const ai = loadModule('ai-grouping.js',
  '({ parseGroupsResponse, trimUrlForPrompt, resolveApiEndpoints, AI_GROUP_MAX_TABS })');

const ptabs = [
  { id: 1, url: 'https://github.com/a' },
  { id: 2, url: 'https://stackoverflow.com/b' },
  { id: 3, url: 'https://news.ycombinator.com/c' },
  { id: 4, url: 'https://x.com/d' },
];

let groups = ai.parseGroupsResponse(
  '{"groups":[{"label":"Debug auth","ids":[1,2]},{"label":"News","ids":[3,4]}]}', ptabs);
check('parse: two valid groups', groups.length === 2);
check('parse: label kept',       groups[0].label === 'Debug auth');
check('parse: ids mapped to urls', groups[0].urls.join(',') === 'https://github.com/a,https://stackoverflow.com/b');

groups = ai.parseGroupsResponse(
  '```json\n{"groups":[{"label":"X","ids":[1,99,2]}]}\n```', ptabs);
check('parse: fenced JSON accepted, hallucinated id dropped',
  groups.length === 1 && groups[0].urls.length === 2);

groups = ai.parseGroupsResponse(
  '{"groups":[{"label":"Dup","ids":[1,2]},{"label":"Dup2","ids":[2,3]}]}', ptabs);
check('parse: id claimed by first group only',
  groups.length === 1 && groups[0].label === 'Dup');

groups = ai.parseGroupsResponse(
  '{"groups":[{"label":"Tiny","ids":[1]}]}', ptabs);
check('parse: sub-2 group dropped', groups.length === 0);

groups = ai.parseGroupsResponse(
  '{"groups":[{"label":"Str","ids":["1","2"]}]}', ptabs);
check('parse: string ids coerced', groups.length === 1);

let threw = false;
try { ai.parseGroupsResponse('no json here', ptabs); } catch { threw = true; }
check('parse: garbage content throws', threw);

check('trimUrl: hash stripped',
  ai.trimUrlForPrompt('https://a.com/p?q=1#frag') === 'https://a.com/p?q=1');
check('trimUrl: long query truncated to 60 chars',
  ai.trimUrlForPrompt('https://a.com/p?' + 'x'.repeat(200)).length <= 'https://a.com/p?'.length + 61);

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
check('api: deepseek anthropic proxy',
  apiEq(ai.resolveApiEndpoints('https://api.deepseek.com/anthropic'),
    { format: 'anthropic', chatUrl: 'https://api.deepseek.com/anthropic/v1/messages', modelsUrl: 'https://api.deepseek.com/anthropic/v1/models' }));
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
const grp = loadModule('grouping.js', '({ mapCachedGroupsToTabs })');

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

if (failures > 0) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('selfcheck OK');
