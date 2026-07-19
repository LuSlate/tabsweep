/**
 * grouping.js — Shared grouping knowledge (DOM-free)
 *
 * Loaded by BOTH the dashboard pages (<script> in index.html) and the
 * background service worker (importScripts in background.js), so the
 * dashboard cards and background auto-grouping always agree on which
 * tabs belong together and what the group is called.
 *
 * config.local.js (optional, gitignored) is loaded before this file in
 * both contexts, so LOCAL_LANDING_PAGE_PATTERNS / LOCAL_CUSTOM_GROUPS
 * personal overrides keep working here.
 */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

/**
 * canonicalHostname(hostname)
 *
 * Regional Google search domains (google.com.hk, google.co.jp, google.de …)
 * are all the same service — canonicalize them so grouping keys and friendly
 * names agree across regions instead of splitting into per-region cards.
 * Subdomains (mail.google.com, docs.google.com …) are left alone.
 * ponytail: Google-only; add other multi-region services here if they bite.
 */
function canonicalHostname(hostname) {
  if (/^(www\.)?google(\.com?)?\.[a-z]{2,3}$/.test(hostname)) return 'www.google.com';
  return hostname;
}

function friendlyDomain(hostname) {
  if (!hostname) return '';
  hostname = canonicalHostname(hostname);
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
// so they can be closed together without affecting content tabs on the same domain.
const LANDING_PAGE_PATTERNS = [
  { hostname: 'mail.google.com', test: (p, h) =>
      !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
  { hostname: 'x.com',               pathExact: ['/home'] },
  { hostname: 'www.linkedin.com',    pathExact: ['/'] },
  { hostname: 'github.com',          pathExact: ['/'] },
  { hostname: 'www.youtube.com',     pathExact: ['/'] },
  // Merge personal patterns from config.local.js (if it exists)
  ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
];

function isLandingPage(url) {
  try {
    const parsed = new URL(url);
    return LANDING_PAGE_PATTERNS.some(p => {
      // Support both exact hostname and suffix matching (for wildcard subdomains)
      const hostnameMatch = p.hostname
        ? parsed.hostname === p.hostname
        : p.hostnameEndsWith
          ? parsed.hostname.endsWith(p.hostnameEndsWith)
          : false;
      if (!hostnameMatch) return false;
      if (p.test)       return p.test(parsed.pathname, url);
      if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
      if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
      return parsed.pathname === '/';
    });
  } catch { return false; }
}

// Custom group rules from config.local.js (if any)
const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

// Check if a URL matches a custom group rule; returns the rule or null
function matchCustomGroup(url) {
  try {
    const parsed = new URL(url);
    return customGroups.find(r => {
      const hostMatch = r.hostname
        ? parsed.hostname === r.hostname
        : r.hostnameEndsWith
          ? parsed.hostname.endsWith(r.hostnameEndsWith)
          : false;
      if (!hostMatch) return false;
      if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
      return true; // hostname matched, no path filter
    }) || null;
  } catch { return null; }
}

const TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

/**
 * groupTitleForUrl(url)
 *
 * The single source of truth for "which native group does this URL belong to".
 * Returns the group title, or null when the URL shouldn't be auto-grouped
 * (landing pages get closed, not grouped; unparsable URLs get skipped;
 * file:// URLs have no hostname so they fall out as null too — the
 * dashboard's own 'local-files' bucketing lives in app.js).
 */
function groupTitleForUrl(url) {
  try {
    if (isLandingPage(url)) return null;
    const rule = matchCustomGroup(url);
    if (rule) return rule.groupLabel;
    const hostname = new URL(url).hostname;
    if (!hostname) return null;
    return friendlyDomain(hostname);
  } catch { return null; }
}

/**
 * colorForTitle(title)
 *
 * Stable color per group title (same domain → same color, across sessions).
 */
function colorForTitle(title) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAB_GROUP_COLORS[h % TAB_GROUP_COLORS.length];
}

/* ----------------------------------------------------------------
   TASK-CHAIN GROUPING — tabs opened from one another form a task
   ---------------------------------------------------------------- */

/**
 * computeTaskGroups(tabs)
 *   → Promise<Array<{ label: string|null, rootTabId: number|null, tabIds: number[] }>>
 *
 * tabs: real web tabs [{ id, url, title, openerTabId, ... }].
 * label null → the caller derives one from the root tab's title.
 *
 * Decision order:
 *   1. LOCAL_TASK_GROUPER (config.local.js) — personal seam wins.
 *   2. aiGroupCache (Smart group button result, URL-keyed) — when it
 *      maps to ≥1 live group it IS the task layer; opener chains skip.
 *   3. openerChainClusters — the shipped local default.
 *
 * AI SEAM: define LOCAL_TASK_GROUPER (an async function with this exact
 * signature) in config.local.js and it replaces everything below — an
 * LLM-backed grouper plugs in without touching shipped code.
 */
async function computeTaskGroups(tabs) {
  if (typeof LOCAL_TASK_GROUPER !== 'undefined') return LOCAL_TASK_GROUPER(tabs);
  try {
    const { aiGroupCache } = await chrome.storage.local.get('aiGroupCache');
    if (aiGroupCache && Array.isArray(aiGroupCache.groups)) {
      const mapped = mapCachedGroupsToTabs(tabs, aiGroupCache.groups);
      if (mapped.length > 0) return mapped;
    }
  } catch {
    // chrome.storage unavailable (node selfcheck) — fall through to local
  }
  return openerChainClusters(tabs);
}

/**
 * mapCachedGroupsToTabs(tabs, cachedGroups)
 *   → Array<{ label, rootTabId: null, tabIds }>
 *
 * Maps a URL-keyed AI grouping cache onto live tabs. Cached groups are
 * stored by URL because tab ids die on browser restart; URLs don't.
 * Each cached url claims one live tab with that url (duplicate urls in
 * the cache claim distinct tabs). Closed urls drop out silently; a
 * group that shrinks below 2 live tabs dissolves back into domain
 * cards. Pure — node-testable.
 */
function mapCachedGroupsToTabs(tabs, cachedGroups) {
  const idsByUrl = new Map();
  for (const t of tabs) {
    if (t.id == null) continue;
    if (!idsByUrl.has(t.url)) idsByUrl.set(t.url, []);
    idsByUrl.get(t.url).push(t.id);
  }
  const used = new Set();
  const result = [];
  for (const g of cachedGroups || []) {
    const tabIds = [];
    for (const url of (g.urls || [])) {
      const free = (idsByUrl.get(url) || []).find(id => !used.has(id));
      if (free == null) continue;
      used.add(free);
      tabIds.push(free);
    }
    if (tabIds.length >= 2) result.push({ label: g.label, rootTabId: null, tabIds });
  }
  return result;
}

/**
 * mapCachedDupesToTabs(tabs, cachedDupes)
 *   → Array<{ keepId: number, extraIds: number[] }>
 *
 * Maps URL-keyed AI dupe clusters onto live tabs. Each cached url claims
 * one live tab with that url (duplicate urls claim distinct tabs), same
 * as mapCachedGroupsToTabs. The first url's tab is the copy to keep
 * (applyKeepRules already moved pinned/active/audible to the front);
 * the rest are closable extras. A cluster that shrinks below 2 live
 * tabs dissolves. Pure — node-testable.
 */
function mapCachedDupesToTabs(tabs, cachedDupes) {
  const idsByUrl = new Map();
  for (const t of tabs) {
    if (t.id == null) continue;
    if (!idsByUrl.has(t.url)) idsByUrl.set(t.url, []);
    idsByUrl.get(t.url).push(t.id);
  }
  const used = new Set();
  const result = [];
  for (const cluster of cachedDupes || []) {
    const ids = [];
    for (const url of cluster || []) {
      const free = (idsByUrl.get(url) || []).find(id => !used.has(id));
      if (free == null) continue;
      used.add(free);
      ids.push(free);
    }
    if (ids.length >= 2) result.push({ keepId: ids[0], extraIds: ids.slice(1) });
  }
  return result;
}

/**
 * openerChainClusters(tabs)
 *
 * Union-find over openerTabId edges. A cluster is a task only when it
 * has 3+ tabs spanning 2+ hostnames — single-domain chains are already
 * served by domain cards. openerTabId doesn't survive browser restart,
 * so chains are session-scoped by nature.
 */
function openerChainClusters(tabs) {
  // Landing pages stay in the Homepages bucket — never part of a chain
  const eligible = tabs.filter(t => t.id != null && !isLandingPage(t.url));
  const byId = new Map(eligible.map(t => [t.id, t]));

  // Union-find
  const parent = new Map(eligible.map(t => [t.id, t.id]));
  function find(x) {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x))); // path halving
      x = parent.get(x);
    }
    return x;
  }
  function union(a, b) { parent.set(find(a), find(b)); }

  for (const t of eligible) {
    if (t.openerTabId != null && byId.has(t.openerTabId)) union(t.id, t.openerTabId);
  }

  // Collect clusters
  const clusters = new Map();
  for (const t of eligible) {
    const root = find(t.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(t);
  }

  const result = [];
  for (const members of clusters.values()) {
    if (members.length < 3) continue;
    const hostnames = new Set();
    for (const m of members) {
      try { hostnames.add(new URL(m.url).hostname); } catch {}
    }
    if (hostnames.size < 2) continue;

    const memberIds = new Set(members.map(m => m.id));
    const rootTab = members.find(m => m.openerTabId == null || !memberIds.has(m.openerTabId)) || members[0];
    result.push({ label: null, rootTabId: rootTab.id, tabIds: members.map(m => m.id) });
  }
  return result;
}
