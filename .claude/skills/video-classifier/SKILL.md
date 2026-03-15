---
name: video-classifier
description: Classify YouTube video titles as strategy or irrelevant -- the agent does this inline, no script or API needed
---

# Video Classifier

Classifies YouTube video titles to determine if they likely contain a trading strategy worth analyzing. This is step 1.5 in the research pipeline, between yt-scraper and notebooklm-analyst.

The agent performs this classification directly by reading the titles -- no external script or API call is needed.

## Classification Criteria

### strategy

The title suggests concrete, replicable trading content:

- Specific trading strategies or systems
- Backtesting results of a method
- Step-by-step trading approaches
- Indicator-based setups with clear rules
- Price action patterns presented as a method
- Algorithmic or automated trading methods

### irrelevant

The title does NOT suggest a replicable strategy:

- Q&A sessions, interviews (unless about a specific strategy)
- Vlogs, day-in-the-life content
- Trading desk/setup tours
- General market commentary or predictions
- Motivational or mindset content
- Broker/platform reviews, gear reviews
- News recaps
- Personal stories

## Rules

- **Conservative**: when in doubt, classify as `strategy`. Better to waste NotebookLM time than miss a real strategy.
- Output a simple list with each video's classification and a brief reason (one sentence).

## Output Format

For each video, produce:

```
- video_id: "abc123" | title: "Building an RTY Breakout Strategy" | classification: strategy | reason: Describes building a specific trading strategy
- video_id: "def456" | title: "My Trading Desk Setup Tour 2026" | classification: irrelevant | reason: Setup tour, no strategy content
```

Then a summary line:

```
Classification complete: 5 videos -- 3 strategy, 2 irrelevant
```
