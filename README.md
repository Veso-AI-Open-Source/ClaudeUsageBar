# ClaudeUsageBar

A cross-platform tray app that shows your **Claude Code** usage at a glance — session quota, weekly quota, per-model breakdown, and live token spend. Runs in the menu bar on **macOS** and the system tray on **Windows** and **Linux**.

> Unofficial. Not affiliated with Anthropic. Reads your local Claude Code OAuth token to call the documented `/api/oauth/usage` endpoint.

## What it does

- Sits in the menu bar / system tray with a 5-segment LED-style usage indicator that fills as you approach your limit.
- Click the icon for a popup with: session %, weekly %, time-until-reset, Opus/Sonnet 7-day usage, plan tier, and token totals (today / this week / this month) parsed from your local Claude Code logs.
- Polls the OAuth usage endpoint every 60 s with exponential backoff on errors.
- All processing is local — nothing is sent anywhere except the same Anthropic API your Claude Code client already calls.

## Privacy

| Data                 | Where it goes                                                  |
|----------------------|----------------------------------------------------------------|
| OAuth access token   | Read from your existing Claude Code credentials. Never copied off your machine. |
| Token / cost totals  | Computed locally by walking `~/.claude/projects/**/*.jsonl`. Never sent anywhere. |
| Usage API request    | Sent to `api.anthropic.com/api/oauth/usage` with your existing token. |

No telemetry, no analytics, no third-party network calls.

## Install

Pre-built installers are attached to each [GitHub release](https://github.com/Veso-AI-Open-Source/ClaudeUsageBar/releases):

- **macOS**: `.dmg` (Apple Silicon + Intel)
- **Windows**: NSIS `.exe` installer + portable `.exe`
- **Linux**: `.AppImage` and `.deb`

Builds are currently **unsigned**. On macOS first launch, right-click the app → Open → Open. On Windows, click "More info" → "Run anyway" past SmartScreen.

## Run from source

Requires Node.js 18+.

```bash
git clone https://github.com/Veso-AI-Open-Source/ClaudeUsageBar.git
cd ClaudeUsageBar
npm install
npm start
```

## Build installers

Uses [`electron-builder`](https://www.electron.build/). Build on the OS you're targeting (or use the included GitHub Actions workflow).

```bash
npm run dist:mac     # → dist/*.dmg, *.zip
npm run dist:win     # → dist/*.exe (NSIS + portable)
npm run dist:linux   # → dist/*.AppImage, *.deb
```

## How credentials are read

| OS      | Source                                                                       |
|---------|------------------------------------------------------------------------------|
| macOS   | Keychain item `Claude Code-credentials` (via `/usr/bin/security`)            |
| Linux   | `~/.claude/.credentials.json` (with fallbacks under `~/.config/claude/`)     |
| Windows | `%USERPROFILE%\.claude\.credentials.json` (with fallbacks under `%APPDATA%\claude\`) |

If credentials can't be found, the app shows an error state — sign into Claude Code first, then click **Retry** or **Re-read credentials**.

On macOS, the system may prompt once for keychain access; click **Always Allow**.

## Project layout

```
main.js              Electron main process: tray, polling, IPC
preload.js           contextBridge for the popup window
src/
  credentials.js     Cross-platform credential reader
  api.js             Anthropic /api/oauth/usage client
  localUsage.js      JSONL log walker → token / cost totals
  pricing.js         Model pricing table
renderer/
  index.html         Popup window markup
  styles.css
  app.js             Popup UI logic
  icon.html          Off-screen canvas → tray icon (5-segment LED bar)
.github/workflows/   CI: cross-platform release builds
legacy-macos/        Original Swift/SwiftUI macOS-only build (kept for reference)
```

## Contributing

Issues and PRs are welcome. To work on the app locally:

```bash
npm install
npm start              # launches Electron in dev mode
```

The Electron main process is in `main.js`; the popup UI is plain HTML/CSS/JS in `renderer/`. No build step.

Please keep changes focused and add a short description in the PR.

## License

[MIT](./LICENSE) © Veso AI

## Acknowledgements

The original macOS-only SwiftUI version (preserved in `legacy-macos/`) was the starting point. The current cross-platform build is a port to Electron with the same UX.
