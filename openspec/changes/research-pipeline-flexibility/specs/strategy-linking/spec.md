# Spec: strategy-linking

**Change**: research-pipeline-flexibility
**Domain**: Parent strategy creation, draft linking, and deduplication
**Status**: draft

## Overview

The pipeline MUST create parent `strategy` records from the `parent_strategy` field output by the `strategy-variants` skill, link each draft variant to its parent via the `strategy_id` FK, and populate `source_channel_id` when channel context is available. The Strategies page MUST display parent strategies with their linked draft variants.

## Requirements

### SL-1: Create parent strategy records

The pipeline MUST call `upsert_strategy()` for each unique `parent_strategy` name from the strategy-variants output.

`upsert_strategy()` MUST accept a strategy name and MUST return the `strategy.id` of the created or existing record.

If a strategy with the same name already exists (case-insensitive match), `upsert_strategy()` MUST return the existing record's `id` instead of creating a duplicate.

### SL-2: Link drafts to parent strategies

Each draft created by `upsert_draft()` MUST be linked to its parent strategy via the `strategy_id` FK.

The pipeline MUST pass `strategy_id` (obtained from SL-1) when calling `upsert_draft()`.

Drafts that cannot be matched to a parent strategy (e.g., the `parent_strategy` field is missing) SHOULD be created with `strategy_id = NULL`.

### SL-3: Parent strategies have source_channel_id

When the pipeline has channel context (topic-based or video-URL entry points where the channel is known), `upsert_strategy()` MUST receive and persist `source_channel_id`.

When `source_channel_id` is not available (raw idea entry point), the strategy MUST be created with `source_channel_id = NULL`.

If a channel name is available but not its ID, the pipeline SHOULD resolve the channel name to `channel_id` by querying the `channels` table. If resolution fails, `source_channel_id` MUST be set to `NULL`.

### SL-4: Strategies page shows parent strategies with drafts

The Strategies API endpoint MUST return parent strategies with their linked drafts nested.

Each strategy response MUST include a `drafts` array containing the draft variants linked via `strategy_id`.

Strategies without any linked drafts MUST still appear in the response with an empty `drafts` array.

### SL-5: Strategy deduplication by name

Strategy dedup MUST use **case-insensitive** name matching.

`upsert_strategy()` MUST query for existing strategies using a case-insensitive comparison (e.g., `LOWER(name) = LOWER(:input_name)` or `ILIKE`).

When a duplicate is found, the existing strategy MUST be updated with any new non-null fields (e.g., `source_channel_id` if it was previously `NULL`, updated `description`, etc.) and the existing `id` MUST be returned.

When no duplicate is found, a new strategy row MUST be inserted and its `id` returned.

## Scenarios

### Scenario 1: Create parent strategy from pipeline output

```gherkin
Given the strategy-variants skill outputs a variant with parent_strategy="Bollinger Band Breakout"
And no strategy named "Bollinger Band Breakout" exists in the database
When the db-manager processes the variant output
Then a new row MUST be inserted into the strategies table with name="Bollinger Band Breakout"
And the strategy id MUST be returned for draft linking
```

### Scenario 2: Deduplicate parent strategy (case-insensitive)

```gherkin
Given a strategy named "bollinger band breakout" already exists in the database with id=10
When the db-manager processes a variant with parent_strategy="Bollinger Band Breakout"
Then no new strategy row MUST be created
And the existing strategy id=10 MUST be returned
And the existing strategy MUST be updated with any new non-null fields from the input
```

### Scenario 3: Link draft to parent strategy

```gherkin
Given a parent strategy "Bollinger Band Breakout" exists with id=10
And the strategy-variants skill outputs a draft variant "Bollinger Band Breakout - Long"
  with parent_strategy="Bollinger Band Breakout"
When the db-manager calls upsert_draft() for the variant
Then the draft MUST be created with strategy_id=10
And the draft MUST be retrievable via the parent strategy's drafts relation
```

### Scenario 4: Strategy with source_channel_id

```gherkin
Given a research session for a video from channel "SMB Capital" with channel_id=5
When the db-manager creates a parent strategy from the session's output
Then the strategy MUST have source_channel_id=5
And the Strategies page MUST display "SMB Capital" as the strategy's source channel
```

### Scenario 5: Strategy without source_channel_id (raw idea)

```gherkin
Given a research session from a raw idea (no channel context)
When the db-manager creates a parent strategy from the session's output
Then the strategy MUST have source_channel_id=NULL
And the Strategies page MUST display the strategy without a channel label
And the strategy MUST NOT be excluded from the channel filter (it SHOULD appear under "No channel" or similar)
```

### Scenario 6: View strategies with drafts on frontend

```gherkin
Given 2 parent strategies exist:
  - "Bollinger Band Breakout" (id=10) with 2 linked drafts (Long, Short)
  - "VWAP Reversion" (id=11) with 1 linked draft (Long)
When the Strategies page fetches GET /api/strategies
Then the response MUST include both strategies
And "Bollinger Band Breakout" MUST have a drafts array with 2 entries
And "VWAP Reversion" MUST have a drafts array with 1 entry
And each draft MUST include its name, status, ticker, timeframe, and conditions
```

### Scenario 7: Dedup updates existing strategy fields

```gherkin
Given a strategy "VWAP Reversion" exists with source_channel_id=NULL and description=NULL
When upsert_strategy() is called with name="VWAP Reversion", source_channel_id=5, description="Mean reversion around VWAP"
Then the existing strategy MUST be updated with source_channel_id=5 and description="Mean reversion around VWAP"
And the existing strategy id MUST be returned
And no new row MUST be created
```

## Pipeline Integration

The db-manager skill MUST execute the following sequence when saving strategy output:

1. For each unique `parent_strategy` name in the variants output:
   a. Call `upsert_strategy(name=parent_strategy, source_channel_id=channel_id_if_available)`
   b. Store the returned `strategy_id`
2. For each draft variant:
   a. Resolve its `parent_strategy` name to the `strategy_id` obtained in step 1
   b. Call `upsert_draft(data, strategy_id=resolved_id)`

## API Contract

`GET /api/strategies` response per strategy:

```json
{
  "id": 10,
  "name": "Bollinger Band Breakout",
  "description": "Breakout strategy using Bollinger Bands",
  "source_channel": "SMB Capital",
  "source_channel_id": 5,
  "status": "active",
  "drafts": [
    {
      "id": 101,
      "name": "Bollinger Band Breakout - Long",
      "status": "draft",
      "ticker": "ES",
      "timeframe": "5m",
      "strategy_id": 10
    },
    {
      "id": 102,
      "name": "Bollinger Band Breakout - Short",
      "status": "draft",
      "ticker": "ES",
      "timeframe": "5m",
      "strategy_id": 10
    }
  ]
}
```

## Function Signatures

### upsert_strategy()

```python
async def upsert_strategy(
    session: AsyncSession,
    name: str,
    *,
    description: str | None = None,
    source_channel_id: int | None = None,
    source_videos: list[str] | None = None,
    parameters: dict | None = None,
    entry_rules: dict | None = None,
    exit_rules: dict | None = None,
    risk_management: dict | None = None,
    notes: str | None = None,
) -> int:
    """
    Insert or update a strategy by case-insensitive name match.
    Returns the strategy ID.
    """
```

### upsert_draft() (updated signature)

```python
async def upsert_draft(
    session: AsyncSession,
    data: dict,
    *,
    strategy_id: int | None = None,  # Link to parent strategy
) -> int:
    """
    Insert or update a draft. If strategy_id is provided, link to parent strategy.
    Returns the draft ID.
    """
```
