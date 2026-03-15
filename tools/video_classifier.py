#!/usr/bin/env python3
"""Classify YouTube video titles as 'strategy' or 'irrelevant' using Claude Haiku."""

import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

MODEL = "claude-haiku-4-5-20251001"
MAX_BATCH_SIZE = 50

SYSTEM_PROMPT = """You are a trading content classifier. Your job is to classify YouTube video titles as either "strategy" or "irrelevant".

A video is "strategy" if the title suggests it contains a concrete trading strategy, system, method, or approach that could be replicated. This includes:
- Specific trading strategies or systems
- Backtesting results of a method
- Step-by-step trading approaches
- Indicator-based setups with clear rules
- Price action patterns presented as a method

A video is "irrelevant" if it does NOT contain a replicable strategy. This includes:
- Q&A sessions, interviews (unless about a specific strategy)
- Vlogs, day-in-the-life content
- Trading desk/setup tours
- General market commentary or predictions
- Motivational or mindset content
- Broker/platform reviews
- News recaps

IMPORTANT: When in doubt, classify as "strategy". It is better to include a borderline video than to miss a real strategy.

Respond with a JSON array. Each element must have:
- "video_id": the video ID provided
- "classification": "strategy" or "irrelevant"
- "reason": a brief explanation (one sentence)

Respond ONLY with the JSON array, no other text."""


def _build_user_prompt(videos):
    """Build the user prompt listing video titles to classify."""
    lines = ["Classify each of the following video titles:\n"]
    for v in videos:
        lines.append(f'- video_id: "{v["video_id"]}", title: "{v["title"]}"')
    return "\n".join(lines)


def _classify_batch(client, videos):
    """Send a batch of videos to Claude Haiku for classification.

    Returns a list of dicts with video_id, classification, reason.
    """
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _build_user_prompt(videos)}],
    )

    text = response.content[0].text.strip()

    # Try to extract JSON from the response
    # Handle case where model wraps in markdown code block
    if text.startswith("```"):
        lines = text.splitlines()
        # Remove first and last lines (``` markers)
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines)

    return json.loads(text)


def _fallback_classify(videos, reason="API fallback -- classified conservatively"):
    """Classify all videos as 'strategy' (conservative fallback)."""
    return [
        {
            "video_id": v["video_id"],
            "classification": "strategy",
            "reason": reason,
        }
        for v in videos
    ]


def classify_videos(videos):
    """Classify a list of videos. Returns the full result dict.

    Each video must have: video_id, title, url, channel_name.
    """
    if not videos:
        return {
            "classified": [],
            "summary": {"total": 0, "strategy": 0, "irrelevant": 0},
        }

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Warning: ANTHROPIC_API_KEY not set, classifying all as strategy", file=sys.stderr)
        classifications = _fallback_classify(videos, "No API key -- classified conservatively")
    else:
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)

            # Split into batches of MAX_BATCH_SIZE
            classifications = []
            for i in range(0, len(videos), MAX_BATCH_SIZE):
                batch = videos[i : i + MAX_BATCH_SIZE]
                batch_results = _classify_batch(client, batch)
                classifications.extend(batch_results)
        except Exception as e:
            print(f"Warning: API call failed ({e}), classifying all as strategy", file=sys.stderr)
            classifications = _fallback_classify(videos)

    # Build a lookup from API results
    result_map = {r["video_id"]: r for r in classifications}

    # Merge with original video data, preserving order
    classified = []
    for v in videos:
        vid = v["video_id"]
        r = result_map.get(vid)
        if r:
            classified.append(
                {
                    "video_id": vid,
                    "title": v["title"],
                    "classification": r.get("classification", "strategy"),
                    "reason": r.get("reason", ""),
                }
            )
        else:
            # Video not in API response -- classify conservatively
            classified.append(
                {
                    "video_id": vid,
                    "title": v["title"],
                    "classification": "strategy",
                    "reason": "Not returned by classifier -- classified conservatively",
                }
            )

    strategy_count = sum(1 for c in classified if c["classification"] == "strategy")
    irrelevant_count = len(classified) - strategy_count

    return {
        "classified": classified,
        "summary": {
            "total": len(classified),
            "strategy": strategy_count,
            "irrelevant": irrelevant_count,
        },
    }


def parse_args(argv):
    """Parse command-line arguments. Returns the video list."""
    args = argv[1:]

    if not args or "--help" in args or "-h" in args:
        print("Usage: python -m tools.video_classifier '<json_array>' [--stdin]")
        print()
        print("Classify YouTube video titles as 'strategy' or 'irrelevant'.")
        print()
        print("Input: JSON array of objects with video_id, title, url, channel_name")
        print()
        print("Options:")
        print("  --stdin   Read video JSON from stdin")
        print("  --help    Show this help message")
        print()
        print("Environment:")
        print("  ANTHROPIC_API_KEY  Required for API classification (falls back to")
        print("                     classifying all as 'strategy' if not set)")
        print()
        print("Examples:")
        print('  python -m tools.video_classifier \'[{"video_id":"x","title":"My Strategy","url":"...","channel_name":"Ch"}]\'')
        print("  echo '<json>' | python -m tools.video_classifier --stdin")
        sys.exit(0)

    use_stdin = "--stdin" in args

    if use_stdin:
        raw = sys.stdin.read()
    else:
        # First non-flag argument is the JSON
        positional = [a for a in args if not a.startswith("--")]
        if not positional:
            print("Error: No video JSON provided. Use --help for usage.", file=sys.stderr)
            sys.exit(1)
        raw = positional[0]

    try:
        videos = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON input: {e}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(videos, list):
        print("Error: Input must be a JSON array of video objects.", file=sys.stderr)
        sys.exit(1)

    # Validate required fields
    required = {"video_id", "title", "url", "channel_name"}
    for i, v in enumerate(videos):
        missing = required - set(v.keys())
        if missing:
            print(f"Error: Video at index {i} missing fields: {', '.join(missing)}", file=sys.stderr)
            sys.exit(1)

    return videos


def main():
    videos = parse_args(sys.argv)
    result = classify_videos(videos)

    # Print summary to stderr
    s = result["summary"]
    print(f"\nClassification complete: {s['total']} videos -- {s['strategy']} strategy, {s['irrelevant']} irrelevant", file=sys.stderr)

    # Print full result as JSON to stdout
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
