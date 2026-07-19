# TabSweep

TabSweep is a Chrome extension that replaces the new tab page with a dashboard of your open tabs, grouped by domain and task. Close groups with style, stash workspaces, and sweep stale tabs into an archive.

No server. No account. Everything runs in the extension. Optional AI grouping only when you provide a key and press the button.

---

## Features

- **Tab dashboard** on the new tab page, grouped by domain, with a dedicated Homepages group
- **Three surfaces**: new tab page, toolbar popup for a quick peek, and a side panel (`Cmd+Shift+K` / `Ctrl+Shift+K`)
- **Group in Chrome** — project dashboard cards into named, colored native tab groups
- **Auto-grouping** (on by default) — same-domain tabs form/join native groups while you browse
- **Task groups** — tabs opened from one another cluster into a task; optional **Smart group** uses a user-configured AI endpoint
- **Workspace stash** — save a whole card (domain/task/Homepages) as a named workspace and restore it later
- **Stale sweep** — manual banner or scheduled background auto-close that archives idle tabs first
- **Saved for later** — checklist + archive so closing tabs is loss-free
- **Duplicate detection** — flags same-URL tabs and extra dashboard tabs

---

## Install

**1. Clone**

```bash
git clone https://github.com/LuSlate/tabsweep.git
```

**2. Load in Chrome**

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder inside this repo

**3. Open a new tab**

TabSweep is your new tab page.

---

## Settings

Open the ⚙ panel on the dashboard:

- **AI grouping** — endpoint, API key, model. Supports OpenAI-compatible `chat/completions` and Anthropic `messages` style endpoints. Without a key, nothing leaves the machine.
- **Auto-close** — scheduled background sweep: scan interval (minutes), days before a tab/group counts as stale, or a fixed daily `HH:MM`.
- **Auto** toggle next to *Group in Chrome* turns background domain auto-grouping on/off.

Personal overrides (landing pages, custom groups, or a local task grouper) can go in an optional, gitignored `extension/config.local.js` defining `LOCAL_LANDING_PAGE_PATTERNS`, `LOCAL_CUSTOM_GROUPS`, or `LOCAL_TASK_GROUPER`.

---

## How it works

```
New tab / popup / panel
  -> dashboard lists real web tabs
  -> task groups first, then Homepages, then domain cards
  -> click a tab to jump to it; close single tabs or whole groups
  -> stale sweep archives + closes on a schedule
```

State lives in `chrome.storage.local` (`deferred`, `workspaces`, `autoClose`, `aiGrouping`, `aiGroupCache`, …).

---

## Develop

No build step, no npm. Edit files under `extension/`, then reload the extension in `chrome://extensions`.

```bash
node extension/selfcheck.js
```

See [CLAUDE.md](CLAUDE.md) for architecture notes.

---

## License

MIT
