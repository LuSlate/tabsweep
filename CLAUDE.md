# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**TabSweep** — Chrome MV3 extension that replaces the new tab page with a dashboard of open tabs, grouped by domain / task / AI cache. Pure client-side JS: no bundler, no npm, no server. Product code lives entirely under `extension/`.

## Commands

No build or lint pipeline. Development is load-unpacked + reload.

```bash
# Only automated test: node asserts over DOM-free modules
node extension/selfcheck.js

# Install / reload in Chrome
# 1. chrome://extensions → Developer mode → Load unpacked → select extension/
# 2. After code changes: click Reload on the extension card (or reopen the new tab)
```

There is no single-test filter — edit `extension/selfcheck.js` and re-run. Do not load `selfcheck.js` from the extension; it is node-only (`vm` + `require`).

## Layout

```
extension/
  manifest.json      MV3 entry (newtab override, popup, side panel, service worker, alarms)
  index.html         Shared UI for newtab / popup (?surface=popup) / panel (?surface=panel)
  surface.js         Sets data-surface before paint (MV3 CSP forbids inline script)
  app.js             Dashboard brain: fetch tabs, group, render, event delegation
  background.js      Service worker: badge, auto-group, side-panel command, sweep alarm
  grouping.js        DOM-free shared grouping (dual-loaded)
  sweep.js           DOM-free stale/archive logic (dual-loaded)
  ai-grouping.js     DOM-free cloud grouper + AI tick orchestrator (dual-loaded)
  i18n.js            zh/en dictionary + t() + init/toggle (dashboard only)
  selfcheck.js       Node asserts for the DOM-free modules
  style.css
  config.local.js    Optional personal overrides (gitignored; may be absent)
```

## Architecture

### Three surfaces, one page

`index.html` + `app.js` power new tab, toolbar popup, and side panel. `surface.js` reads `?surface=` and sets `document.documentElement.dataset.surface` so compact CSS applies without a paint flash. Keyboard: `Cmd/Ctrl+Shift+K` opens the side panel via `chrome.commands` → `chrome.sidePanel.open` (must stay synchronous in the command callback — user-gesture constraint).

### Dual-load modules

`grouping.js` and `sweep.js` are plain scripts with top-level functions — no modules/exports. Loaded by:

- Dashboard: `<script>` tags in `index.html` (after optional `config.local.js`)
- Service worker: `importScripts('grouping.js', 'sweep.js', 'ai-grouping.js')` in `background.js`

This keeps dashboard groups and background auto-grouping / auto-sweep / AI tick on the same definitions of "group title" and "stale". Do not introduce ES modules for these without a dual-load plan; `importScripts` cannot load ESM.

`ai-grouping.js` has no top-level chrome/DOM calls (fetch/storage/tabs only inside functions) so it dual-loads safely. Network still only happens on explicit Smart group / Re-group all clicks, or the opt-in background AI tick.

### Dashboard render pipeline (`app.js`)

1. `fetchOpenTabs()` → `chrome.tabs.query`, map to local shape (`openerTabId`, `groupId`, `lastAccessed`, `isDashboard`, …).
2. `getRealTabs()` filters to http(s)/file and non-dashboard pages.
3. `computeTaskGroups(realTabs)` claims some tabs into task groups.
4. Remaining tabs → domain groups, with a special `__landing-pages__` bucket and optional custom groups from `config.local.js`.
5. `renderGroupSection(group, startNum)` (caller chains `startNum` for continuous numbering) / workspace rows / deferred section; actions via one delegated `document` click listener on `[data-action]`.

Closing labeled/task groups uses exact-URL matching so a task group cannot close unrelated same-domain tabs.

### Index-table UI (`index.html` + `style.css`)

Newspaper-directory layout, light mode only: `.topbar` (brand / date / tab count / settings gear), `.commandbar` (contextual commands filled by `renderCommandBar` — sweep/dupe alerts, Smart group, Group in Chrome, Auto toggle, Close all), then sections of `.group` = black `.band` header (hover-revealed `.band-actions`) + `.grows` of `.trow` rows numbered globally `001…N` (`.tnum`). An AI-sweep review band (checkbox rows, confirm/dismiss) renders ahead of all groups when suggestions exist and takes the first numbers. Workspaces and Saved-for-later are the same band+row pattern, not cards. No greeting, no banner columns. Tokens: `--bg:#fff --ink:#000 --accent:#0000ee` (links/active) and `--mark:#ff5500` (checked/selected/badges, `::selection`); zero border-radius; all motion ≤0.2s `linear`.

### i18n (`i18n.js`)

zh/en UI with a topbar `#langToggle` (data-action `toggle-lang`); choice persists in storage key `lang`, unset → `pickLang(navigator.language)`. Static markup uses `data-i18n` / `data-i18n-placeholder` (labels wrapping inputs must wrap their text node in a `<span data-i18n>` so `applyStaticI18n` can't destroy the input); dynamic strings call `t(key, vars)` with `{n}` interpolation and the `{s}` English-plural var. Dictionary key parity between en/zh is selfcheck-enforced — add keys to both languages or the suite fails. Deliberately NOT `_locales`/`chrome.i18n` (no runtime manual switch).

### Task grouping decision order (`grouping.js` → `computeTaskGroups`)

1. `LOCAL_TASK_GROUPER` if defined in `config.local.js` (full override seam).
2. Else `aiGroupCache` in storage: URL-keyed AI results mapped onto live tabs via `mapCachedGroupsToTabs` (≥2 live tabs per group).
3. Else `openerChainClusters`: union-find on `openerTabId`; qualifies only at ≥3 tabs spanning ≥2 hostnames. Session-scoped (`openerTabId` dies on restart).

Native tab group projection ("Group in Chrome" + background auto-group) stays domain-based via `groupTitleForUrl` / `colorForTitle`. Synthetic task domains (`__task-*__`) are skipped by `groupTabsInChrome`.

### Auto-close sweep (`sweep.js` + alarm)

- Defaults: `AUTO_CLOSE_DEFAULTS` in `sweep.js` (`enabled`, `intervalMin`, `tabStaleDays`, `groupStaleDays`, `sweepTime`).
- User overrides: storage key `autoClose`.
- Ungrouped tabs: individual staleness under `tabStaleMs`.
- Native groups: whole group expires only when every member is stale under `groupStaleMs`.
- Never stale: active, pinned, audible, dashboard pages, missing `lastAccessed` (Chrome &lt; 121 → feature silently off).
- Path: `partitionSweepTargets` → `archiveAndClose` (append to `deferred` with `completed: true`, then `tabs.remove`). Manual banner and background alarm share this path.
- Schedule: `chrome.alarms` name `tabSweep`. If `sweepTime` is `HH:MM`, daily at that clock time; else every `intervalMin` minutes. Rebuild alarm on install/startup and when `autoClose` changes.

### AI grouping (`ai-grouping.js`)

- Opt-in: network only with an API key, on **Smart group** / **Re-group all** clicks or the background tick. No key → no network.
- Settings: storage `aiGrouping` = `{ endpoint, apiKey, model, auto }` (`auto` = background tick).
- **AI tick**: `runAiTick(settings, {force})` is the single orchestrator (dashboard + service worker). One model call returns `{ groups, dupes, close }` — incremental groups (cached labels reused via `mergeGroupsIntoCache`), semantic dupe clusters, close suggestions — all URL-keyed. Auto mode skips when the sorted-URL signature (`lastAiSig`) is unchanged.
- Background: alarm `aiAuto`, 30 min, created only when `auto && apiKey`; failures silent (`console.warn`).
- Review flow: close suggestions land in `aiSweepSuggestions`, render as the first dashboard band with checkboxes; confirm/dismiss are human actions and confirm goes through `archiveAndClose`. Dupes surface as a command-bar chip (`mapCachedDupesToTabs`); `applyKeepRules` keeps pinned/active/audible out of close suggestions and at the keep-position of dupe clusters.
- Wire formats: OpenAI `chat/completions` and Anthropic `messages` via `resolveApiEndpoints` (host/`/messages` / `/chat/completions` heuristics; DeepSeek anthropic proxy supported — its model listing lives on the OpenAI root with Bearer auth).
- Response text: `extractResponseText` — Anthropic `content` may lead with `thinking` blocks or be a plain string (proxies); never assume `content[0].text`.
- Cache: `aiGroupCache = { groups: [{ label, urls[] }], dupes: [[urls]], ts }` — URLs, not tab ids (ids die on restart).
- Cap: 200 most-recently-accessed tabs; overflow stays on domain groups.
- Requires `host_permissions` for the user's endpoint (manifest has broad http(s) for this).

### Storage keys (`chrome.storage.local`)

| Key | Purpose |
|-----|---------|
| `deferred` | Saved-for-later + archive (`completed` flag) |
| `workspaces` | Stashed group snapshots |
| `autoGroup` | Background domain auto-group (default on; only explicit `false` disables) |
| `autoClose` | Sweep schedule + thresholds |
| `aiGrouping` | Endpoint / key / model / auto flag |
| `aiGroupCache` | Last tick groups + dupes |
| `aiSweepSuggestions` | AI close suggestions awaiting review |
| `lastAiSig` | Tab-URL signature (AI tick change detection) |
| `lastAiTick` / `lastAiTickSeen` | AI tick toast once |
| `lastSweep` / `lastSweepSeen` | Background sweep toast once |
| `lang` | UI language override (`'en' \| 'zh'`; unset → browser) |

### Personal config (`extension/config.local.js`, gitignored)

Optional globals merged by `grouping.js`:

- `LOCAL_LANDING_PAGE_PATTERNS`
- `LOCAL_CUSTOM_GROUPS`
- `LOCAL_TASK_GROUPER` (async, same signature as `computeTaskGroups`)

Loaded from `index.html` before `grouping.js`. **Not** loaded by the service worker by default — missing optional `importScripts` logs a noisy extension error even inside try/catch. To honor personal rules in auto-grouping, add an explicit `importScripts('config.local.js')` above the shipped import in `background.js` only when the file exists.

### UI / safety notes that have already bitten

- AI and title-derived labels go through `escapeHtml` before `innerHTML` band titles.
- Event handling is `data-action` delegation — add actions there, not per-button listeners.
- `sidePanel.open` must not be preceded by `await` in the command path.

## Product defaults to preserve

- Zero network when no AI key is configured (the background AI tick additionally requires the explicit `auto` flag).
- Archive-before-close for sweeps (no silent data loss).
- Background auto-group never touches pinned, non-http(s), already-grouped, or landing-page tabs.
