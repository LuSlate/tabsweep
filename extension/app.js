/* ================================================================
   TabSweep — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify dashboard's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      groupId:  t.groupId,   // -1 when not in a native tab group
      openerTabId: t.openerTabId,   // which tab this one was opened from (session-scoped)
      active:   t.active,
      pinned:   t.pinned,
      audible:  t.audible,              // media playing — never auto-closed
      lastAccessed: t.lastAccessed,   // ms epoch; undefined before Chrome 121
      // Flag dashboard's own pages so we can detect duplicate new tabs
      isDashboard: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeDashboardDupes()
 *
 * Closes all duplicate dashboard new-tab pages except the current one.
 */
async function closeDashboardDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const dashboardTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (dashboardTabs.length <= 1) return;

  // Keep the active dashboard tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    dashboardTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    dashboardTabs.find(t => t.active) ||
    dashboardTabs[0];
  const toClose = dashboardTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * groupTabsInChrome()
 *
 * Projects dashboard's domain groups onto Chrome's native tab groups.
 * - Skips the landing-pages bucket (mixed domains — a native group would be noise).
 * - Skips tabs already in a native group (never disturbs hand-made groups; idempotent).
 * - Native groups can't span windows, so buckets are per (domain group × window),
 *   and only buckets with 2+ tabs become groups.
 */

async function groupTabsInChrome() {
  let tabsGrouped = 0, groupsMade = 0;

  for (const group of domainGroups) {
    if (group.domain === '__landing-pages__' || group.domain.startsWith('__task-')) continue;

    // Bucket this group's ungrouped tabs by window (native groups are per-window)
    const byWindow = {};
    for (const tab of group.tabs) {
      if (tab.groupId !== -1) continue; // already in a native group — leave it
      (byWindow[tab.windowId] ||= []).push(tab.id);
    }

    const title = group.label || friendlyDomain(group.domain);
    for (const tabIds of Object.values(byWindow)) {
      if (tabIds.length < 2) continue; // grouping one tab is just noise
      try {
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, {
          title,
          color: TAB_GROUP_COLORS[groupsMade % TAB_GROUP_COLORS.length],
        });
        tabsGrouped += tabIds.length;
        groupsMade++;
      } catch {
        // Tab/window vanished mid-flight — skip this bucket, keep going
      }
    }
  }

  showToast(groupsMade > 0
    ? t('toastGrouped', { n: tabsGrouped, m: groupsMade, s: groupsMade !== 1 ? 's' : '' })
    : t('toastNothingGroup'));
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#000000',
    '#666666',
    '#0000ee',
    '#bbbbbb',
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a group section: fade + scale down, then confetti.
 * After the animation, checks if the index is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

/* ----------------------------------------------------------------
   SETTINGS — AI grouping + auto-close configuration
   ---------------------------------------------------------------- */

const AI_GROUPING_DEFAULTS = {
  endpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  auto: false,   // background aiAuto alarm every 30 min (background.js) when enabled
};

async function getAiGroupingSettings() {
  const { aiGrouping } = await chrome.storage.local.get('aiGrouping');
  return { ...AI_GROUPING_DEFAULTS, ...(aiGrouping || {}) };
}

async function getAutoCloseSettings() {
  const { autoClose } = await chrome.storage.local.get('autoClose');
  return { ...AUTO_CLOSE_DEFAULTS, ...(autoClose || {}) }; // AUTO_CLOSE_DEFAULTS lives in sweep.js
}

async function populateSettingsPanel() {
  const [ai, ac] = await Promise.all([getAiGroupingSettings(), getAutoCloseSettings()]);
  document.getElementById('setAiEndpoint').value       = ai.endpoint;
  document.getElementById('setAiKey').value            = ai.apiKey;
  document.getElementById('setAiModel').value          = ai.model;
  document.getElementById('setAiAuto').checked         = ai.auto === true;
  document.getElementById('setAutoCloseEnabled').checked = ac.enabled;
  document.getElementById('setIntervalMin').value      = ac.intervalMin;
  document.getElementById('setTabStaleDays').value     = ac.tabStaleDays;
  document.getElementById('setGroupStaleDays').value   = ac.groupStaleDays;
  document.getElementById('setSweepTime').value        = ac.sweepTime || '';
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const groupsEl = document.getElementById('openTabsGroups');
  if (!groupsEl) return;

  const remaining = groupsEl.querySelectorAll('.group:not(.closing)').length;
  if (remaining > 0) return;

  groupsEl.innerHTML = `
    <div class="allclear">
      <strong>${t('allClear')}</strong>
      ${t('noOpenTabs')}
    </div>`;
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return t('justNow');
  if (diffMins < 60)  return t('minAgo', { n: diffMins });
  if (diffHours < 24) return t('hrsAgo', { n: diffHours, s: diffHours !== 1 ? 's' : '' });
  if (diffDays === 1) return t('yesterday');
  return t('daysAgo', { n: diffDays });
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString(currentLang() === 'zh' ? 'zh-CN' : 'en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '', params = null;
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; params = u.searchParams; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  // Google search pages (any region): unloaded tabs have no title, so the
  // raw URL would leak onto the chip — show the search query instead.
  if (canonicalHostname(hostname) === 'www.google.com' && params) {
    const q = params.get('q');
    if (q && titleIsUrl) return q;
  }

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return t('youtubeVideo');
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}



/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}



/* ----------------------------------------------------------------
   STALE TABS — tabs untouched past the threshold get flagged
   ---------------------------------------------------------------- */

// Staleness itself lives in sweep.js (shared with the background
// auto-sweep); the dashboard passes the threshold in. The threshold is
// swapped for the autoClose setting once settings load
// (renderStaticDashboard).
let currentStaleMs = DAY_MS;

/**
 * sweepStaleTabs()
 *
 * Archives every stale tab into the Saved-for-Later archive
 * (completed: true keeps them out of the active checklist),
 * then closes them.
 */
async function sweepStaleTabs() {
  const staleTabs = getRealTabs().filter(t => isStaleTab(t, currentStaleMs));
  if (staleTabs.length === 0) return;

  await archiveAndClose(staleTabs);
  await fetchOpenTabs();

  playCloseSound();
  showToast(t('toastSwept', { n: staleTabs.length, s: staleTabs.length !== 1 ? 's' : '' }));
  renderStaticDashboard();
}


/* ----------------------------------------------------------------
   WORKSPACES — stash a whole card, restore it as a native tab group
   ---------------------------------------------------------------- */

/**
 * getWorkspaces()
 *
 * Returns the stashed workspaces from chrome.storage.local.
 */
async function getWorkspaces() {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  return workspaces;
}

/**
 * stashGroup(group)
 *
 * Snapshots a dashboard group's tabs (deduped by URL) into the
 * `workspaces` list, then closes those tabs with the same exact/by-URL
 * semantics as close-domain-tabs. Returns the workspace name, or null
 * when there was nothing to stash.
 */
async function stashGroup(group) {
  const seen = new Set();
  const tabs = [];
  for (const t of group.tabs) {
    if (!t.url || seen.has(t.url)) continue;
    seen.add(t.url);
    tabs.push({ url: t.url, title: t.title || t.url });
  }
  if (tabs.length === 0) return null;

  const name = group.domain === '__landing-pages__'
    ? t('homepages')
    : (group.label || friendlyDomain(group.domain));

  const workspaces = await getWorkspaces();
  workspaces.push({
    id:      Date.now().toString(),
    name,
    savedAt: new Date().toISOString(),
    tabs,
  });
  await chrome.storage.local.set({ workspaces });

  // Close AFTER the snapshot is safely stored (loss-free ordering)
  const urls     = group.tabs.map(t => t.url);
  const useExact = group.domain === '__landing-pages__' || !!group.label;
  if (useExact) {
    await closeTabsExact(urls);
  } else {
    await closeTabsByUrls(urls);
  }
  return name;
}

/**
 * restoreWorkspace(id)
 *
 * Reopens every tab (unfocused), groups them natively under the
 * workspace name when 2+ opened (matches auto-grouping's threshold),
 * then removes the workspace.
 */
async function restoreWorkspace(id) {
  const workspaces = await getWorkspaces();
  const ws = workspaces.find(w => w.id === id);
  if (!ws) return;

  const created = [];
  for (const t of ws.tabs) {
    try {
      const tab = await chrome.tabs.create({ url: t.url, active: false });
      created.push(tab.id);
    } catch (err) {
      console.error('[tabsweep] Failed to reopen tab:', t.url, err);
    }
  }

  if (created.length >= 2) {
    try {
      const groupId = await chrome.tabs.group({ tabIds: created });
      await chrome.tabGroups.update(groupId, { title: ws.name, color: colorForTitle(ws.name) });
    } catch (err) {
      console.error('[tabsweep] Failed to group restored tabs:', err);
    }
  }

  await chrome.storage.local.set({ workspaces: workspaces.filter(w => w.id !== id) });
  await fetchOpenTabs();
  showToast(t('toastRestored', { n: created.length, s: created.length !== 1 ? 's' : '', name: ws.name }));
  renderStaticDashboard();
}

/**
 * deleteWorkspace(id)
 *
 * Removes a stashed workspace without opening anything.
 */
async function deleteWorkspace(id) {
  const workspaces = await getWorkspaces();
  await chrome.storage.local.set({ workspaces: workspaces.filter(w => w.id !== id) });
  await renderWorkspaces();
  showToast(t('toastWsDeleted'));
}

/**
 * renderWorkspaceCard(ws)
 *
 * One stashed workspace as a mission card: name, saved-time badge,
 * up to 8 plain (non-interactive) chips, Restore/Delete actions.
 */
function renderWorkspaceCard(ws) {
  return `<div class="ws-row" data-workspace-id="${ws.id}">
    <span class="ws-name">${escapeHtml(ws.name)}</span>
    <span class="ws-meta">${t('wsMeta', { n: ws.tabs.length, s: ws.tabs.length !== 1 ? 's' : '', ago: timeAgo(ws.savedAt) })}</span>
    <span class="ws-actions">
      <button class="cmd" data-action="restore-workspace" data-workspace-id="${ws.id}">${t('restore')}</button>
      <button class="cmd danger" data-action="delete-workspace" data-workspace-id="${ws.id}">${t('deleteLabel')}</button>
    </span>
  </div>`;
}

/**
 * renderWorkspaces()
 *
 * Fills the Workspaces section; hides it when there are none.
 */
async function renderWorkspaces() {
  const section  = document.getElementById('workspacesSection');
  const missions = document.getElementById('workspacesList');
  const countEl  = document.getElementById('workspacesCount');
  if (!section || !missions) return;

  const workspaces = await getWorkspaces();
  if (workspaces.length === 0) {
    section.style.display = 'none';
    return;
  }

  if (countEl) countEl.textContent = t('stashedCount', { n: workspaces.length });
  missions.innerHTML = workspaces.map(renderWorkspaceCard).join('');
  section.style.display = 'block';
}


/* ----------------------------------------------------------------
   COMMAND BAR — contextual action row under the top bar
   ---------------------------------------------------------------- */

/**
 * renderCommandBar({ staleN, dashDupeN, aiDupeN, totalN, autoGroupOn })
 *
 * The single row of commands under the top bar. Contextual commands
 * (sweep stale, close extra dashboards) appear only when relevant.
 */
function renderCommandBar({ staleN, dashDupeN, aiDupeN, totalN, autoGroupOn }) {
  const bar = document.getElementById('commandBar');
  if (!bar) return;
  let html = '';
  if (staleN > 0) {
    html += `<button class="cmd" data-action="sweep-stale-tabs">${t('cmdSweep', { n: staleN })}</button>`;
  }
  if (dashDupeN > 1) {
    html += `<button class="cmd" data-action="close-dashboard-dupes">${t('cmdCloseDash', { n: dashDupeN - 1, s: (dashDupeN - 1) !== 1 ? 's' : '' })}</button>`;
  }
  if (aiDupeN > 0) {
    html += `<button class="cmd" data-action="close-ai-dupes">${t('cmdCloseAiDupes', { n: aiDupeN, s: aiDupeN !== 1 ? 's' : '' })}</button>`;
  }
  html += `<button class="cmd" data-action="smart-group">${t('cmdSmartGroup')}</button>
    <button class="cmd" data-action="group-in-chrome">${t('cmdGroupChrome')}</button>
    <label class="cmd auto-toggle"><input type="checkbox" data-action="toggle-auto-group" ${autoGroupOn ? 'checked' : ''}>${t('cmdAuto')}</label>
    <button class="cmd danger" data-action="close-all-open-tabs">${t('cmdCloseAll', { n: totalN })}</button>`;
  bar.innerHTML = html;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * escapeHtml(str)
 *
 * Escapes &, <, > for safe interpolation into innerHTML element content.
 * Used at render sinks for strings that come from page titles or the AI
 * grouping model (attribute contexts use the existing quote-only escapes).
 */
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * renderGroupSection(group, startNum)
 *   → { html: string, emitted: number }
 *
 * One black-band group + globally numbered tab rows. startNum is the
 * count of rows already emitted by earlier groups (0-based); row numbers
 * are 1-based and zero-padded to 3. emitted = rows this group emitted,
 * so the caller chains: startNum += result.emitted.
 */
function renderGroupSection(group, startNum) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls    = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes    = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const cardTitle = isLanding ? t('homepages') : (group.label || friendlyDomain(group.domain));
  const bandTitle = group.domain.startsWith('__task-') ? t('taskDot', { label: cardTitle }) : cardTitle;

  let num = startNum;
  const rowHtml = (tab) => {
    num++;
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count      = urlCounts[tab.url];
    const dupeTag    = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const staleClass = isStaleTab(tab, currentStaleMs) ? ' stale' : '';
    const safeUrl    = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle  = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="trow clickable${staleClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      <span class="tnum">${String(num).padStart(3, '0')}</span>
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${t('saveTabTitle')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action" data-action="close-single-tab" data-tab-url="${safeUrl}" title="${t('closeTabTitle')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  };

  const visibleRows = visibleTabs.map(rowHtml).join('');
  const hiddenRows  = extraCount > 0 ? uniqueTabs.slice(8).map(rowHtml).join('') : '';
  const overflow = extraCount > 0
    ? `<div class="grows-hidden" style="display:none">${hiddenRows}</div>
       <div class="trow trow-overflow clickable" data-action="expand-chips">
         <span class="chip-text">${t('moreN', { n: extraCount })}</span>
       </div>`
    : '';

  const dupeUrlsEncoded = hasDupes ? dupeUrls.map(([url]) => encodeURIComponent(url)).join(',') : '';
  const bandActions = `
    ${hasDupes ? `<button class="cmd" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">${t('dedupN', { n: totalExtras })}</button>` : ''}
    <button class="cmd" data-action="stash-group" data-domain-id="${stableId}" title="${t('stashTitle')}">${t('stash')}</button>
    <button class="cmd" data-action="close-domain-tabs" data-domain-id="${stableId}">${t('closeN', { n: tabCount })}</button>`;

  const html = `<section class="group" data-domain-id="${stableId}">
    <div class="band">
      <span class="band-title">${escapeHtml(bandTitle)}</span>
      <span class="band-right">
        <span class="band-actions">${bandActions}</span>
        <span class="band-count">${tabCount}</span>
      </span>
    </div>
    <div class="grows">${visibleRows}${overflow}</div>
  </section>`;

  return { html, emitted: num - startNum };
}

/**
 * renderAiSweepSection(items, realTabs, startNum)
 *   → { html: string, emitted: number }
 *
 * The AI-sweep review band: one checkbox row per close suggestion that
 * still maps to a live tab (first free tab per url wins). Rows do NOT
 * navigate — clicking toggles the checkbox (checked = will close).
 * Numbers chain into the global row numbering via startNum, same
 * contract as renderGroupSection. All model text goes through escapeHtml.
 */
function renderAiSweepSection(items, realTabs, startNum) {
  const idsByUrl = new Map();
  for (const t of realTabs) {
    if (!idsByUrl.has(t.url)) idsByUrl.set(t.url, []);
    idsByUrl.get(t.url).push(t);
  }
  const used = new Set();
  const rows = [];
  let num = startNum;
  for (const item of items || []) {
    const tab = (idsByUrl.get(item.url) || []).find(t => !used.has(t.id));
    if (!tab) continue;
    used.add(tab.id);
    num++;
    const safeUrl = String(item.url).replace(/"/g, '&quot;');
    const reason = item.reason ? ` <span class="sweep-reason">${escapeHtml(item.reason)}</span>` : '';
    rows.push(`<div class="trow sweep-row" data-action="ai-sweep-toggle">
      <span class="tnum">${String(num).padStart(3, '0')}</span>
      <input type="checkbox" class="sweep-checkbox" data-tab-url="${safeUrl}" checked>
      <span class="chip-text">${escapeHtml(tab.title || item.title || item.url)}</span>${reason}
    </div>`);
  }
  if (rows.length === 0) return { html: '', emitted: 0 };
  const html = `<section class="group" id="aiSweepSection">
    <div class="band">
      <span class="band-title">${t('aiSweepBand', { n: rows.length })}</span>
      <span class="band-right">
        <span class="band-actions">
          <button class="cmd" data-action="ai-sweep-confirm">${t('closeSelected')}</button>
          <button class="cmd" data-action="ai-sweep-dismiss">${t('dismiss')}</button>
        </span>
        <span class="band-count">${rows.length}</span>
      </span>
    </div>
    <div class="grows">${rows.join('')}</div>
  </section>`;
  return { html, emitted: rows.length };
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = t('itemsCount', { n: active.length, s: active.length !== 1 ? 's' : '' });
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tabsweep] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.savedAt);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${item.title || item.url}
        </a>
        <div class="deferred-meta">
          <span>${domain}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="${t('dismiss')}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item">
      <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        ${item.title || item.url}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints date + total count
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Header ---
  const dateEl = document.getElementById('dateDisplay');
  if (dateEl) dateEl.textContent = getDateDisplay();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();
  const totalEl = document.getElementById('totalCount');
  if (totalEl) totalEl.textContent = t('tabsCount', { n: realTabs.length, s: realTabs.length !== 1 ? 's' : '' });

  // Stale threshold follows the autoClose setting (single source of truth
  // shared by the banner, the chip dimming, and the background alarm)
  const autoCloseCfg = await getAutoCloseSettings();
  currentStaleMs = autoCloseCfg.tabStaleDays * DAY_MS;

  // Auto-grouping flag (absent = on) — drives the "Auto" toggle in the header
  const { autoGroup: autoGroupOn = true } = await chrome.storage.local.get('autoGroup');

  // --- Task chains first: tabs opened from one another form a task card ---
  const taskGroups = await computeTaskGroups(realTabs);
  const claimedIds = new Set(taskGroups.flatMap(g => g.tabIds));

  // --- Group tabs by domain ---

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  for (const tab of realTabs) {
    try {
      if (claimedIds.has(tab.id)) continue; // rendered inside a task card instead

      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        // Regional variants of the same service (google.com.hk …) share a card
        hostname = canonicalHostname(new URL(tab.url).hostname);
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Inject one synthetic labeled group per task chain. Labeled groups get the
  // custom-card look and exact-URL close semantics for free (see useExact).
  const tabById = new Map(realTabs.map(t => [t.id, t]));
  taskGroups.forEach((tg, i) => {
    const tabs = tg.tabIds.map(id => tabById.get(id)).filter(Boolean);
    if (tabs.length === 0) return;
    const root = tg.rootTabId != null ? tabById.get(tg.rootTabId) : null;
    const label = tg.label ||
      (root ? cleanTitle(smartTitle(stripTitleNoise(root.title || ''), root.url), '') : '') ||
      t('taskTabs', { n: tabs.length, s: tabs.length !== 1 ? 's' : '' });
    groupMap[`__task-${i}__`] = { domain: `__task-${i}__`, label, tabs };
  });

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsTask = a.domain.startsWith('__task-');
    const bIsTask = b.domain.startsWith('__task-');
    if (aIsTask !== bIsTask) return aIsTask ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Render AI sweep band + domain groups (sweep band takes the first numbers) ---
  const { aiSweepSuggestions } = await chrome.storage.local.get('aiSweepSuggestions');
  const groupsEl = document.getElementById('openTabsGroups');
  if (groupsEl && domainGroups.length > 0) {
    const sweep = renderAiSweepSection(aiSweepSuggestions && aiSweepSuggestions.items, realTabs, 0);
    let startNum = sweep.emitted;
    groupsEl.innerHTML = sweep.html + domainGroups.map(g => {
      const r = renderGroupSection(g, startNum);
      startNum += r.emitted;
      return r.html;
    }).join('');
  } else if (groupsEl) {
    checkAndShowEmptyState();
  }

  // --- Command bar ---
  const staleN   = realTabs.filter(t => isStaleTab(t, currentStaleMs)).length;
  const dashDupeN = openTabs.filter(t => t.isDashboard).length;
  const { aiGroupCache } = await chrome.storage.local.get('aiGroupCache');
  const aiDupeN = mapCachedDupesToTabs(realTabs, aiGroupCache && aiGroupCache.dupes)
    .reduce((n, c) => n + c.extraIds.length, 0);
  renderCommandBar({ staleN, dashDupeN, aiDupeN, totalN: realTabs.length, autoGroupOn });

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Auto-sweep notice (written by the background alarm, Task 6) ---
  const { lastSweep, lastSweepSeen } = await chrome.storage.local.get(['lastSweep', 'lastSweepSeen']);
  if (lastSweep && lastSweep.at && lastSweep.at !== lastSweepSeen) {
    showToast(t('toastAutoSwept', { n: lastSweep.count, s: lastSweep.count !== 1 ? 's' : '' }));
    await chrome.storage.local.set({ lastSweepSeen: lastSweep.at });
  }

  // --- AI tick notice (written by runAiTick; shown once) ---
  const { lastAiTick, lastAiTickSeen } = await chrome.storage.local.get(['lastAiTick', 'lastAiTickSeen']);
  if (lastAiTick && lastAiTick.at && lastAiTick.at !== lastAiTickSeen) {
    showToast(t('toastAiTick', { g: lastAiTick.groups, d: lastAiTick.dupes, c: lastAiTick.close }));
    await chrome.storage.local.set({ lastAiTickSeen: lastAiTick.at });
  }

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();

  // --- Render stashed workspaces ---
  await renderWorkspaces();
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Close duplicate dashboard tabs ----
  if (action === 'close-dashboard-dupes') {
    await closeDashboardDupes();
    playCloseSound();
    showToast(t('toastDashClosed'));
    renderStaticDashboard();
    return;
  }

  // ---- Group tabs into Chrome native tab groups ----
  if (action === 'group-in-chrome') {
    await groupTabsInChrome();
    return;
  }

  // ---- Toggle background auto-grouping ----
  if (action === 'toggle-auto-group') {
    await chrome.storage.local.set({ autoGroup: actionEl.checked });
    showToast(actionEl.checked ? t('toastAutoGroupOn') : t('toastAutoGroupOff'));
    return;
  }

  // ---- Toggle the settings panel ----
  if (action === 'toggle-settings') {
    const panel = document.getElementById('settingsPanel');
    if (!panel) return;
    const opening = panel.style.display === 'none';
    if (opening) await populateSettingsPanel();
    panel.style.display = opening ? 'block' : 'none';
    return;
  }

  // ---- Language toggle (topbar 中/EN button) ----
  if (action === 'toggle-lang') {
    await toggleLang();
    await renderStaticDashboard();
    return;
  }

  // ---- Test AI endpoint connection + auto-detect models ----
  if (action === 'test-connection') {
    const settings = {
      endpoint: document.getElementById('setAiEndpoint').value.trim() || AI_GROUPING_DEFAULTS.endpoint,
      apiKey:   document.getElementById('setAiKey').value.trim(),
    };
    if (!settings.apiKey) { showToast(t('toastEnterKey')); return; }
    actionEl.disabled = true;
    actionEl.textContent = t('testing');
    try {
      let models = null;
      try {
        models = await listModels(settings);
      } catch {
        // Some endpoints (e.g. deepseek/anthropic proxy) have no /models
        // listing — fall back to a 1-token chat probe. Its error, if any,
        // is the meaningful one (bad key / bad URL / provider message).
        const model = document.getElementById('setAiModel').value.trim() || AI_GROUPING_DEFAULTS.model;
        await probeChatEndpoint({ ...settings, model });
      }
      if (models) {
        document.getElementById('modelList').innerHTML =
          models.map(m => `<option value="${escapeHtml(m)}">`).join('');
        showToast(t('toastConnModels', { n: models.length, s: models.length !== 1 ? 's' : '' }));
      } else {
        showToast(t('toastConnNoList'));
      }
    } catch (err) {
      console.error('[tabsweep] test connection failed:', err);
      showToast(t('toastConnFailed', { msg: err.message }));
    }
    actionEl.disabled = false;
    actionEl.textContent = t('testConnection');
    return;
    return;
  }

  // ---- Save settings ----
  if (action === 'save-settings') {
    const num = (id, fallback, min) => {
      const v = parseFloat(document.getElementById(id).value);
      return Number.isFinite(v) && v >= min ? v : fallback;
    };
    const current = await getAutoCloseSettings(); // invalid input falls back to current values
    await chrome.storage.local.set({
      aiGrouping: {
        endpoint: document.getElementById('setAiEndpoint').value.trim() || AI_GROUPING_DEFAULTS.endpoint,
        apiKey:   document.getElementById('setAiKey').value.trim(),
        model:    document.getElementById('setAiModel').value.trim() || AI_GROUPING_DEFAULTS.model,
        auto:     document.getElementById('setAiAuto').checked,
      },
      autoClose: {
        enabled:        document.getElementById('setAutoCloseEnabled').checked,
        intervalMin:    Math.max(1, Math.round(num('setIntervalMin', current.intervalMin, 1))),
        tabStaleDays:   num('setTabStaleDays', current.tabStaleDays, 0.0001),
        groupStaleDays: num('setGroupStaleDays', current.groupStaleDays, 0.0001),
        sweepTime:      document.getElementById('setSweepTime').value, // '' = interval mode
      },
    });
    showToast(t('toastSettingsSaved'));
    const ac = await getAutoCloseSettings();
    currentStaleMs = ac.tabStaleDays * DAY_MS;
    renderStaticDashboard(); // refresh the command bar with new stale threshold
    return;
  }

  // ---- Smart group: one AI tick — groups + dupes + close suggestions ----
  if (action === 'smart-group') {
    const settings = await getAiGroupingSettings();
    if (!settings.apiKey) {
      showToast(t('toastNeedKey'));
      return;
    }
    actionEl.disabled = true;
    actionEl.textContent = t('grouping');
    try {
      const result = await runAiTick(settings, { force: true });
      const dupeN = result.dupes.reduce((n, c) => n + c.length - 1, 0);
      showToast(t('toastAiTick', { g: result.groups.length, d: dupeN, c: result.close.length }));
      // We just toasted the outcome — don't let the tick notice repeat it
      const { lastAiTick } = await chrome.storage.local.get('lastAiTick');
      if (lastAiTick) await chrome.storage.local.set({ lastAiTickSeen: lastAiTick.at });
    } catch (err) {
      console.error('[tabsweep] smart group failed:', err);
      showToast(t('toastSmartFailed', { msg: err.message }));
    }
    await renderStaticDashboard();
    return;
  }

  // ---- Re-group all: clear the cache, full (non-incremental) tick ----
  if (action === 'regroup-all') {
    const settings = await getAiGroupingSettings();
    if (!settings.apiKey) {
      showToast(t('toastNeedKey'));
      return;
    }
    actionEl.disabled = true;
    actionEl.textContent = t('regrouping');
    try {
      await chrome.storage.local.remove('aiGroupCache');
      const result = await runAiTick(settings, { force: true });
      showToast(t('toastRegrouped', { n: result.groups.length }));
      const { lastAiTick } = await chrome.storage.local.get('lastAiTick');
      if (lastAiTick) await chrome.storage.local.set({ lastAiTickSeen: lastAiTick.at });
    } catch (err) {
      console.error('[tabsweep] re-group failed:', err);
      showToast(t('toastRegroupFailed', { msg: err.message }));
    }
    await renderStaticDashboard();
    return;
  }

  // ---- Sweep stale tabs into the archive ----
  if (action === 'sweep-stale-tabs') {
    await sweepStaleTabs();
    return;
  }

  const card = actionEl.closest('.group');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.grows-hidden');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.trow');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s linear, transform 0.2s linear';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the group now has no rows, remove it too
        const parentGroup = document.querySelector('.group:has(.grows:empty)');
        if (parentGroup) animateCardOut(parentGroup);
        document.querySelectorAll('.group').forEach(c => {
          if (c.querySelectorAll('.trow[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast(t('toastTabClosed'));
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tabsweep] Failed to save tab:', err);
      showToast(t('toastSaveFailed'));
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    // Animate chip out
    const chip = actionEl.closest('.trow');
    if (chip) {
      chip.style.transition = 'opacity 0.2s linear, transform 0.2s linear';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast(t('toastDeferred'));
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? t('homepages') : (group.label || friendlyDomain(group.domain));
    showToast(t('toastClosedFrom', { n: urls.length, s: urls.length !== 1 ? 's' : '', label: groupLabel }));

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Stash a whole group as a workspace (save + close) ----
  if (action === 'stash-group') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const closedCount = group.tabs.length;
    const name = await stashGroup(group);
    if (!name) return;

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    showToast(t('toastStashed', { n: closedCount, s: closedCount !== 1 ? 's' : '', name }));

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    await renderWorkspaces();
    return;
  }

  // ---- Restore a stashed workspace ----
  if (action === 'restore-workspace') {
    const id = actionEl.dataset.workspaceId;
    if (id) await restoreWorkspace(id);
    return;
  }

  // ---- Delete a stashed workspace ----
  if (action === 'delete-workspace') {
    const id = actionEl.dataset.workspaceId;
    if (id) await deleteWorkspace(id);
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s linear';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the group; update the count badge
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s linear';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      const bandCount = card.querySelector('.band-count');
      if (bandCount) bandCount.textContent = card.querySelectorAll('.trow[data-action="focus-tab"]').length;
    }

    showToast(t('toastDupesClosed'));
    return;
  }

  // ---- Close AI-detected duplicates, keep the first of each cluster ----
  if (action === 'close-ai-dupes') {
    const { aiGroupCache } = await chrome.storage.local.get('aiGroupCache');
    const clusters = mapCachedDupesToTabs(getRealTabs(), aiGroupCache && aiGroupCache.dupes);
    const extraIds = clusters.flatMap(c => c.extraIds);
    const byId = new Map(openTabs.map(t => [t.id, t]));
    const targets = extraIds.map(id => byId.get(id)).filter(Boolean);
    if (targets.length === 0) return;
    await archiveAndClose(targets);
    await fetchOpenTabs();
    playCloseSound();
    showToast(t('toastAiDupesClosed', { n: targets.length, s: targets.length !== 1 ? 's' : '' }));
    renderStaticDashboard();
    return;
  }

  // ---- AI sweep row: toggle its checkbox (row click never navigates) ----
  if (action === 'ai-sweep-toggle') {
    if (e.target.classList && e.target.classList.contains('sweep-checkbox')) return; // native toggle
    const box = actionEl.querySelector('.sweep-checkbox');
    if (box) box.checked = !box.checked;
    return;
  }

  // ---- AI sweep: archive-and-close the checked suggestions ----
  if (action === 'ai-sweep-confirm') {
    const section = actionEl.closest('#aiSweepSection');
    if (!section) return;
    const urls = [...section.querySelectorAll('.sweep-checkbox:checked')]
      .map(b => b.dataset.tabUrl);
    if (urls.length === 0) { showToast(t('toastNothingSelected')); return; }
    const urlSet = new Set(urls);
    const targets = getRealTabs().filter(t => urlSet.has(t.url));
    await archiveAndClose(targets);
    // Prune closed urls; drop the key when nothing remains
    const { aiSweepSuggestions } = await chrome.storage.local.get('aiSweepSuggestions');
    const remaining = ((aiSweepSuggestions && aiSweepSuggestions.items) || [])
      .filter(it => !urlSet.has(it.url));
    if (remaining.length > 0) {
      await chrome.storage.local.set({ aiSweepSuggestions: { items: remaining, ts: Date.now() } });
    } else {
      await chrome.storage.local.remove('aiSweepSuggestions');
    }
    await fetchOpenTabs();
    playCloseSound();
    showToast(t('toastClosedArchived', { n: targets.length, s: targets.length !== 1 ? 's' : '' }));
    renderStaticDashboard();
    return;
  }

  // ---- AI sweep: discard all suggestions ----
  if (action === 'ai-sweep-dismiss') {
    await chrome.storage.local.remove('aiSweepSuggestions');
    renderStaticDashboard();
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsGroups .group').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast(t('toastAllClosed'));
    return;
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || `<div style="font-size:12px;color:var(--muted);padding:8px 0">${t('noResults')}</div>`;
  } catch (err) {
    console.warn('[tabsweep] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
(async () => {
  await initI18n();
  renderDashboard();
})();
