---
name: video-classifier
description: Classify YouTube video titles as strategy or irrelevant using Claude Haiku to filter before NotebookLM analysis
---

# Video Classifier

Classifies YouTube video titles to determine if they likely contain a trading strategy worth analyzing. Runs between yt-scraper and notebooklm-analyst (step 1.5 in the research pipeline).

## Tool

```bash
python -m tools.video_classifier '<json_array_of_videos>'
```

### Input format

JSON array via first positional argument or stdin. Each video object must have:

- `video_id` -- YouTube video ID
- `title` -- video title
- `url` -- full YouTube URL
- `channel_name` -- source channel name

Example:

```bash
python -m tools.video_classifier '[{"video_id":"abc123","title":"Building an RTY Breakout Strategy","url":"https://youtube.com/watch?v=abc123","channel_name":"TraderX"}]'
```

Or via stdin:

```bash
echo '<json>' | python -m tools.video_classifier --stdin
```

### Optional parameters

- `--stdin` -- read video JSON from stdin instead of positional argument
- `--help` -- show usage information

## Rules

- **Conservative classification**: when in doubt, classify as `strategy` (better to waste NotebookLM time than miss a strategy)
- Batch all titles in ONE API call (cheaper and faster)
- Maximum 50 titles per batch -- splits automatically if needed
- If the Anthropic API call fails, fall back to classifying EVERYTHING as `strategy` (don't block the pipeline)
- Requires `ANTHROPIC_API_KEY` environment variable

## Output Format

```yaml
classified:
  - video_id: "abc123"
    title: "Building an RTY Breakout Strategy"
    classification: strategy
    reason: "Describes building a specific trading strategy"
  - video_id: "def456"
    title: "My Trading Desk Setup Tour 2026"
    classification: irrelevant
    reason: "Setup tour, no strategy content"
summary:
  total: 5
  strategy: 3
  irrelevant: 2
```

The tool outputs JSON to stdout. Summary is printed to stderr.

- If all videos are irrelevant: the orchestrator decides whether to continue
- If API fails: all videos classified as `strategy` with reason `"API fallback -- classified conservatively"`

## Error Handling

- `ANTHROPIC_API_KEY` not set: print warning to stderr, classify all as `strategy`
- API call fails (network, rate limit, etc.): classify all as `strategy`, print error to stderr
- Invalid input JSON: exit with code 1 and error message
- Empty video list: return empty classified list with summary totals at 0
