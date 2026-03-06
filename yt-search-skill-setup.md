# YouTube Search Skill for Claude Code

Search YouTube directly from Claude Code using `/yt-search`. Returns structured results with titles, channels, view counts, duration, and dates — filtered to the last 6 months by default.

Also includes `/yt-channels` for managing a curated database of YouTube channels by topic, and `--topic` mode for fetching recent uploads from all channels in a topic.

## Prerequisites

Install dependencies:

```bash
pip install yt-dlp pyyaml
```

## Installation

### File structure

```
~/.claude/
  commands/
    yt-search.md          # Slash command (search + topic routing)
    yt-channels.md        # Slash command (channel CRUD)
  skills/
    yt-search/
      scripts/
        formatting.py     # Shared date formatting
        search.py         # Keyword search via yt-dlp
        channels.py       # Channel database management (--db required)
        fetch_topic.py    # Fetch recent uploads by topic (--db required)

<repo>/
  channels.yaml           # Channel database (version-controlled)
  strategies.yaml         # Strategies database (version-controlled)
```

### Step 1: Create the slash commands

**`~/.claude/commands/yt-search.md`** — Routes to search or topic fetch based on arguments.

**`~/.claude/commands/yt-channels.md`** — Manages the channel database.

### Step 2: Create the scripts

**`~/.claude/skills/yt-search/scripts/formatting.py`** — Shared `format_date` function.

**`~/.claude/skills/yt-search/scripts/search.py`** — YouTube keyword search. Imports `format_date` from `formatting.py`.

**`~/.claude/skills/yt-search/scripts/channels.py`** — CRUD for channel database (`channels.yaml`).

**`~/.claude/skills/yt-search/scripts/fetch_topic.py`** — Fetches recent uploads from all channels in a topic using parallel requests.

### Step 3: Channel database

The channel database (`channels.yaml`) lives in the repo root and is version-controlled. Both `channels.py` and `fetch_topic.py` require a `--db <path>` flag pointing to this file. The slash commands pass `--db ./channels.yaml` automatically.

Each channel entry includes a `last_fetched` field (ISO date string or `null`) that is automatically updated when `fetch_topic.py` successfully retrieves videos from that channel.

To add channels manually:

```
/yt-channels add ai-agents https://www.youtube.com/@AIJason --name "AI Jason"
```

### Step 4: Strategies database

The strategies database (`strategies.yaml`) stores trading/investment strategies extracted from videos. It lives in the repo root and is version-controlled.

Schema for each strategy entry:

```yaml
strategies:
  - name: rsi-divergence-reversal         # assigned by extraction agent
    description: "Mean reversion using RSI divergence on pullbacks"
    source:
      video_url: https://youtube.com/watch?v=abc123
      channel: QuantProgram
      topic: trading
    rules:
      entry: "Long when RSI divergence on 1h chart + price above 200 EMA"
      exit: "Close at 2R target or trailing stop at 1R"
      timeframe: 1h
      market: crypto                       # forex, stocks, crypto, futures...
    backtested: false
    metrics: null                           # filled by backtesting agent
```

When the backtesting agent runs, it sets `backtested: true` and fills `metrics` with results (e.g. `win_rate`, `total_return`).

## Usage

### Keyword search (existing)

```
/yt-search claude code skills
/yt-search AI agents --count 10
/yt-search react tutorials --months 3
```

### Topic-based fetch (new)

```
/yt-search --topic ai-agents --days 7
/yt-search --topic trading --days 14 --count 50
```

### Channel management (new)

```
/yt-channels topics
/yt-channels list
/yt-channels list ai-agents
/yt-channels add ai-agents https://www.youtube.com/@SomeChannel --name "Some Channel"
/yt-channels remove ai-agents https://www.youtube.com/@SomeChannel
```

## Options

### `/yt-search` (keyword mode)

| Flag | Default | Description |
|------|---------|-------------|
| `--count N` | 20 | Number of results to return |
| `--months N` | 6 | Only show videos from the last N months |
| `--no-date-filter` | — | Show all results regardless of date |

### `/yt-search --topic` (topic mode)

| Flag | Default | Description |
|------|---------|-------------|
| `--topic <name>` | — | Topic to fetch (matches by substring) |
| `--days N` | 7 | Only show videos from the last N days |
| `--count N` | 30 | Max number of results |

## What it returns

### Keyword search
For each video: title, channel (subs), views, duration, date, URL.

### Topic fetch
For each video: title, channel name, date, URL (simplified output).
