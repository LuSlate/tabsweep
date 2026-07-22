/**
 * sweep.js — Shared stale-tab & archive logic (DOM-free)
 *
 * Loaded by BOTH the dashboard (<script> in index.html) and the
 * background service worker (importScripts in background.js), so the
 * manual banner sweep and the scheduled auto-sweep share one definition
 * of "stale" and one archive-then-close path. Mirrors the grouping.js
 * dual-load pattern.
 */

// Default auto-close settings. User overrides live in chrome.storage.local
// under the `autoClose` key; app.js (settings panel) and background.js
// (alarm handler) both merge stored values over these defaults.
const AUTO_CLOSE_DEFAULTS = { enabled: true, intervalMin: 60, tabStaleMinutes: 120, groupStaleMinutes: 360, sweepTime: '' };

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// ponytail: soft cap on completed archive entries — prevents unbounded
// chrome.storage.local growth. Oldest-first pruning keeps the newest 2000.
const MAX_COMPLETED_ARCHIVE = 2000;

/**
 * nextSweepTime(hhmm)
 *   → ms epoch of the next occurrence of clock time 'HH:MM' (today if it
 *   is still ahead, else tomorrow), or null for empty/invalid input.
 *   When set, the sweep runs daily at this time instead of every
 *   `intervalMin` minutes.
 */
function nextSweepTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  const d = new Date();
  d.setHours(+m[1], +m[2], 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * isStaleTab(tab, staleMs, now)
 *
 * True when a tab hasn't been accessed for `staleMs`. Never stale:
 * active, pinned, audible (media playing), dashboard pages, and tabs with
 * no `lastAccessed` (undefined before Chrome 121 — the whole feature
 * silently disappears there). `now` is injectable for tests.
 */
function isStaleTab(tab, staleMs, now) {
  return (
    !tab.active &&
    !tab.pinned &&
    !tab.isDashboard &&
    !tab.audible &&
    tab.lastAccessed &&
    ((now || Date.now()) - tab.lastAccessed) > staleMs
  );
}

/**
 * partitionSweepTargets(tabs, { tabStaleMs, groupStaleMs, now })
 *   → array of tabs to archive+close
 *
 * Ungrouped tabs (groupId -1/undefined): swept individually under
 * `tabStaleMs`. Grouped tabs: a native tab group is a unit — swept only
 * when EVERY member is stale under `groupStaleMs`; one fresh (or active/
 * pinned/audible) member keeps the whole group alive.
 */
function partitionSweepTargets(tabs, { tabStaleMs, groupStaleMs, now }) {
  const targets = [];
  const byGroup = new Map();
  for (const tab of tabs) {
    if (tab.groupId == null || Number(tab.groupId) === -1) {
      if (isStaleTab(tab, tabStaleMs, now)) targets.push(tab);
    } else {
      if (!byGroup.has(tab.groupId)) byGroup.set(tab.groupId, []);
      byGroup.get(tab.groupId).push(tab);
    }
  }
  for (const members of byGroup.values()) {
    if (members.every(m => isStaleTab(m, groupStaleMs, now))) targets.push(...members);
  }
  return targets;
}

/**
 * archiveAndClose(tabs)
 *   → Promise<number> count closed
 *
 * Archives every tab into the Saved-for-Later archive (`deferred` list,
 * `completed: true` keeps them out of the active checklist), deduping by
 * URL against existing entries and within the batch, then closes them.
 * Moved verbatim from app.js's sweepStaleTabs so the background alarm
 * reuses the exact same loss-free path.
 */
async function archiveAndClose(tabs) {
  // ponytail: read-modify-write race on 'deferred' — called from both
  // dashboard (manual sweep banner) and background (alarm). Can interleave
  // with saveTabForLater/checkOffSavedTab/dismissSavedTab, dropping a write.
  // chrome.storage.local has no atomic CAS; fix via single-writer arch (M4 debt).
  if (!tabs || tabs.length === 0) return 0;
  let { deferred = [] } = await chrome.storage.local.get('deferred');

  // ponytail: soft cap completed entries — prune oldest-first when over the limit.
  // Prevents unbounded archive growth that could exhaust chrome.storage.local quota.
  const completed = deferred.filter(d => d.completed);
  if (completed.length > MAX_COMPLETED_ARCHIVE) {
    const newestIds = new Set(
      completed
        .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))
        .slice(0, MAX_COMPLETED_ARCHIVE)
        .map(d => d.id)
    );
    deferred = deferred.filter(d => !d.completed || newestIds.has(d.id));
  }

  const knownUrls = new Set(deferred.map(d => d.url));
  const stamp = Date.now().toString();
  let i = 0;
  for (const tab of tabs) {
    if (!tab.url || knownUrls.has(tab.url)) continue;
    knownUrls.add(tab.url);
    deferred.push({
      id:        `${stamp}-${i++}`, // unique within the batch
      url:       tab.url,
      title:     tab.title || tab.url,
      savedAt:   new Date().toISOString(),
      completedAt: new Date().toISOString(),
      completed:   true,              // straight to the archive
      dismissed: false,
    });
  }
  try {
    await chrome.storage.local.set({ deferred });
  } catch (err) {
    console.error('[tabsweep] archiveAndClose: storage write failed — quota likely exceeded', err);
    if (typeof window !== 'undefined' && window.t && window.showToast) {
      window.showToast(window.t('toastStorageFull') || 'Archive storage full — sweep paused.');
    }
    return 0;
  }
  // Close every passed tab, not just ones newly archived — a tab whose URL
  // was already in the archive (or duplicated within this batch) is still
  // safe to close, since the archive-before-close invariant already holds.
  const ids = tabs.map(t => t.id).filter(id => id != null);
  if (ids.length > 0) {
    try {
      await chrome.tabs.remove(ids);
    } catch (err) {
      console.error('[tabsweep] archiveAndClose: tabs.remove failed:', err);
    }
  }
  return ids.length;
}
