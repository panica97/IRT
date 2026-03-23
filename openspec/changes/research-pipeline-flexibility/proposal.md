# Proposal: Research Pipeline Flexibility

## Intent
The research pipeline only produces complete frontend-visible output when running the full topic-based flow. When a video URL or raw idea is the entry point, session tracking, history linking, and parent strategy creation don't happen — making the History and Strategies pages empty. The pipeline must work for any entry point.

## Scope

### In Scope
1. Make `create_session()` work without `topic_slug` (make it optional)
2. Remove session service `if session.topic_id` guard that hides sessions without topics
3. Change history stats INNER JOINs to LEFT JOINs so entries without topic/channel still appear
4. Create parent `strategy` records from `parent_strategy` field in strategy-variants output
5. Link drafts to parent strategies via `strategy_id` FK
6. Pass `source_channel_id` when creating strategies
7. Update research agent `AGENT.md` — session tracking is mandatory for ALL entry points
8. Update db-manager `SKILL.md` — must create parent strategies and link drafts

### Out of Scope
- Frontend UI changes (pages already handle the data correctly when it exists)
- Dedup index migration for NULL topic_id (can be handled later)
- New entry point detection logic in the research skill (the agent already receives the input type)

## Approach
Fix the backend data layer (repo functions, services, JOINs) to handle nullable topic/channel, then update the skill/agent instructions to ensure session tracking and strategy linking always happen.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| tools/db/research_repo.py | Modified | Make topic_slug optional in create_session |
| api/services/research_session_service.py | Modified | Remove topic_id guard |
| api/services/history_service.py or equivalent | Modified | INNER JOIN → LEFT JOIN |
| tools/db/strategy_repo.py or similar | Modified | Pass source_channel_id, link drafts |
| .claude/agents/research/AGENT.md | Modified | Mandatory session tracking for all entry points |
| .claude/skills/db-manager/SKILL.md | Modified | Create parent strategies, link drafts |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| LEFT JOIN changes stats display | Low | Stats will show "Unknown" for unlinked entries |
| Agent instructions get complex with 3 entry points | Med | Keep instructions modular, one section per entry point |
| Parent strategy dedup logic | Low | Use name-based matching like drafts |

## Rollback Plan
All changes are in repo functions, services, and skill files — revert via git.

## Dependencies
- Phase 10.1 (completed) — condition format fix

## Success Criteria
- [ ] Research with video URL produces visible session in History page
- [ ] Research with video URL produces visible strategies in Strategies page
- [ ] Research with topic produces same results as before (no regression)
- [ ] Drafts are linked to parent strategies
- [ ] History stats include entries without topic/channel
