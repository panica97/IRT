---
name: db-manager
description: Save strategies to PostgreSQL database with deduplication (case-insensitive by name)
---

# DB Manager

Saves new strategies to the PostgreSQL database, avoiding duplicates.

## Database

PostgreSQL via `tools.db.strategy_repo` (sync session).

## How to save strategies and drafts

The db-manager receives the output from strategy-variants (strategies with variants) and strategy-translator (JSON drafts). It must:

1. **Group variants by `parent_strategy`** name
2. **For each parent strategy**:
   a. Resolve `source_channel` name to `source_channel_id` using `get_channel_by_name()`
   b. Call `insert_strategy()` with `source_channel_id` in the data dict
   c. Capture the returned `Strategy.id`
3. **For each variant draft** of that parent:
   a. Call `upsert_draft()` with `strategy_id=parent.id` to link the draft

```python
from tools.db.session import sync_session_ctx
from tools.db.strategy_repo import insert_strategy
from tools.db.draft_repo import upsert_draft
from tools.db.channel_repo import get_channel_by_name

with sync_session_ctx() as session:
    # Group variants by parent_strategy name
    parents = {}
    for variant in all_variants:
        pname = variant["parent_strategy"]
        parents.setdefault(pname, []).append(variant)

    for parent_name, variants in parents.items():
        # Resolve channel
        source_channel_id = None
        ch_name = variants[0].get("source_channel")
        if ch_name:
            ch = get_channel_by_name(session, ch_name)
            if ch:
                source_channel_id = ch.id

        # Create parent strategy
        parent = insert_strategy(session, {
            "name": parent_name,
            "description": variants[0].get("description", ""),
            "source_channel_id": source_channel_id,
            "source_videos": variants[0].get("source_videos", []),
            "entry_rules": variants[0].get("entry_rules", []),
            "exit_rules": variants[0].get("exit_rules", []),
        })

        # Create drafts linked to parent
        for v in variants:
            upsert_draft(
                session,
                strat_code=v["strat_code"],
                strat_name=v["variant_name"],
                data=v["draft_json"],
                strategy_id=parent.id,
            )
```

The `strategy_data` dict should have these keys (matching YAML format):
- `name` (required, string)
- `description` (string)
- `source_channel_id` (int, optional -- resolved from channel name)
- `source_videos` (list of strings)
- `parameters` (list of dicts)
- `entry_rules` (list of strings)
- `exit_rules` (list of strings)
- `risk_management` (list of strings)
- `notes` (list of strings)

## Rules

- Always create the parent strategy BEFORE creating its variant drafts
- Always pass `strategy_id` when calling `upsert_draft()`
- Resolve `source_channel` name to `source_channel_id` via `get_channel_by_name()` -- if the channel is not in the DB, pass `None`
- Use `tools.db.strategy_repo.insert_strategy()` for each strategy
- Deduplication is automatic: case-insensitive name matching
- If a strategy with the same name exists, it is updated (upsert)
- Only add NEW strategies -- existing ones are updated, not duplicated
- The function handles all DB operations within the context manager

## Saving Drafts

Each draft MUST be linked to its parent strategy via `strategy_id`. The parent strategy must be created first via `insert_strategy()`.

The translator step generates **multiple JSON drafts per idea** (variants by timeframe, exit method, filters, etc.). Each variant is a separate draft.

```python
from tools.db.session import sync_session_ctx
from tools.db.draft_repo import upsert_draft

with sync_session_ctx() as session:
    # Each variant gets its own strat_code, starting at 9001 and incrementing
    # strategy_id MUST be passed to link each draft to its parent strategy
    upsert_draft(session, strat_code=9001, strat_name="RSI_Divergence_SAR_360m", data=draft_json_v1, strategy_id=parent.id)
    upsert_draft(session, strat_code=9002, strat_name="RSI_Divergence_TimeExit_240m", data=draft_json_v2, strategy_id=parent.id)
    upsert_draft(session, strat_code=9003, strat_name="RSI_Divergence_ATR_Daily", data=draft_json_v3, strategy_id=parent.id)
    # Automatically computes todo_count and todo_fields from _TODO values in data
```

`upsert_draft()` deduplicates by `strat_code`. If a draft with the same `strat_code` exists, it is updated.
`strategy_id` is **required** -- each draft MUST be linked to its parent strategy.
Additional optional params: `active`, `tested`, `prod`.

**Important**: Each variant must have a distinct `strat_name` that describes the variation clearly. Use `"_TODO"` for any values that cannot be determined from the source idea — never guess parameter values.

## Output Format

```yaml
saved:
  - "<strategy name 1>"
  - "<strategy name 2>"
updated:
  - "<duplicate strategy name>"
total_in_db: <number>
```

## Error Handling

- DATABASE_URL not set: report the error, cannot save
- Connection error: report the error
- Input data has invalid format: report which strategies and save nothing

## Fallback

If `DATABASE_URL` is not set, fall back to the YAML file approach:
- Read `data/strategies/strategies.yaml` before writing
- Compare by name (case-insensitive) to detect duplicates
- Write the updated file back to `data/strategies/strategies.yaml`
