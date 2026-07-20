# TabSweep

> **AI-powered Chrome tab management** — intelligent grouping, stale tab sweeping, and workspace persistence. Pure client-side architecture with optional cloud AI integration.

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](https://github.com/LuSlate/tabsweep)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)

<p align="center">
  <img src="https://img.shields.io/badge/Build-No%20bundler-success" alt="No bundler">
  <img src="https://img.shields.io/badge/Dependencies-Zero-success" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/Privacy-First-blue" alt="Privacy first">
</p>

---

## Overview

TabSweep replaces Chrome's new tab page with an intelligent dashboard that surfaces open tabs grouped by domain and task context. Built with a **privacy-first, zero-server architecture** — all processing happens locally unless you explicitly configure AI grouping.

### Key Differentiators

- **Hybrid AI architecture**: Client-side preprocessing (URL classification, opener graph analysis, time clustering) + optional cloud LLM for semantic grouping
- **Three UI surfaces**: New tab page, toolbar popup, side panel (`⌘⇧K` / `Ctrl+Shift+K`)
- **Native Chrome integration**: Projects dashboard groups → Chrome native tab groups with collapse/reorder
- **Zero data loss**: Archive-before-close pattern with full history
- **i18n support**: zh/en with runtime language switching
- **Service worker compatibility**: DOM-free shared modules via `importScripts`

---

## Features

### 🎯 Intelligent Grouping

- **Client-side preprocessing**  
  7-way URL classification (root/list/detail/doc/code/search/social), opener chain graph, time windowing, importance scoring (core/peripheral/ephemeral)

- **AI task grouping** (opt-in)  
  Cloud-based semantic clustering with incremental cache, dupe detection, and close suggestions. Enforces core-tab protection client-side.

- **Domain grouping**  
  Automatic bucketing with special handling for landing pages and configurable custom groups

- **Auto-group background worker**  
  Maintains native tab groups as you browse (disable via settings)

### 🧹 Stale Tab Management

- **Scheduled sweep**  
  Configurable intervals (minutes or daily `HH:MM`), separate thresholds for tabs vs. groups, respects pinned/audible/active state

- **Archive persistence**  
  All closed tabs saved to `chrome.storage.local` with restoration support

- **Smart close suggestions**  
  AI-powered recommendations with human review flow (checkbox band, confirm/dismiss)

### 💼 Workspace Management

- **Stash & restore**  
  Snapshot entire domain/task groups as named workspaces, reopen with one click

- **Deduplication**  
  Detects same-URL tabs across windows, flags extra dashboard instances

### 🎨 Developer Experience

- **No build tooling**  
  Pure ES modules + dual-load plain scripts, reload-driven workflow

- **Comprehensive test suite**  
  133 assertions in `selfcheck.js` covering grouping logic, AI preprocessing, wire format handling

- **Extensibility hooks**  
  `config.local.js` for personal rules (gitignored, optional)

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│  manifest.json (MV3)                                        │
│  ├─ newtab/popup/sidepanel → index.html + app.js           │
│  ├─ service worker → background.js                         │
│  └─ alarms → sweep + AI auto-tick                          │
└─────────────────────────────────────────────────────────────┘
         │                             │
         ▼                             ▼
   ┌──────────┐                ┌──────────────┐
   │ Dashboard│                │ Background   │
   │ (DOM)    │                │ (no DOM)     │
   └──────────┘                └──────────────┘
         │                             │
         └─────────┬───────────────────┘
                   ▼
         ┌───────────────────┐
         │ Shared Modules    │
         │ (dual-load)       │
         │ grouping.js       │
         │ sweep.js          │
         │ ai-grouping.js    │
         └───────────────────┘
```

### Dual-Load Pattern

`grouping.js`, `sweep.js`, `ai-grouping.js` are plain scripts (no ES module syntax) loaded by:
- **Dashboard**: `<script>` tags in `index.html`
- **Service worker**: `importScripts()` in `background.js`

This keeps dashboard UI and background automation on the same logic without a build step.

### AI Grouping Pipeline

```
User clicks "Smart group"
  ↓
Client preprocessing (classifyUrlType, buildOpenerGraph, clusterByTime, calculateTabImportance)
  ↓
Build payload: tabs[] with 8 enriched fields (urlType, importance, openerChain, ...)
  ↓
Cloud LLM call (OpenAI chat/completions or Anthropic messages format)
  ↓
Response parsing → {groups[], dupes[], close[]}
  ↓
Merge into aiGroupCache (incremental updates)
  ↓
Client-side enforcement (applyKeepRules: never close core tabs)
  ↓
Render + project to native Chrome tab groups
  ↓
tidyTabStrip (collapse groups, move loose tabs to end)
```

**Wire format support**: Auto-detects OpenAI vs Anthropic endpoints, handles thinking blocks in Claude responses, configurable `max_tokens`.

---

## Installation

### Option 1: Load Unpacked (Development)

```bash
git clone https://github.com/LuSlate/tabsweep.git
cd tabsweep
```

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select `extension/` folder
4. Open a new tab — TabSweep dashboard loads

### Option 2: Chrome Web Store

*(Coming soon)*

---

## Configuration

### AI Grouping (Optional)

Settings panel (⚙ icon on dashboard):

- **Endpoint**: OpenAI-compatible `https://api.openai.com/v1` or Anthropic `https://api.anthropic.com/v1/messages`
- **API Key**: Your key (stored locally in `chrome.storage.local`, never leaves your machine except for API calls)
- **Model**: `gpt-4o`, `claude-3-5-sonnet-20241022`, DeepSeek, etc.
- **Max tokens**: Response limit (default 8192, increase for reasoning models)
- **Auto**: Enable background AI tick (30min interval)

**Privacy**: Without a configured key, zero network calls are made.

### Auto-Close Sweep

- **Interval**: Minutes between scans, or daily time (`HH:MM` format)
- **Tab threshold**: Days before ungrouped tabs count as stale
- **Group threshold**: Days before entire native groups expire (all members must be stale)

Exclusions: pinned, audible, active, dashboard pages, tabs missing `lastAccessed` (Chrome <121).

### Personal Overrides

Create `extension/config.local.js` (gitignored):

```javascript
// Custom landing page patterns
const LOCAL_LANDING_PAGE_PATTERNS = [
  /company\.internal/,
];

// Domain group overrides
const LOCAL_CUSTOM_GROUPS = {
  'Internal Tools': ['company.internal', 'jira.company.com'],
};

// Full task grouper replacement
async function LOCAL_TASK_GROUPER(tabs) {
  // return Map<groupKey, tab[]>
}
```

---

## Development

### Prerequisites

- Node.js (for test runner only, not required for extension)
- Chrome/Chromium browser

### Workflow

```bash
# Run tests (133 assertions)
node extension/selfcheck.js

# Load extension
# chrome://extensions → Load unpacked → extension/

# After code changes
# chrome://extensions → TabSweep card → Reload button
```

**No build step, no bundler, no npm dependencies.** Edit files directly, reload extension.

### Project Structure

```
extension/
├── manifest.json          # MV3 manifest
├── index.html             # Shared UI (newtab/popup/panel)
├── surface.js             # Pre-paint surface detection
├── app.js                 # Dashboard logic + render
├── background.js          # Service worker (alarms, badge)
├── grouping.js            # Domain/task grouping (dual-load)
├── sweep.js               # Stale detection (dual-load)
├── ai-grouping.js         # Cloud grouper + preprocessing (dual-load)
├── i18n.js                # zh/en dictionary + runtime toggle
├── selfcheck.js           # Test suite (Node.js runner)
├── style.css              # Newspaper-directory layout
└── config.local.js        # Optional personal overrides (gitignored)
```

### Testing Philosophy

Every DOM-free function has at least one assertion in `selfcheck.js`. Example:

```javascript
const sweep = require('./sweep.js');
const stale = sweep.partitionSweepTargets(tabs, {tabStaleMs: 1000, groupStaleMs: 2000});
check('stale: pinned tabs never sweep', stale.stale.every(t => !t.pinned));
```

Run after every change. **All 133 tests must pass before merge.**

### Code Style

- **Ponytail discipline**: Shortest working diff wins. No speculative features.
- **Surgical edits**: Touch only what the task requires. Match existing style.
- **Comment discipline**: Only constraints the code can't show. No "what" or "why" comments for reviewers.

See [CLAUDE.md](CLAUDE.md) for full architecture docs and AI collaboration guidelines.

---

## API Reference

### Storage Schema

| Key | Type | Purpose |
|-----|------|---------|
| `deferred` | `Array<{url, title, completed}>` | Saved-for-later + archive |
| `workspaces` | `Array<{name, tabs[]}>` | Stashed groups |
| `autoGroup` | `boolean` | Background domain grouping toggle |
| `autoClose` | `{enabled, intervalMin, tabStaleDays, ...}` | Sweep config |
| `aiGrouping` | `{endpoint, apiKey, model, auto}` | AI settings |
| `aiGroupCache` | `{groups[], dupes[], ts}` | Last AI tick results |
| `aiSweepSuggestions` | `Array<url>` | Pending close suggestions |
| `lang` | `'en' \| 'zh'` | UI language override |

### Extension APIs Used

- `chrome.tabs` — Query, group, close, reorder
- `chrome.tabGroups` — Create, update, collapse native groups
- `chrome.storage.local` — Persist state
- `chrome.alarms` — Schedule sweep + AI tick
- `chrome.sidePanel` — Register side panel surface
- `chrome.commands` — Keyboard shortcut (`Cmd+Shift+K`)

---

## Roadmap

- [ ] Chrome Web Store publication
- [ ] Sync across devices (`chrome.storage.sync` option)
- [ ] Export/import workspace backups
- [ ] Dark mode support
- [ ] Analytics dashboard (local histogram of group sizes, sweep stats)
- [ ] Firefox port (WebExtensions API compatibility layer)

---

## Contributing

This is a personal productivity tool, but high-quality PRs are welcome. Before submitting:

1. **Run selfcheck**: `node extension/selfcheck.js` (all tests must pass)
2. **Test manually**: Load unpacked, verify the change in Chrome
3. **Follow existing patterns**: No new dependencies, match dual-load architecture
4. **Add tests**: New logic in `grouping.js`/`sweep.js`/`ai-grouping.js` needs assertions

**PR guidelines**:
- One feature/fix per PR
- Descriptive commit messages (50-char summary, detailed body if needed)
- Update `CLAUDE.md` if architecture changes

---

## License

MIT © 2024 LuSlate

---

## Acknowledgments

Built with:
- Chrome Extensions Manifest V3
- Pure JavaScript (no frameworks)
- Optional integration with OpenAI/Anthropic/DeepSeek APIs

**No AI attribution in commits** — this is human-driven development with AI assistance where useful.

---

<p align="center">Made with ☕ by <a href="https://github.com/LuSlate">@LuSlate</a></p>
