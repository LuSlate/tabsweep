/**
 * background.js — Service Worker for Badge Updates
 *
 * Chrome's "always-on" background script for TabSweep.
 * Its only job: keep the toolbar badge showing the current open tab count.
 *
 * Since we no longer have a server, we query chrome.tabs directly.
 * The badge counts real web tabs (skipping chrome:// and extension pages).
 *
 * Color coding gives a quick at-a-glance health signal:
 *   Green  (#3d7a4a) → 1–10 tabs  (focused, manageable)
 *   Amber  (#b8892e) → 11–20 tabs (getting busy)
 *   Red    (#b35a5a) → 21+ tabs   (time to cull!)
 */

// Shared grouping rules (always shipped with the extension).
// ponytail: personal config.local.js overrides are page-only — importScripts of a
// missing optional file logs "An unknown error occurred when fetching the script"
// on the extension errors page even inside try/catch. If you have a config.local.js
// and want auto-grouping to honor it, add `importScripts('config.local.js')` above
// this line; grouping.js picks the globals up automatically.
importScripts('grouping.js', 'sweep.js', 'ai-grouping.js');

// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge()
 *
 * Counts open real-web tabs and updates the extension's toolbar badge.
 * "Real" tabs = not chrome://, not extension pages, not about:blank.
 */
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    // Only count actual web pages — skip browser internals and extension pages
    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    // Don't show "0" — an empty badge is cleaner
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    // Pick badge color based on workload level
    let color;
    if (count <= 10) {
      color = '#3d7a4a'; // Green — you're in control
    } else if (count <= 20) {
      color = '#b8892e'; // Amber — things are piling up
    } else {
      color = '#b35a5a'; // Red — time to focus and close some tabs
    }

    await chrome.action.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update badge when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
  setupSweepAlarm();
  setupAiAutoAlarm();
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  setupSweepAlarm();
  setupAiAutoAlarm();
});

// Update badge whenever a tab is opened
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

// Update badge when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener(() => {
  updateBadge();
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();

// ─── Open the side panel on keyboard command ──────────────────────────────────
// sidePanel.open() MUST run synchronously in the command callback: the user-gesture
// flag only survives ~1ms (crbug.com/1478648), so any `await` before it drops the
// gesture and Chrome throws "may only be called in response to a user gesture".
// onCommand hands us the active tab directly, so no async window lookup is needed.
// ponytail: open-only for v1; a true open/close toggle needs open-state tracking.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open_side_panel' || !tab) return;
  chrome.sidePanel.open({ windowId: tab.windowId })
    .catch(e => console.error('[TabSweep] sidePanel.open failed:', e));
});

// ─── Auto-grouping ────────────────────────────────────────────────────────────
// Every completed tab load either joins an existing same-title native group in
// its window, or forms a new one once 2+ ungrouped tabs share the title.
// Never touches: non-http(s) URLs, pinned tabs, tabs already in a group,
// landing pages (groupTitleForUrl returns null for those).

let autoGroup = true; // default ON; only an explicit stored `false` disables
chrome.storage.local.get('autoGroup').then(v => { autoGroup = v.autoGroup !== false; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('autoGroup' in changes) {
    autoGroup = changes.autoGroup.newValue !== false;
  }
  if ('autoClose' in changes) {
    setupSweepAlarm(); // interval or enabled flag changed → rebuild the alarm
  }
  if ('aiGrouping' in changes) {
    setupAiAutoAlarm(); // auto flag or key changed → rebuild the AI alarm
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!autoGroup || changeInfo.status !== 'complete') return;
  if (!tab.url || !/^https?:/.test(tab.url)) return;
  if (tab.pinned || tab.groupId !== -1) return;

  const title = groupTitleForUrl(tab.url);
  if (!title) return;

  try {
    // Join an existing group with the same name in this window
    const [existing] = await chrome.tabGroups.query({ windowId: tab.windowId, title });
    if (existing) {
      await chrome.tabs.group({ tabIds: [tab.id], groupId: existing.id });
      return;
    }

    // Otherwise form a new group once 2+ ungrouped tabs share the title
    const winTabs = await chrome.tabs.query({ windowId: tab.windowId, pinned: false, groupId: -1 });
    const mates = winTabs.filter(t => t.url && /^https?:/.test(t.url) && groupTitleForUrl(t.url) === title);
    if (mates.length < 2) return;
    const groupId = await chrome.tabs.group({ tabIds: mates.map(t => t.id) });
    await chrome.tabGroups.update(groupId, { title, color: colorForTitle(title) });
  } catch {
    // Tab/window vanished mid-flight — fine, the next load retries naturally
  }
});

// ─── Scheduled auto-close sweep ─────────────────────────────────────────────
// chrome.alarms fires even while the service worker is dormant. Settings are
// read fresh from storage on every run (service workers are ephemeral — no
// in-memory caching). Thresholds come from the `autoClose` storage key,
// merged over AUTO_CLOSE_DEFAULTS from sweep.js.

const SWEEP_ALARM = 'tabSweep';

async function setupSweepAlarm() {
  const { autoClose } = await chrome.storage.local.get('autoClose');
  const cfg = { ...AUTO_CLOSE_DEFAULTS, ...(autoClose || {}) };
  await chrome.alarms.clear(SWEEP_ALARM);
  if (!cfg.enabled) return;
  // sweepTime ('HH:MM') set → daily run at that clock time; else interval mode
  const at = nextSweepTime(cfg.sweepTime);
  if (at) {
    chrome.alarms.create(SWEEP_ALARM, { when: at, periodInMinutes: 24 * 60 });
  } else {
    chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: Math.max(1, cfg.intervalMin) });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SWEEP_ALARM) return;
  try {
    const { autoClose } = await chrome.storage.local.get('autoClose');
    const cfg = { ...AUTO_CLOSE_DEFAULTS, ...(autoClose || {}) };
    if (!cfg.enabled) return;

    const tabs = await chrome.tabs.query({});
    // Same "real web tab" definition as the dashboard (http(s) + file://)
    const realTabs = tabs.filter(t => /^https?:/.test(t.url || '') || (t.url || '').startsWith('file://'));

    const targets = partitionSweepTargets(realTabs, {
      tabStaleMs:   cfg.tabStaleMinutes   * 60 * 1000,
      groupStaleMs: cfg.groupStaleMinutes * 60 * 1000,
    });
    if (targets.length === 0) return;

    await archiveAndClose(targets);
    await chrome.storage.local.set({
      lastSweep: { at: new Date().toISOString(), count: targets.length },
    });
    updateBadge();
  } catch (err) {
    console.error('[TabSweep] auto-sweep failed:', err);
  }
});

// ─── Scheduled AI tick (opt-in) ─────────────────────────────────────────────
// Runs runAiTick every 30 min — but only when the user explicitly enabled it
// (aiGrouping.auto) AND an apiKey exists. Zero network otherwise. Failures
// are silent (console.warn): the next tick retries naturally.

const AI_AUTO_ALARM = 'aiAuto';
const AI_AUTO_PERIOD_MIN = 30;

async function setupAiAutoAlarm() {
  const { aiGrouping } = await chrome.storage.local.get('aiGrouping');
  await chrome.alarms.clear(AI_AUTO_ALARM);
  if (aiGrouping && aiGrouping.auto && aiGrouping.apiKey) {
    chrome.alarms.create(AI_AUTO_ALARM, { periodInMinutes: AI_AUTO_PERIOD_MIN });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AI_AUTO_ALARM) return;
  try {
    const { aiGrouping } = await chrome.storage.local.get('aiGrouping');
    if (!aiGrouping || !aiGrouping.auto || !aiGrouping.apiKey) return;
    await runAiTick(aiGrouping); // auto mode: signature check inside
  } catch (err) {
    console.warn('[tabsweep] ai tick failed:', err);
  }
});
