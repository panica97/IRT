# Design: Research Pipeline Flexibility

## Architecture Decisions

### 1. Optional `topic_slug` vs synthetic "ad-hoc" topic

**Decision: Make `topic_slug` optional (pass `None`).**

Rationale:
- A synthetic "ad-hoc" topic would pollute the `topics` table with a row that has no channels and no real meaning. Every query that groups by topic would need to special-case it.
- The `topic_id` column on `ResearchSession` and `ResearchHistory` is already nullable. The schema was designed to allow this — we just never used it.
- With `topic_slug=None`, `_resolve_topic_id()` is simply not called, and `topic_id` stays `None`. All existing code that checks `topic_id IS NOT NULL` continues to work correctly for topic-based sessions.
- A new `label` column on `ResearchSession` provides the human-readable description for non-topic sessions (e.g., "Video: How to Trade RSI Divergences" or "Idea: RSI divergence with SAR confirmation").

### 2. LEFT JOIN vs creating placeholder topic/channel records

**Decision: Use LEFT JOIN (outerjoin) for stats queries. Do NOT create placeholder records.**

Rationale:
- Creating placeholder "Unknown" topic/channel rows introduces referential integrity problems — channels require a `topic_id` FK (non-nullable), so a placeholder channel can't exist without a placeholder topic, creating a chain of fake data.
- LEFT JOINs are the standard SQL pattern for "include rows even when the FK is NULL." The queries already use `outerjoin` in `list_history()` and `get_sessions()` — only the stats functions use INNER JOIN.
- Entries without a topic appear under a `null` key in the `by_topic` dict (frontend can display as "Uncategorized"). Same for `by_channel`.

### 3. Session tracking placement in AGENT.md

**Decision: Session tracking calls stay in the same location (pipeline start/step/end) but the `create_session()` call is updated to handle all three entry points.**

Rationale:
- Session tracking is already at the right layer — the research agent. It wraps the entire pipeline execution.
- The only change is: `create_session(session, topic_slug)` becomes `create_session(session, topic_slug=None, label="...")`. The rest of the session lifecycle (`update_session_step`, `complete_session`, `error_session`) works unchanged.
- For video URL entry points, the label is derived from the video title or URL. For raw idea entry points, the label is the idea text (truncated).

---

## File Changes

### 1. `tools/db/models.py` — Add `label` column to `ResearchSession`

**Model: `ResearchSession`** (line 152-185)

Add after `topic_id` (line 158):
```python
label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
```

This column provides a human-readable description for sessions that have no topic. For topic-based sessions it can remain `None` (the frontend already displays the topic slug).

**Migration required**: New Alembic migration adding nullable `label` column to `research_sessions`.

### 2. `tools/db/research_repo.py` — Make `create_session()` accept optional topic

**Function: `create_session()`** (line 43-64)

Change signature from:
```python
def create_session(session: Session, topic_slug: str) -> ResearchSession:
```
To:
```python
def create_session(
    session: Session,
    topic_slug: str | None = None,
    label: str | None = None,
) -> ResearchSession:
```

Change body: only call `_resolve_topic_id()` when `topic_slug is not None`. Set `rs.label = label`.

```python
topic_id = _resolve_topic_id(session, topic_slug) if topic_slug else None
rs = ResearchSession(
    status="running",
    topic_id=topic_id,
    label=label,
    step=0,
    step_name="preflight",
    total_steps=6,
)
```

### 3. `api/services/research_session_service.py` — Remove topic_id guard for videos

**Function: `get_sessions()`** (line 42-70)

Change the video sub-query guard from:
```python
if session.topic_id and session.started_at:
```
To:
```python
if session.started_at:
```

When `topic_id` is `None`, match history entries by time window only (remove the `ResearchHistory.topic_id == session.topic_id` filter for NULL-topic sessions):
```python
if session.started_at:
    video_q = (
        select(...)
        .outerjoin(Channel, ResearchHistory.channel_id == Channel.id)
        .where(ResearchHistory.researched_at >= session.started_at)
    )
    if session.topic_id is not None:
        video_q = video_q.where(ResearchHistory.topic_id == session.topic_id)
    if session.completed_at:
        video_q = video_q.where(ResearchHistory.researched_at <= session.completed_at)
```

Also include `label` in the returned dict:
```python
results.append({
    ...
    "topic": topic_slug,
    "label": session.label,
    ...
})
```

**Function: `get_session_by_id()`** (line 113)

Same guard change: `if session.topic_id and session.started_at:` becomes the same conditional pattern as above. Include `label` in the returned dict.

### 4. `api/services/history_service.py` — Change INNER JOINs to LEFT JOINs in stats

**Function: `get_history_stats()`** (line 112-169)

**by_topic** (line 127-132): Change `.join(ResearchHistory, ...)` to `.outerjoin(...)` and add an "Uncategorized" bucket:
```python
by_topic_q = (
    select(
        func.coalesce(Topic.slug, "Uncategorized").label("slug"),
        func.count(),
    )
    .select_from(ResearchHistory)
    .outerjoin(Topic, ResearchHistory.topic_id == Topic.id)
    .group_by(func.coalesce(Topic.slug, "Uncategorized"))
)
```

**by_channel** (line 135-140): Same pattern:
```python
by_channel_q = (
    select(
        func.coalesce(Channel.name, "Unknown").label("name"),
        func.count(),
    )
    .select_from(ResearchHistory)
    .outerjoin(Channel, ResearchHistory.channel_id == Channel.id)
    .group_by(func.coalesce(Channel.name, "Unknown"))
)
```

### 5. `tools/db/history_repo.py` — Change INNER JOINs to LEFT JOINs in sync stats

**Function: `get_history_stats()`** (line 106-184)

Same changes as `api/services/history_service.py` above, applied to the sync version:

- **by_topic** (line 129-141): `.join(Topic, ...)` becomes `.outerjoin(Topic, ...)` with `COALESCE(Topic.slug, 'Uncategorized')`.
- **by_channel** (line 144-156): `.join(Channel, ...)` becomes `.outerjoin(Channel, ...)` with `COALESCE(Channel.name, 'Unknown')`.
- **last_research** (line 159-168): Already uses `.join(Topic, ...)` — change to `.outerjoin(Topic, ...)`. The topic field may be `None` for non-topic sessions.

### 6. `tools/db/strategy_repo.py` — Pass `source_channel_id` through `insert_strategy()`

**Function: `insert_strategy()`** (line 96-114)

Add `source_channel_id` passthrough from `data` dict:
```python
def insert_strategy(session: Session, data: dict[str, Any]) -> Strategy:
    return upsert_strategy(
        session,
        name=data["name"],
        description=data.get("description"),
        source_channel_id=data.get("source_channel_id"),  # NEW
        source_videos=data.get("source_videos"),
        parameters=data.get("parameters"),
        entry_rules=data.get("entry_rules"),
        exit_rules=data.get("exit_rules"),
        risk_management=data.get("risk_management"),
        notes=data.get("notes"),
    )
```

**No new function needed** — `upsert_strategy()` already accepts `source_channel_id` as a keyword argument (line 46). The caller (db-manager / agent) is responsible for resolving channel name to `channel_id` before calling `insert_strategy()`.

Add a new helper to `channel_repo.py` for channel name resolution:

**New function in `tools/db/channel_repo.py`:**
```python
def get_channel_by_name(session: Session, name: str) -> Channel | None:
    """Return a channel by name (case-insensitive), or None."""
    stmt = select(Channel).where(func.lower(Channel.name) == name.lower())
    return session.execute(stmt).scalar_one_or_none()
```

### 7. `tools/db/draft_repo.py` — No code changes needed

`upsert_draft()` already accepts `strategy_id` as an optional parameter. The change is in the **caller** (db-manager instructions) which must pass `strategy_id` when saving drafts.

### 8. Alembic Migration

New migration file in `api/alembic/versions/`:
- Add `label` column (nullable `VARCHAR(255)`) to `research_sessions` table.

---

## Data Flow

### 1. Topic-based: `/research futures`

```
User: /research futures
  |
  v
AGENT reads topic_slug="futures" from input
  |
  v
create_session(session, topic_slug="futures")
  -> resolves topic_id via _resolve_topic_id("futures")
  -> label=None (topic slug is displayed instead)
  |
  v
Step 1: yt-scraper fetches videos for topic "futures"
  -> gets channel_id from channels.yaml / DB for each video
  |
  v
Step 1.5: video-classifier filters irrelevant videos
  -> saves irrelevant to add_history(video_id, url, channel_id, topic_id)
  |
  v
Step 2: notebooklm-analyst extracts strategies from videos
  |
  v
Step 3: strategy-variants produces variants with parent_strategy field
  |
  v
Step 4: strategy-translator converts to IBKR JSON drafts
  |
  v
Step 5: cleanup + add_history(video_id, url, channel_id, topic_id, strategies_found)
  |
  v
Step 6: db-manager
  -> For each parent_strategy name from Step 3 output:
     1. Resolve channel_id from source_channel name (via get_channel_by_name)
     2. insert_strategy(session, {name, description, source_channel_id, ...})
        -> returns Strategy with id
     3. For each variant draft of that parent:
        upsert_draft(session, strat_code, strat_name, data, strategy_id=parent.id)
```

### 2. Video URL: `/research https://youtube.com/watch?v=xyz`

```
User: /research https://youtube.com/watch?v=xyz
  |
  v
AGENT detects URL input (regex match on youtube.com/watch or youtu.be)
  |
  v
create_session(session, topic_slug=None, label="Video: <video_title or URL>")
  -> topic_id=None, label set for display
  |
  v
Step 0: preflight (same as topic-based)
  |
  v
Step 1: SKIPPED (video URL is already known)
  -> Extract video metadata via yt-dlp:
     python -m tools.youtube.search --info <url>
     -> gets: video_id, title, channel_name, channel_url
  |
  v
Step 1.5: SKIPPED (single video, user explicitly chose it)
  |
  v
Step 2: notebooklm-analyst (same as topic-based, single video URL as source)
  |
  v
Step 3: strategy-variants (same)
  |
  v
Step 4: strategy-translator (same)
  |
  v
Step 5: cleanup + add_history(video_id, url, channel_id=None, topic_id=None, strategies_found)
  Note: channel_id is None unless channel_name matches an existing channel in DB
  |
  v
Step 6: db-manager (same as topic-based, but source_channel_id may be None)
```

### 3. Raw idea: `/research "RSI divergence with SAR confirmation"`

```
User: /research "RSI divergence with SAR confirmation"
  |
  v
AGENT detects raw idea input (not a URL, not a known topic slug)
  |
  v
create_session(session, topic_slug=None, label="Idea: RSI divergence with SAR confirmation")
  -> topic_id=None, label set for display
  |
  v
Step 0: preflight (same — still needs NotebookLM auth for potential future use)
  |
  v
Steps 1, 1.5, 2: ALL SKIPPED (no video to fetch, classify, or analyze)
  |
  v
Step 3: strategy-variants
  -> Input: the idea text is formatted as a single strategy YAML:
     name: "RSI Divergence SAR"
     description: "RSI divergence with SAR confirmation"
     entry_rules: ["RSI divergence detected", "SAR confirms direction"]
     exit_rules: ["_TODO"]
  -> Produces variants as normal
  |
  v
Step 4: strategy-translator (same)
  |
  v
Step 5: cleanup (no notebook to delete if Step 2 was skipped, no history to record)
  |
  v
Step 6: db-manager (same, but source_channel_id=None, source_videos=[])
```

---

## Interfaces

### Updated `create_session()` signature

```python
def create_session(
    session: Session,
    topic_slug: str | None = None,
    label: str | None = None,
) -> ResearchSession:
```

- `topic_slug`: Optional. When provided, resolves to `topic_id`. When `None`, `topic_id` is `None`.
- `label`: Optional. Free-text description for the session. Used by frontend when `topic_id` is `None`. Examples: `"Video: How to Trade RSI"`, `"Idea: RSI divergence"`.
- Returns: `ResearchSession` with auto-generated `id`.

### Updated `insert_strategy()` to accept `source_channel_id`

```python
def insert_strategy(session: Session, data: dict[str, Any]) -> Strategy:
```

No signature change — but `data` dict now supports `source_channel_id` key:
```python
data = {
    "name": "RSI Divergence SAR",
    "description": "...",
    "source_channel_id": 42,  # NEW - optional, resolved by caller
    "source_videos": ["https://..."],
    "entry_rules": [...],
    "exit_rules": [...],
    ...
}
```

### Updated `upsert_draft()` — no code change, usage change

Already accepts `strategy_id`. The db-manager must now pass it:
```python
upsert_draft(
    session,
    strat_code=9001,
    strat_name="RSI_Divergence_SAR_360m",
    data=draft_json,
    strategy_id=parent_strategy.id,  # NEW - link to parent
)
```

### How db-manager creates parent strategies from variants output

The `strategy-variants` skill output includes a `parent_strategy` field per variant. The db-manager groups variants by `parent_strategy` and:

1. Calls `insert_strategy(session, parent_data)` once per unique `parent_strategy` name.
2. Captures the returned `Strategy.id`.
3. Calls `upsert_draft(session, ..., strategy_id=parent_id)` for each variant of that parent.

```python
from tools.db.session import sync_session_ctx
from tools.db.strategy_repo import insert_strategy
from tools.db.draft_repo import upsert_draft
from tools.db.channel_repo import get_channel_by_name

with sync_session_ctx() as session:
    # Group variants by parent_strategy
    parents = {}
    for variant in variants:
        parent_name = variant["parent_strategy"]
        if parent_name not in parents:
            parents[parent_name] = []
        parents[parent_name].append(variant)

    for parent_name, variant_list in parents.items():
        # Resolve channel name to ID if available
        source_channel_id = None
        source_channel = variant_list[0].get("source_channel")
        if source_channel:
            ch = get_channel_by_name(session, source_channel)
            if ch:
                source_channel_id = ch.id

        # Create/update parent strategy
        parent = insert_strategy(session, {
            "name": parent_name,
            "description": variant_list[0].get("description", ""),
            "source_channel_id": source_channel_id,
            "source_videos": variant_list[0].get("source_videos", []),
            "entry_rules": variant_list[0].get("entry_rules", []),
            "exit_rules": variant_list[0].get("exit_rules", []),
        })

        # Save each variant draft linked to parent
        for variant in variant_list:
            upsert_draft(
                session,
                strat_code=variant["strat_code"],
                strat_name=variant["variant_name"],
                data=variant["draft_json"],
                strategy_id=parent.id,
            )
```

### New helper: `get_channel_by_name()`

```python
# In tools/db/channel_repo.py
def get_channel_by_name(session: Session, name: str) -> Channel | None:
    """Return a channel by name (case-insensitive), or None."""
    stmt = select(Channel).where(func.lower(Channel.name) == name.lower())
    return session.execute(stmt).scalar_one_or_none()
```

---

## Agent/Skill Instruction Changes

### AGENT.md Changes

**Section: Input** (line 12-14)

Replace:
```
- `topic` -- el topic a investigar (debe existir en `data/channels/channels.yaml`)
```
With:
```
- `input` -- one of:
  - A topic slug (must exist in `data/channels/channels.yaml`) — runs full pipeline
  - A YouTube video URL (https://youtube.com/watch?v=... or https://youtu.be/...) — skips Steps 1 and 1.5
  - A raw idea string (anything else) — skips Steps 1, 1.5, and 2
- `save_conversations` -- (optional, default false)
```

**New section after Input: "Entry Point Detection"**

Add:
```markdown
## Entry Point Detection

Determine the entry point type from the input:

1. **URL**: input matches `youtube.com/watch` or `youtu.be/` → VIDEO entry point
2. **Topic**: input matches a slug in `data/channels/channels.yaml` → TOPIC entry point
3. **Idea**: anything else → IDEA entry point
```

**Section: Session Tracking** (line 236-262)

Update the `create_session` call to handle all entry points:
```python
# TOPIC entry point:
research_session = create_session(session, topic_slug=topic)

# VIDEO entry point:
research_session = create_session(session, label=f"Video: {video_title or video_url}")

# IDEA entry point:
research_session = create_session(session, label=f"Idea: {idea_text[:100]}")
```

**Section: Step 1 (YouTube Scraper)** (line 49-71)

Add at the top:
```
**VIDEO and IDEA entry points**: Skip this step entirely.
For VIDEO: extract metadata with `yt-dlp --print title --print channel --print channel_url <url>`.
For IDEA: no video metadata needed.
```

**Section: Step 1.5 (Video Classifier)** (line 76-106)

Add:
```
**VIDEO and IDEA entry points**: Skip this step entirely.
```

**Section: Step 2 (NotebookLM Analyst)** (line 108-131)

Add:
```
**IDEA entry point**: Skip this step. Format the idea text as a strategy YAML and pass directly to Step 3.
**VIDEO entry point**: Use the single video URL as the only source.
```

**Section: Step 5 (Cleanup)** (line 155-196)

Add:
```
**IDEA entry point**: No notebook to delete, no history to record. Skip to Step 6.
**VIDEO entry point**: Record history with topic_id=None. channel_id is resolved if the channel exists in DB, otherwise None.
```

**Section: Step 6 (DB Manager)** (line 198-213)

Replace the simple `insert_strategy` loop with instructions to also create parent strategies and link drafts. Reference the updated db-manager SKILL.md.

### db-manager SKILL.md Changes

**Section: "How to save strategies"** (line 16-25)

Replace the simple loop with the parent-strategy-first flow:

```markdown
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

**Section: "Saving Drafts"** (line 47-64)

Update to emphasize `strategy_id` is now **required** (not optional):
```
Each draft MUST be linked to its parent strategy via `strategy_id`. The parent strategy must be created first via `insert_strategy()`.
```

**Section: "Rules"**

Add:
```
- Always create the parent strategy BEFORE creating its variant drafts
- Always pass `strategy_id` when calling `upsert_draft()`
- Resolve `source_channel` name to `source_channel_id` via `get_channel_by_name()` — if the channel is not in the DB, pass `None`
```
