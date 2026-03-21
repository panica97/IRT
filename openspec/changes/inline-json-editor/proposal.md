# Proposal: Inline JSON Editor for Drafts

## Intent

The user needs to correct draft JSON directly from the frontend. Currently the only way to edit drafts is via the CLI todo-fill skill (limited to _TODO fields) or direct database manipulation. The user wants to fix conditions, change indicator params, modify instrument settings — any field, not just TODOs.

## Scope

### In Scope
- Backend: New `PUT /api/strategies/drafts/{strat_code}/data` endpoint to replace draft data blob
- Backend: Structural validation of draft data (required keys + basic types)
- Backend: Generalize existing PATCH to allow editing any field (remove _TODO restriction)
- Frontend: "Editar JSON" toggle in DraftViewer that switches `<pre>` to editable `<textarea>`
- Frontend: JSON parse validation before save
- Frontend: API client function for PUT draft data
- Frontend: Error/success feedback with mutation + query invalidation

### Out of Scope
- JSON Schema validation (overkill for single user)
- Syntax highlighting / CodeMirror editor (future iteration)
- Field-level inline editing in visual sections (future iteration)
- Concurrent edit locking (single user)
- Undo/redo history

## Approach

### Backend
1. New service function `update_draft_data(db, strat_code, data)` that:
   - Validates `data` is a dict with required top-level keys: `strat_name`, `strat_code`, `symbol`, `sec_type`, `exchange`, `currency`
   - Validates `ind_list` is a dict, `long_conds`/`short_conds`/`exit_conds` are lists
   - Replaces the entire `data` JSONB column
   - Recalculates `todo_count` and `todo_fields` (reuse `_extract_todo_fields`)
   - Returns updated draft

2. New router endpoint `PUT /api/strategies/drafts/{strat_code}/data`

3. Relax `fill_todo` — remove the check that requires current value to contain `_TODO`

### Frontend
1. Add `updateDraftData(stratCode, data)` to `strategies.ts` service
2. In `DraftViewer.tsx`:
   - Add state: `editMode`, `jsonText`, `jsonError`
   - "Editar JSON" button toggles to `<textarea>` with current JSON
   - "Guardar" button: parse JSON, validate, call mutation
   - "Cancelar" button: discard changes, back to read-only
   - Error display if JSON is invalid
3. Use `useMutation` + `invalidateQueries` (same pattern as InstrumentsPage)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `api/routers/strategies.py` | Modified | New PUT endpoint |
| `api/services/strategy_service.py` | Modified | New update_draft_data function, relax fill_todo |
| `frontend/src/services/strategies.ts` | Modified | New updateDraftData API call |
| `frontend/src/components/strategies/DraftViewer.tsx` | Modified | Edit mode with textarea, save/cancel |
| `frontend/src/types/draft.ts` | Minor | Add response type if needed |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| User saves invalid JSON structure | Medium | Backend validates required keys + types before saving |
| Data loss from accidental overwrite | Low | Single user, can revert via git/backup. Consider adding confirmation dialog |
| Large JSON hard to edit in textarea | Low | Monospace font, adequate height. CodeMirror in future iteration |

## Rollback Plan

- Revert commit — all changes are additive (new endpoint, new UI toggle)
- Existing read-only view remains default; edit mode is opt-in toggle
- No database migrations needed

## Dependencies

- None — uses existing infrastructure (JSONB column, TanStack Query, Tailwind)

## Success Criteria

- [ ] User can click "Editar JSON" in any draft and see the full JSON in an editable textarea
- [ ] User can modify any field, save, and see the changes reflected immediately
- [ ] Invalid JSON shows an error and prevents save
- [ ] Backend rejects data missing required keys (strat_name, strat_code, symbol, etc.)
- [ ] todo_count and todo_fields are recalculated after every save
- [ ] Existing read-only visual sections still work after editing
