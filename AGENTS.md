# AGENTS.md — TabSweep setup for coding agents

Install **TabSweep** for the user: a Chrome MV3 new-tab dashboard for open tabs.

## Setup

1. Ensure the repo is present (this folder). Extension root:

```bash
echo "Extension folder: $(cd extension && pwd)"
```

2. Copy the path and open Chrome extensions:

```bash
# macOS
cd extension && pwd | pbcopy
open "chrome://extensions"
```

3. User steps: enable **Developer mode** → **Load unpacked** → select the `extension/` folder.

4. Open a new tab to confirm TabSweep loads.

## Notes

- Pure extension: no server, no npm build.
- Optional AI grouping needs endpoint + API key in the ⚙ settings panel.
- Persist user data in `chrome.storage.local` (`deferred`, `workspaces`, `autoClose`, `aiGrouping`, …).
- Reload the extension after code changes: `chrome://extensions` → Reload.
