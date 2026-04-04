# claude-ink-hud

Turn an old Kindle into a real-time Claude Code heads-up display.

```
  @@
 @@@@
Claude Code --> localhost:3456 --> Kindle E-ink
                  (memory)        (LAN poll)
```

Zero cloud. Zero cost. Zero dependencies. One file.

## Screenshots

| Dashboard | Welcome Guide |
|:---------:|:------------:|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Welcome](docs/screenshots/welcome.png) |

| Settings | Drink Reminder | Offline |
|:--------:|:--------------:|:-------:|
| ![Settings](docs/screenshots/settings.png) | ![Reminder](docs/screenshots/reminder-alert.png) | ![Offline](docs/screenshots/offline.png) |

## Features

- **Real-time tool display** — See what Claude Code is doing right now (`$ Bash`, `* Edit`, `> Read`)
- **Context & rate limit gauges** — Context window usage and 5-hour limit with progress bars
- **7-day border progress** — Page border fills clockwise showing 7-day usage
- **Session info** — Project name, git branch, session duration
- **Activity heatmap** — Hour-by-hour coding activity visualization
- **Recent activity log** — Last 8 tool calls with timestamps
- **Drink water & stand up reminders** — Configurable timers with full-screen alerts
- **Bottom status carousel** — Rotates between 7d usage, session time, and today's call count
- **Offline detection** — Shows "Offline" when Claude Code is inactive for 5+ minutes
- **Welcome guide** — First-visit onboarding overlay, accessible anytime via [?]
- **E-ink optimized** — Black/white, large fonts, fixed-height layout (minimal screen flash), CSS-drawn icons

## Quick Start

### 1. Start the server

```bash
bun server.ts
```

```
+----------------------------------------------+
|  claude-ink-hud — Local Server               |
|  Kindle:  http://192.168.x.x:3456            |
|  Hook:    http://localhost:3456/status        |
+----------------------------------------------+
```

### 2. Configure Claude Code hooks

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "/path/to/claude-ink-hud/scripts/kindle-hook.sh"
        }]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "/path/to/claude-ink-hud/scripts/kindle-statusline-wrapper.sh"
  }
}
```

### 3. Open on Kindle

On Kindle's experimental browser, navigate to:

```
http://<your-mac-ip>:3456
```

Tip: Bookmark it. Kindle and Mac must be on the same WiFi.

## Reminder Settings

Default: 30min water, 45min stand. Customize via URL or the [=] settings button:

```
http://192.168.x.x:3456/?water=20&stand=30
```

## Architecture

```
Claude Code Hooks                    Kindle Browser
       |                                  |
       | POST /status (tool calls)        | GET / (HTML page)
       | POST /status (statusline)        | GET /status (poll every 10s)
       v                                  v
  +------------------------------------------+
  |        Bun HTTP Server (port 3456)       |
  |                                          |
  |  state: { tool, file, model, ctx%, ... } |
  |  heatmap: [0,0,...,12,...,0]  (24h)      |
  |                                          |
  |  Writes: localhost only (403 for LAN)    |
  |  Reads: 0.0.0.0 (any LAN device)        |
  +------------------------------------------+
        |
        v
    .data/heatmap.json (persisted)
```

## Project Structure

```
claude-ink-hud/
  server.ts                        # The entire server (~450 lines)
  scripts/
    kindle-hook.sh                 # PreToolUse hook -> POST /status
    kindle-statusline-wrapper.sh   # Statusline -> POST /status + claude-hud
  .data/
    heatmap.json                   # Persisted daily activity (auto-created)
  docs/plans/
    2026-04-04-kindle-status-display-design.md
```

## Requirements

- [Bun](https://bun.sh) runtime
- [jq](https://jqlang.github.io/jq/) (strongly recommended for hook scripts)
- Kindle and Mac on the same WiFi network

## How It Works

1. **Hook script** runs on every Claude Code tool call, extracts tool name/file/git info, POSTs JSON to `localhost:3456`
2. **Statusline wrapper** intercepts Claude Code's statusline data (model, context%, rate limits), POSTs metrics to `localhost:3456`, then passes data through to claude-hud
3. **Bun server** merges incoming data into in-memory state, serves an E-ink-optimized HTML page
4. **Kindle browser** polls `/status` every 10 seconds, updates the dashboard with vanilla JS (no frameworks)

## Security

- POST `/status` only accepts requests from `localhost` (hooks run on the same machine)
- GET is open to LAN (Kindle needs to read it)
- No authentication needed — the server only runs on your local network
- No data leaves your machine

## License

MIT
