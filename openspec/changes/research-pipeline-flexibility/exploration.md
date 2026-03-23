# Exploration: research-pipeline-flexibility

## Current State

### Pipeline Flow (AGENT.md)
The research pipeline is hardcoded for the **topic entry point only**:
1. Receives a `topic` slug (must exist in `channels.yaml`)
2. Fetches videos via `yt-scraper` using the topic
3. Filters already-researched videos using `topic_id`
4. Classifies videos, analyzes with NotebookLM
5. Produces strategy variants and IBKR JSON drafts
6. Saves history entries with `topic_id` and `channel_id`
7. Saves strategies via `insert_strategy()` (no `source_channel_id` passed)
8. Saves drafts via `upsert_draft()` (no `strategy_id` passed)

### Session Tracking
- `create_session(session, topic_slug)` resolves `topic_slug` to `topic_id` via `_resolve_topic_id()`. If the slug doesn't exist in the `topics` table, `topic_id` becomes `None`.
- `update_session_step()`, `complete_session()`, `error_session()` all work fine with any `session_id` -- they don't care about `topic_id`.
- **Problem**: `create_session()` requires a `topic_slug` string parameter. For video URL or raw idea entry points, there is no topic.

### History Linking
- `add_history()` accepts `channel_id` and `topic_id` as **optional** (both nullable in the model).
- `ResearchHistory` model: `channel_id` and `topic_id` are both `Optional[int]` with nullable FKs.
- **Dedup key**: `(video_id, topic_id)` unique index. With `topic_id=None`, dedup only works on `video_id` (two NULL topic_ids are not considered equal in PostgreSQL unique indexes by default -- this would allow duplicates).
- The `research_session_service.get_sessions()` uses `outerjoin` for Topic, so sessions with `topic_id=None` would still appear. However, video fetching inside `get_sessions()` has a guard: `if session.topic_id and session.started_at` -- sessions without a topic_id will show **zero videos** in the History page even if history entries exist.
- `history_repo.get_history_stats()` uses INNER JOINs for `by_topic` and `by_channel`, so entries without topic/channel are silently excluded from stats.

### Parent Strategies
- `strategies` table exists with full schema: `name`, `description`, `source_channel_id` (nullable FK to `channels`), `source_videos`, `parameters`, `entry_rules`, `exit_rules`, `risk_management`, `notes`, `status`.
- `drafts` table has a `strategy_id` FK (nullable) pointing to `strategies.id`.
- **Current gap**: The pipeline calls `insert_strategy(session, data)` which calls `upsert_strategy()` but **never passes `source_channel_id`**. The `insert_strategy()` convenience function explicitly ignores the `source_channel` field from YAML because it's a name, not an ID.
- `upsert_draft()` accepts `strategy_id` as an optional parameter, but the pipeline **never links drafts to strategies**. The SKILL.md shows `strategy_id` in the signature but the AGENT.md pipeline steps never establish this link.
- The `strategy-variants` SKILL.md outputs a `parent_strategy` field per variant, but this is just a string name -- it's never used to create a parent Strategy row or link Draft to Strategy.

### Frontend Expectations

**HistoryPage.tsx**:
- Grouped view: fetches sessions via `getResearchSessions(50)`, expects `session.topic`, `session.videos[]` with `video_id`, `url`, `title`, `channel`, `strategies_found`, `classification`.
- Flat view: fetches history entries with topic/channel/date filters.
- Sessions without `topic_id` will appear but show "No topic" and zero videos (due to the guard in the service).

**StrategiesPage.tsx**:
- Expects `source_channel` per strategy (from the LEFT JOIN on `channels`).
- Has a session filter dropdown that filters strategies by `created_at` within the session's time window.
- Has a channel filter dropdown populated from the loaded strategies' `source_channel` values.
- Strategies without `source_channel_id` will show no channel name, breaking the channel filter.

## Affected Areas

| Layer | File | Impact |
|-------|------|--------|
| Pipeline agent | `.claude/agents/research/AGENT.md` | Must support 3 entry points |
| Session repo | `tools/db/research_repo.py` | `create_session()` needs to work without topic |
| History repo | `tools/db/research_repo.py` | `add_history()` dedup with NULL topic_id |
| Strategy repo | `tools/db/strategy_repo.py` | `insert_strategy()` should pass `source_channel_id` |
| Draft repo | `tools/db/draft_repo.py` | Pipeline should link `strategy_id` to drafts |
| Session service | `api/services/research_session_service.py` | Video query guard excludes NULL topic sessions |
| Strategy service | `api/services/strategy_service.py` | Already uses LEFT JOIN, works but channel filter UX degrades |
| History repo (API) | `tools/db/history_repo.py` | Stats use INNER JOINs, excludes NULL topic/channel entries |
| Models | `tools/db/models.py` | Dedup index on `(video_id, topic_id)` with NULLs |
| Frontend | `HistoryPage.tsx`, `StrategiesPage.tsx` | Graceful handling of missing topic/channel |
| DB-manager SKILL | `.claude/skills/db-manager/SKILL.md` | Instructions need parent strategy + draft linking |
| Strategy-variants SKILL | `.claude/skills/strategy-variants/SKILL.md` | Already outputs `parent_strategy` field |

## Key Questions Answered

### 1. Session Tracking
- `create_session()` must be called at pipeline start. Currently requires `topic_slug` string.
- **Fix needed**: Accept optional `topic_slug` + optional `label` (free-text description for non-topic sessions). When `topic_slug` is None, `topic_id` will be None -- this is fine since the column is already nullable.
- `complete_session()` and `error_session()` only need `session_id` -- they work for all entry points already.

### 2. History Linking
- `topic_id` and `channel_id` are already nullable in the model. `add_history()` already accepts them as optional.
- **INNER vs LEFT JOIN issue**: `research_session_service.get_sessions()` already uses `outerjoin` for Topic, BUT the video sub-query has `if session.topic_id and session.started_at` guard that excludes videos for NULL-topic sessions. **Fix**: change this guard to only check `session.started_at`, and match history by time window instead of by `topic_id` when `topic_id` is None.
- `history_repo.get_history_stats()` uses INNER JOINs for `by_topic` and `by_channel` stats -- entries without topic/channel won't appear in stats. **Fix**: change to LEFT JOINs and add an "Uncategorized" bucket.
- **Dedup**: The unique index `(video_id, topic_id)` with NULLs is problematic. In PostgreSQL, `(X, NULL) != (X, NULL)` in unique indexes. This means the same video researched twice without a topic would create duplicates. **Fix**: Add a partial unique index for `video_id WHERE topic_id IS NULL`, or use `COALESCE(topic_id, 0)` in the index.

### 3. Parent Strategies
- The `strategies` table is fully set up. The `drafts.strategy_id` FK exists but is never populated.
- The `strategy-variants` skill already outputs `parent_strategy` (the original strategy name before splitting into variants).
- **Missing link in pipeline**: After Step 6 (db-manager saves strategies), the translator/db-manager should:
  1. Call `upsert_strategy()` for the parent strategy, getting back its `id`
  2. Call `upsert_draft()` with `strategy_id=parent.id` for each variant draft
- `insert_strategy()` exists but ignores `source_channel` (name). It should resolve channel name to `channel_id` or accept `source_channel_id` directly.

### 4. Entry Point Flexibility

**Topic entry point** (current, fully working):
- Has: topic slug, channel list, video URLs, channel names/IDs
- All data flows naturally through the pipeline

**Video URL entry point** (new):
- Has: video URL -> can extract `video_id`, channel name, channel URL via yt-dlp metadata
- Missing: `topic_id` (no topic), `channel_id` (channel may not be in DB)
- Can get: channel name from yt-dlp `--print channel`, channel URL from `--print channel_url`
- Pipeline steps 2-5 (NotebookLM -> variants -> translator -> db-manager) work unchanged
- Steps 1 (yt-scraper) and 1.5 (classifier) are skipped -- video URL is given directly
- Step 5 (history): save with `topic_id=None`, `channel_id=None` (or resolve if channel exists)

**Raw idea entry point** (new):
- Has: text description of a strategy idea (no video, no channel, no topic)
- Missing: everything -- no video_id, no URL, no channel, no topic
- Steps 1, 1.5, 2 (scraper, classifier, NotebookLM) are all skipped
- Step 3 (strategy-variants): takes the idea text as input instead of NotebookLM output
- Steps 4-6 (translator, db-manager): work unchanged
- History: nothing to record (no video was researched)
- Session tracking: still useful to show on the Live page

### 5. Minimum Change Set

**Tier 1 -- Make sessions and history work without topic (small, low risk)**:
1. `create_session()`: make `topic_slug` optional, add optional `label` param for display
2. `ResearchSession` model: add `label` column (nullable String) for free-text session description
3. `research_session_service.get_sessions()`: remove the `if session.topic_id` guard for videos, use time window matching for all sessions
4. Fix dedup index for NULL `topic_id`

**Tier 2 -- Link strategies to drafts (medium, medium risk)**:
5. Pipeline step 6: after creating strategies, link drafts to their parent strategy via `strategy_id`
6. `insert_strategy()`: add channel name -> `channel_id` resolution (or let caller pass it)
7. Update `db-manager/SKILL.md` with parent linking instructions

**Tier 3 -- Support video URL entry point (medium, low risk)**:
8. AGENT.md: add video URL entry path that skips steps 1 and 1.5
9. Extract channel metadata from yt-dlp for the video
10. Feed video URL directly to NotebookLM analyst

**Tier 4 -- Support raw idea entry point (small, low risk)**:
11. AGENT.md: add raw idea entry path that skips steps 1, 1.5, and 2
12. Feed idea text directly to strategy-variants
13. Session tracking with `label` instead of `topic`

## Approaches

### Approach A: Incremental (Recommended)
Implement Tiers 1-4 in order. Each tier is independently valuable and testable. Tier 1 unblocks the frontend for all entry points. Tier 2 improves data quality. Tiers 3-4 add the new entry points.

### Approach B: Big Bang
Implement all tiers at once. Riskier, harder to test, but faster if everything goes right.

### Approach C: Frontend-Only Workaround
Only fix the frontend to gracefully handle missing data (null topic, null channel). Doesn't fix the underlying data model gaps. Quick but leaves technical debt.

## Recommendation

**Approach A (Incremental)** -- Implement in 4 tiers.

Rationale:
- Tier 1 is the foundation -- without it, sessions from non-topic entry points produce broken frontend output (History page shows no videos, stats exclude uncategorized entries).
- Tier 2 is important for the Strategies page -- without `source_channel_id` and `strategy_id` links, filtering by channel or viewing drafts per strategy doesn't work properly.
- Tiers 3 and 4 are mostly AGENT.md changes (pipeline orchestration) with minimal code changes.
- Each tier can be committed, tested, and deployed independently.

Total estimated changes:
- **Tier 1**: ~4 files modified, 1 migration
- **Tier 2**: ~3 files modified, skill docs updated
- **Tier 3**: ~1 file modified (AGENT.md), plus minor repo helpers
- **Tier 4**: ~1 file modified (AGENT.md)

## Risks

1. **Migration risk**: Adding `label` column to `research_sessions` requires an Alembic migration. Low risk since it's a nullable column addition.
2. **Dedup index change**: Modifying the unique index on `(video_id, topic_id)` could affect existing data. Need to check for existing NULL-topic entries before migrating.
3. **History time-window matching**: Removing the `topic_id` guard in `get_sessions()` means videos are matched to sessions purely by time window. If two sessions overlap in time (unlikely but possible), videos could show under the wrong session.
4. **AGENT.md complexity**: Adding three entry points to one agent increases complexity. The agent instructions are already long. Risk of LLM confusion during execution.
5. **Stats accuracy**: Changing INNER JOINs to LEFT JOINs in `get_history_stats()` will include previously-excluded entries, changing the numbers users see.
