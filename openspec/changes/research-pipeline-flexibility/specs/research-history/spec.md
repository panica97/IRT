# Spec: research-history

**Change**: research-pipeline-flexibility
**Domain**: History entries and stats for sessions with optional topic/channel linking
**Status**: draft

## Overview

History entries and stats MUST include research sessions that lack a `topic_id` or `channel_id`. The current INNER JOINs in stats queries silently exclude these entries, producing inaccurate counts. The flat list and grouped views MUST surface all entries regardless of linking.

## Requirements

### RH-1: History entries with optional topic_id and channel_id

History entries SHOULD have `topic_id` and `channel_id` populated when available (i.e., when the pipeline has topic or channel context).

History entries MUST be created and retrievable even when `topic_id` and/or `channel_id` are `NULL`.

### RH-2: History stats include unlinked entries

`get_history_stats()` MUST use LEFT JOINs (not INNER JOINs) when aggregating `by_topic` and `by_channel` stats.

Entries with `topic_id = NULL` MUST appear in the `by_topic` stats under a bucket labeled `"Uncategorized"` (or equivalent).

Entries with `channel_id = NULL` MUST appear in the `by_channel` stats under a bucket labeled `"Unknown channel"` (or equivalent).

The `total` stat MUST count all entries regardless of `topic_id` or `channel_id` presence.

### RH-3: Flat list view includes unlinked entries

The flat list history endpoint MUST return entries with `NULL` `topic_id`.

When filtering by topic, entries with `NULL` `topic_id` MUST NOT appear (they have no topic to match).

When no topic filter is applied, entries with `NULL` `topic_id` MUST appear in the list.

### RH-4: Grouped view includes unlinked entries

In the grouped (by-session) view, sessions with `NULL` `topic_id` MUST appear.

Sessions with `NULL` `topic_id` SHOULD be grouped under an `"Unlinked"` section (or similar label) when the view groups by topic.

When the view groups by session (chronological), sessions with `NULL` `topic_id` MUST appear in their normal chronological position using `label` or `"Untitled session"` as the display name.

## Scenarios

### Scenario 1: History entry with full linking

```gherkin
Given a research session for topic "futures-trading" on channel "SMB Capital"
When a history entry is created for video_id="abc123"
Then the entry MUST have topic_id set to the "futures-trading" topic ID
And the entry MUST have channel_id set to the "SMB Capital" channel ID
And the entry MUST appear in flat list, grouped view, and stats
```

### Scenario 2: History entry with NULL topic_id

```gherkin
Given a research session initiated from a video URL (no topic)
When a history entry is created for video_id="xyz789" with topic_id=NULL and channel_id=5
Then the entry MUST be persisted with topic_id = NULL
And the entry MUST appear in the flat list when no topic filter is active
And the entry MUST NOT appear when filtering by any specific topic
And the entry MUST appear in by_topic stats under the "Uncategorized" bucket
And the entry MUST appear in by_channel stats under channel_id=5
```

### Scenario 3: History entry with NULL channel_id

```gherkin
Given a research session where the video's channel is not in the channels database
When a history entry is created for video_id="def456" with topic_id=3 and channel_id=NULL
Then the entry MUST be persisted with channel_id = NULL
And the entry MUST appear in the flat list
And the entry MUST appear in by_topic stats under topic_id=3
And the entry MUST appear in by_channel stats under the "Unknown channel" bucket
```

### Scenario 4: Stats include all entries

```gherkin
Given 10 history entries where:
  - 6 have topic_id and channel_id
  - 2 have topic_id but NULL channel_id
  - 2 have NULL topic_id and NULL channel_id
When get_history_stats() is called
Then total count MUST be 10
And by_topic stats MUST sum to 10 (6 + 2 linked + 2 under "Uncategorized")
And by_channel stats MUST sum to 10 (6 linked + 2 + 2 under "Unknown channel")
```

### Scenario 5: Grouped view with unlinked sessions

```gherkin
Given 3 completed sessions:
  - Session A with topic "futures-trading" (3 videos)
  - Session B with label "Video: Scalping ES" and topic_id=NULL (1 video)
  - Session C with topic "options-strategies" (2 videos)
When the History page loads the grouped (by-session) view
Then all 3 sessions MUST appear in chronological order
And Session A MUST show title "futures-trading"
And Session B MUST show title "Video: Scalping ES"
And Session C MUST show title "options-strategies"
And all sessions MUST show their respective video counts
```

### Scenario 6: Topic filter excludes unlinked entries

```gherkin
Given history entries for topic "futures-trading" (5 entries) and unlinked entries (2 entries)
When the flat list is filtered by topic="futures-trading"
Then only the 5 entries with topic "futures-trading" MUST be returned
And the 2 unlinked entries MUST NOT be returned
```

## Query Changes

### Current (broken for unlinked entries)

```sql
-- by_topic stats (INNER JOIN excludes NULL topic_id)
SELECT t.name, COUNT(*)
FROM research_history h
JOIN topics t ON h.topic_id = t.id
GROUP BY t.name;
```

### Required (includes all entries)

```sql
-- by_topic stats (LEFT JOIN + COALESCE includes NULL topic_id)
SELECT COALESCE(t.name, 'Uncategorized') AS topic_name, COUNT(*)
FROM research_history h
LEFT JOIN topics t ON h.topic_id = t.id
GROUP BY COALESCE(t.name, 'Uncategorized');
```

The same pattern MUST be applied to `by_channel` stats using `LEFT JOIN channels` and `COALESCE(c.name, 'Unknown channel')`.

## API Contract

`GET /api/research/history/stats` response:

```json
{
  "total": 10,
  "by_topic": [
    { "name": "futures-trading", "count": 6 },
    { "name": "options-strategies", "count": 2 },
    { "name": "Uncategorized", "count": 2 }
  ],
  "by_channel": [
    { "name": "SMB Capital", "count": 6 },
    { "name": "Unknown channel", "count": 4 }
  ]
}
```
