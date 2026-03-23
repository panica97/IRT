# Tasks: Research Pipeline Flexibility

**Change**: research-pipeline-flexibility
**Specs**: research-session, research-history, strategy-linking
**Design**: design.md
**Status**: in-progress

---

## Phase 1: Database & Model Changes

### [x] 1.1 Add `label`, `strategies_found`, `drafts_created` columns to ResearchSession model

**File**: `tools/db/models.py` (lines 152-185, class `ResearchSession`)

Add three new columns after `topic_id` (line 159):

```python
label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
strategies_found: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
drafts_created: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
```

**Refs**: spec `research-session` RS-1 (label), RS-3 (strategies_found, drafts_created); design section 1.

### [x] 1.2 Create Alembic migration

**File**: New file `api/alembic/versions/008_add_session_label_and_stats.py`

Follow the naming convention of existing migrations (e.g., `007_add_backtesting.py`).

Migration must:
- Add nullable `label` column (`VARCHAR(255)`) to `research_sessions`
- Add nullable `strategies_found` column (`INTEGER`) to `research_sessions`
- Add nullable `drafts_created` column (`INTEGER`) to `research_sessions`
- Downgrade: drop all three columns

No backfill needed -- all columns are nullable.

**Refs**: spec `research-session` "Migration" section; design section 8.

### [x] 1.3 Run migration

```bash
docker compose exec api alembic upgrade head
```

Verify the columns exist in the `research_sessions` table.

---

## Phase 2: Backend Repo/Service Fixes

### [x] 2.1 Make `topic_slug` optional in `create_session()`

**File**: `tools/db/research_repo.py`, function `create_session()` (lines 43-64)

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

Change body (line 53):
```python
# Before:
topic_id = _resolve_topic_id(session, topic_slug)
# After:
topic_id = _resolve_topic_id(session, topic_slug) if topic_slug else None
```

Add `label=label` to the `ResearchSession(...)` constructor (line 54).

**Refs**: spec `research-session` RS-1; design section 2.

### [x] 2.2 Update `complete_session()` to accept stats

**File**: `tools/db/research_repo.py`, function `complete_session()` (lines 94-112)

Change signature to add optional `strategies_found` and `drafts_created` params:
```python
def complete_session(
    session: Session,
    session_id: int,
    result_summary: dict[str, Any] | None = None,
    strategies_found: int | None = None,
    drafts_created: int | None = None,
) -> None:
```

Set `rs.strategies_found` and `rs.drafts_created` in the function body before flush.

**Refs**: spec `research-session` RS-3.

### [x] 2.3 Remove `topic_id` guard in `get_sessions()`

**File**: `api/services/research_session_service.py`, function `get_sessions()` (lines 43-84)

Change the video sub-query guard (line 43):
```python
# Before:
if session.topic_id and session.started_at:
# After:
if session.started_at:
```

Make the `topic_id` filter conditional (lines 54-55):
```python
# Keep the base query without topic_id filter
video_q = (
    select(...)
    .outerjoin(Channel, ResearchHistory.channel_id == Channel.id)
    .where(ResearchHistory.researched_at >= session.started_at)
)
# Only add topic_id filter when it's not NULL
if session.topic_id is not None:
    video_q = video_q.where(ResearchHistory.topic_id == session.topic_id)
if session.completed_at:
    video_q = video_q.where(ResearchHistory.researched_at <= session.completed_at)
```

Add `label` and stats to the returned dict (line 72):
```python
results.append({
    ...
    "topic": topic_slug,
    "label": session.label,
    "title": topic_slug or session.label or "Untitled session",
    "strategies_found": session.strategies_found,
    "drafts_created": session.drafts_created,
    ...
})
```

**Refs**: spec `research-session` RS-2; design section 3.

### [x] 2.4 Remove `topic_id` guard in `get_session_by_id()`

**File**: `api/services/research_session_service.py`, function `get_session_by_id()` (lines 87-155)

Same changes as 2.3 -- the guard is at line 113:
```python
# Before:
if session.topic_id and session.started_at:
# After:
if session.started_at:
```

Make topic_id filter conditional (line 125):
```python
if session.topic_id is not None:
    video_q = video_q.where(ResearchHistory.topic_id == session.topic_id)
```

Add `label`, `title`, `strategies_found`, `drafts_created` to the returned dict (lines 144-155).

**Refs**: spec `research-session` RS-2; design section 3.

### [x] 2.5 Change INNER JOINs to LEFT JOINs in async `get_history_stats()`

**File**: `api/services/history_service.py`, function `get_history_stats()` (lines 112-169)

**by_topic** (lines 127-132): Change `.join(ResearchHistory, ...)` to `.outerjoin(...)` and wrap slug with `COALESCE`:
```python
by_topic_rows = await db.execute(
    select(
        func.coalesce(Topic.slug, "Uncategorized").label("slug"),
        func.count(),
    )
    .select_from(ResearchHistory)
    .outerjoin(Topic, ResearchHistory.topic_id == Topic.id)
    .group_by(func.coalesce(Topic.slug, "Uncategorized"))
)
```

**by_channel** (lines 134-140): Same pattern:
```python
by_channel_rows = await db.execute(
    select(
        func.coalesce(Channel.name, "Unknown channel").label("name"),
        func.count(),
    )
    .select_from(ResearchHistory)
    .outerjoin(Channel, ResearchHistory.channel_id == Channel.id)
    .group_by(func.coalesce(Channel.name, "Unknown channel"))
)
```

**Refs**: spec `research-history` RH-2; design section 4.

### [x] 2.6 Change INNER JOINs to LEFT JOINs in sync `get_history_stats()`

**File**: `tools/db/history_repo.py`, function `get_history_stats()` (lines 106-184)

**by_topic** (lines 129-141): Change `.join(Topic, ...)` to `.outerjoin(Topic, ...)`, wrap with `COALESCE(Topic.slug, 'Uncategorized')`.

**by_channel** (lines 144-156): Change `.join(Channel, ...)` to `.outerjoin(Channel, ...)`, wrap with `COALESCE(Channel.name, 'Unknown channel')`.

**last_research** (lines 159-168): Change `.join(Topic, ...)` to `.outerjoin(Topic, ...)`. The `topic` field in the result may now be `None`.

**Refs**: spec `research-history` RH-2; design section 5.

### [x] 2.7 Pass `source_channel_id` in `insert_strategy()`

**File**: `tools/db/strategy_repo.py`, function `insert_strategy()` (lines 96-114)

Add `source_channel_id` passthrough from the `data` dict (line 104, inside the `upsert_strategy()` call):
```python
return upsert_strategy(
    session,
    name=data["name"],
    description=data.get("description"),
    source_channel_id=data.get("source_channel_id"),  # NEW
    source_videos=data.get("source_videos"),
    ...
)
```

No other changes needed -- `upsert_strategy()` already accepts `source_channel_id` (line 45).

**Refs**: spec `strategy-linking` SL-3; design section 6.

### [x] 2.8 Add `get_channel_by_name()` helper

**File**: `tools/db/channel_repo.py` (append after existing functions, after line 158)

Add new function:
```python
def get_channel_by_name(session: Session, name: str) -> Channel | None:
    """Return a channel by name (case-insensitive), or None."""
    stmt = select(Channel).where(func.lower(Channel.name) == name.lower())
    return session.execute(stmt).scalar_one_or_none()
```

Add `func` import from `sqlalchemy` if not already present.

**Refs**: spec `strategy-linking` SL-3; design section 6.

---

## Phase 3: Skill/Agent Instruction Updates

### [x] 3.1 Update `AGENT.md` -- Input section and entry point detection

**File**: `.claude/agents/research/AGENT.md` (lines 11-14)

Replace the Input section:
```markdown
## Input

- `input` -- one of:
  - A topic slug (must exist in `data/channels/channels.yaml`) -- runs full pipeline
  - A YouTube video URL (https://youtube.com/watch?v=... or https://youtu.be/...) -- skips Steps 1 and 1.5
  - A raw idea string (anything else) -- skips Steps 1, 1.5, and 2
- `save_conversations` -- (optional, default false)
```

Add a new section after Input:
```markdown
## Entry Point Detection

Determine the entry point type from the input:

1. **URL**: input matches `youtube.com/watch` or `youtu.be/` -> VIDEO entry point
2. **Topic**: input matches a slug in `data/channels/channels.yaml` -> TOPIC entry point
3. **Idea**: anything else -> IDEA entry point
```

**Refs**: design "Agent/Skill Instruction Changes" section.

### [x] 3.2 Update `AGENT.md` -- Session tracking for all entry points

**File**: `.claude/agents/research/AGENT.md` (lines 236-262, "Session Tracking" section)

Update the `create_session()` call to handle all entry points:
```python
# TOPIC entry point:
research_session = create_session(session, topic_slug=topic)

# VIDEO entry point:
research_session = create_session(session, label=f"Video: {video_title or video_url}")

# IDEA entry point:
research_session = create_session(session, label=f"Idea: {idea_text[:100]}")
```

Update the `complete_session()` call to pass stats:
```python
complete_session(session, session_id,
    result_summary={...},
    strategies_found=<count>,
    drafts_created=<count>,
)
```

Make session tracking MANDATORY for all entry points (remove the "when DATABASE_URL is set" caveat from the section title, or clarify that it's always required when DB is available).

**Refs**: spec `research-session` RS-1, RS-3; design sections 2-3.

### [x] 3.3 Update `AGENT.md` -- Conditional step skipping

**File**: `.claude/agents/research/AGENT.md`

Add skip instructions to each relevant step:

- **Step 1** (line 48): Add at top: "VIDEO and IDEA entry points: Skip this step entirely. For VIDEO: extract metadata with `yt-dlp --print title --print channel --print channel_url <url>`. For IDEA: no video metadata needed."
- **Step 1.5** (line 74): Add: "VIDEO and IDEA entry points: Skip this step entirely."
- **Step 2** (line 108): Add: "IDEA entry point: Skip this step. Format the idea text as a strategy YAML and pass directly to Step 3. VIDEO entry point: Use the single video URL as the only source."
- **Step 5** (line 155): Add: "IDEA entry point: No notebook to delete, no history to record. Skip to Step 6. VIDEO entry point: Record history with topic_id=None."

**Refs**: design "Data Flow" sections 2 and 3.

### [x] 3.4 Update `AGENT.md` -- Step 6 (DB Manager) for parent strategies

**File**: `.claude/agents/research/AGENT.md` (lines 198-213, "Step 6: DB Manager")

Replace the simple `insert_strategy` loop with instructions referencing the updated db-manager SKILL.md. The agent must:
1. Group variants by `parent_strategy`
2. Resolve `source_channel` name to `source_channel_id` via `get_channel_by_name()`
3. Call `insert_strategy()` with `source_channel_id` per parent
4. Call `upsert_draft()` with `strategy_id=parent.id` per variant

**Refs**: spec `strategy-linking` SL-1, SL-2; design section 6.

### [x] 3.5 Update `db-manager SKILL.md` -- Parent strategy creation and draft linking

**File**: `.claude/skills/db-manager/SKILL.md`

**"How to save strategies" section** (lines 14-25): Replace with the parent-strategy-first flow:
1. Group variants by `parent_strategy` name
2. For each parent: resolve channel, call `insert_strategy()` with `source_channel_id`, capture returned `Strategy.id`
3. For each variant: call `upsert_draft()` with `strategy_id=parent.id`

Include the full code example from the design (design section "How db-manager creates parent strategies from variants output").

**"Saving Drafts" section** (lines 45-64): Update to state that `strategy_id` is now **required** (not optional). Each draft MUST be linked to its parent strategy.

**"Rules" section** (lines 37-43): Add rules:
- Always create the parent strategy BEFORE creating its variant drafts
- Always pass `strategy_id` when calling `upsert_draft()`
- Resolve `source_channel` name to `source_channel_id` via `get_channel_by_name()` -- if the channel is not in the DB, pass `None`

**Refs**: spec `strategy-linking` SL-1, SL-2, SL-3; design "db-manager SKILL.md Changes" section.

---

## Phase 4: Verification

### 4.1 Manual test: research with video URL

Steps:
1. Run `/research https://youtube.com/watch?v=<some_video_id>` (use a real trading video URL)
2. Check History page (`http://localhost:5173/history`): the session MUST appear with the label "Video: <title>"
3. Check that history entries created during the session appear under the session (matched by time window)
4. Check stats endpoint (`GET /api/research/history/stats`): the entry MUST appear in `by_topic` under "Uncategorized" if `topic_id` is NULL

**Acceptance**: spec `research-session` Scenario 5; spec `research-history` Scenario 2.

### 4.2 Manual test: Strategies page shows parent strategies with drafts

Steps:
1. After test 4.1, check Strategies page (`http://localhost:5173/strategies`)
2. Parent strategies created from `parent_strategy` field MUST appear
3. Each parent strategy MUST have its variant drafts nested under it
4. `source_channel_id` MUST be populated if the video's channel exists in the DB

**Acceptance**: spec `strategy-linking` Scenarios 1, 3, 4.

### 4.3 Verify no regression with topic-based research

Steps:
1. Run `/research <existing_topic_slug>` (e.g., `futures` or whatever topic exists)
2. Check History page: session MUST appear with topic name as title
3. Check stats: `by_topic` and `by_channel` totals MUST still be correct (no entries lost)
4. Check Strategies page: parent strategies and drafts MUST appear linked

**Acceptance**: spec `research-session` Scenario 6; spec `research-history` Scenario 1.

### 4.4 Verify stats accuracy

Steps:
1. After tests 4.1 and 4.3, call `GET /api/research/history/stats`
2. `total` MUST equal the sum of all entries (including those with NULL topic_id/channel_id)
3. `by_topic` values MUST sum to `total` (includes "Uncategorized" bucket)
4. `by_channel` values MUST sum to `total` (includes "Unknown channel" bucket)

**Acceptance**: spec `research-history` Scenario 4.

---

## Dependency Order

```
Phase 1 (1.1 -> 1.2 -> 1.3)
    |
    v
Phase 2 (2.1 and 2.2 first, then 2.3-2.8 in any order)
    |
    v
Phase 3 (3.1-3.5 in any order, but all of Phase 2 must be done first)
    |
    v
Phase 4 (4.1 -> 4.2 -> 4.3 -> 4.4, sequential)
```

## Estimated Effort

| Phase | Tasks | Effort |
|-------|-------|--------|
| Phase 1 | 3 | Small -- model change + migration |
| Phase 2 | 8 | Medium -- 6 file edits + 1 new function + 1 passthrough |
| Phase 3 | 5 | Medium -- instruction rewrites, no code execution risk |
| Phase 4 | 4 | Medium -- manual testing with real pipeline |
| **Total** | **20** | |
