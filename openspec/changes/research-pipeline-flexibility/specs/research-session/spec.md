# Spec: research-session

**Change**: research-pipeline-flexibility
**Domain**: Session creation and completion for all pipeline entry points
**Status**: draft

## Overview

The research session lifecycle MUST support all three entry points (topic, video URL, raw idea) without requiring a `topic_slug`. Sessions MUST track completion stats and appear correctly in the History page regardless of how they were initiated.

## Requirements

### RS-1: Session creation without topic_slug

`create_session()` MUST accept `topic_slug` as an **optional** parameter (default `None`).

When `topic_slug` is `None`, the session MUST be created with `topic_id = NULL` in the database.

`create_session()` SHOULD accept an optional `label` parameter (free-text string) to describe non-topic sessions (e.g., "Video: How to Trade Futures", "Idea: Mean reversion on SPY").

The `research_sessions` table MUST have a nullable `label` column of type `VARCHAR(255)`.

### RS-2: Session service returns all sessions

`get_sessions()` MUST return sessions regardless of whether `topic_id` is present or `NULL`.

The video sub-query in `get_sessions()` MUST NOT use a `topic_id` guard to filter videos. When `topic_id` is `NULL`, videos MUST be matched to the session by time window (`session.started_at` to `session.completed_at` or `session.errored_at`).

Sessions without a topic MUST display the `label` field as the session title in the API response. If both `topic` and `label` are `NULL`, the session title SHOULD default to `"Untitled session"`.

### RS-3: Session completion records final stats

`complete_session()` MUST accept and persist `strategies_found` (integer) and `drafts_created` (integer) as final stats.

The `research_sessions` table MUST have nullable integer columns `strategies_found` and `drafts_created`.

These stats MUST be returned in the session API response.

## Scenarios

### Scenario 1: Create session with topic

```gherkin
Given a valid topic_slug "futures-trading" that exists in the topics table
When create_session() is called with topic_slug="futures-trading"
Then a new session row MUST be created with topic_id resolved from the slug
And the session MUST have status "running"
And the session MUST have started_at set to the current timestamp
```

### Scenario 2: Create session without topic (video URL entry point)

```gherkin
Given a video URL "https://youtube.com/watch?v=abc123" as the pipeline input
When create_session() is called with topic_slug=None and label="Video: How to Trade Futures"
Then a new session row MUST be created with topic_id = NULL
And the session label MUST be "Video: How to Trade Futures"
And the session MUST have status "running"
And the session MUST have started_at set to the current timestamp
```

### Scenario 3: Create session without topic or video (raw idea entry point)

```gherkin
Given a raw idea text as the pipeline input
When create_session() is called with topic_slug=None and label="Idea: Mean reversion on SPY"
Then a new session row MUST be created with topic_id = NULL
And the session label MUST be "Idea: Mean reversion on SPY"
And the session MUST have status "running"
```

### Scenario 4: Complete session with stats

```gherkin
Given a running session with id=42
When complete_session() is called with session_id=42, strategies_found=3, drafts_created=5
Then the session status MUST be updated to "completed"
And the session completed_at MUST be set to the current timestamp
And the session strategies_found MUST be 3
And the session drafts_created MUST be 5
```

### Scenario 5: Session without topic appears in History page

```gherkin
Given a completed session with topic_id=NULL and label="Video: Scalping ES"
And 2 history entries exist within the session's time window
When the History page fetches sessions via GET /api/research/sessions
Then the session MUST appear in the response list
And the session title MUST be "Video: Scalping ES"
And the session MUST include the 2 history entries matched by time window
And the session MUST show strategies_found and drafts_created stats
```

### Scenario 6: Session with topic appears in History page (no regression)

```gherkin
Given a completed session with topic_id=7 and topic name "Futures Trading"
And 5 history entries exist linked to topic_id=7
When the History page fetches sessions via GET /api/research/sessions
Then the session MUST appear in the response list
And the session title MUST be "Futures Trading" (from the topic relation)
And the session MUST include the 5 history entries
```

## Data Model Changes

| Table | Column | Type | Nullable | Description |
|-------|--------|------|----------|-------------|
| research_sessions | label | VARCHAR(255) | Yes | Free-text session description for non-topic sessions |
| research_sessions | strategies_found | INTEGER | Yes | Count of parent strategies found |
| research_sessions | drafts_created | INTEGER | Yes | Count of draft variants created |

## API Contract

`GET /api/research/sessions` response per session:

```json
{
  "id": 42,
  "topic": "Futures Trading",
  "label": null,
  "title": "Futures Trading",
  "status": "completed",
  "started_at": "2026-03-23T10:00:00Z",
  "completed_at": "2026-03-23T10:05:00Z",
  "strategies_found": 3,
  "drafts_created": 5,
  "videos": [...]
}
```

The `title` field MUST be computed as: `topic.name` if topic exists, else `label` if label exists, else `"Untitled session"`.

## Migration

An Alembic migration MUST add the `label`, `strategies_found`, and `drafts_created` columns to `research_sessions`. All columns are nullable, so no backfill is required.
