# TabSweep

Chrome extension that replaces the new tab page with a dashboard of your open tabs, grouped by domain and task. Close groups, stash workspaces, and sweep stale tabs into an archive.

## Features

- Dashboard of open tabs grouped by domain, with a Homepages bucket
- New tab page, toolbar popup, or side panel (`Cmd+Shift+K` / `Ctrl+Shift+K`)
- One-click **Group in Chrome** plus optional background auto-grouping into native tab groups
- Task-chain grouping (tabs opened from one another) and optional **Smart group** via a user-configured AI endpoint
- Workspace stash / restore for whole cards
- Scheduled or manual stale-tab sweep (archive then close)
- Saved-for-later checklist and archive
- Runs fully in the extension; AI calls only when you configure a key and click Smart group

## Install

1. Clone: `git clone https://github.com/LuSlate/tabsweep.git`
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`
3. Open a new tab

## Develop

No build step. Edit files under `extension/`, then reload the extension.

```bash
node extension/selfcheck.js   # DOM-free unit checks
```

## License

MIT
