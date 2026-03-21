# Tasks: Inline JSON Editor for Drafts

## Phase 1: Backend — Validation & Endpoint

- [x] 1.1 Add `_validate_draft_structure(data)` helper in `api/services/strategy_service.py` — validates required keys (strat_name: str, strat_code: int, symbol: str, sec_type: str, exchange: str, currency: str), validates ind_list is dict if present, validates *_conds are lists if present. Raises HTTPException 422 with collected errors.

- [x] 1.2 Add `UpdateDraftDataRequest` Pydantic schema in `api/models/schemas/draft.py` (or inline in router) — single field `data: dict`.

- [x] 1.3 Add `update_draft_data(db, strat_code, data)` service function in `api/services/strategy_service.py` — fetches draft by strat_code (404 if not found), calls `_validate_draft_structure`, replaces `draft.data`, recalculates todo_fields/todo_count via `_extract_todo_fields`, commits, returns updated draft.

- [x] 1.4 Add `PUT /api/strategies/drafts/{strat_code}/data` endpoint in `api/routers/strategies.py` — calls `update_draft_data`, returns draft response.

- [x] 1.5 Relax `fill_todo` in `api/services/strategy_service.py` — remove the check that requires current value to contain `_TODO` (approx line 417). Allow editing any field via PATCH.

## Phase 2: Frontend — API Client & Editor UI

- [x] 2.1 Add `updateDraftData(stratCode: number, data: object)` function in `frontend/src/services/strategies.ts` — PUT request to `/strategies/drafts/${stratCode}/data` with `{ data }` body.

- [x] 2.2 Add edit mode to `DraftViewer.tsx` — new state variables: `editMode: boolean`, `jsonText: string`, `jsonError: string | null`. Add "Editar JSON" button near the existing "Ver JSON" toggle.

- [x] 2.3 Implement textarea editor in `DraftViewer.tsx` — when editMode=true, show `<textarea>` with `JSON.stringify(draft.data, null, 2)`, monospace font, min-h-[400px], theme-consistent styling (bg-surface-2, border-border, text-text-primary). Show "Guardar" and "Cancelar" buttons.

- [x] 2.4 Implement save logic in `DraftViewer.tsx` — useMutation calling `updateDraftData`. On click "Guardar": try JSON.parse(jsonText), if invalid show error below textarea, if valid call mutation. On success: invalidate queries, exit edit mode. On backend error (422): show error message, stay in edit mode.

## Phase 3: Integration & Verification

- [ ] 3.1 Test backend endpoint manually — curl PUT with valid data, verify response. curl PUT with missing keys, verify 422. curl PUT with wrong types, verify 422. curl PUT with non-existent strat_code, verify 404.

- [ ] 3.2 Test generalized PATCH — curl PATCH fill-todo on a non-TODO field, verify it now works.

- [ ] 3.3 Test frontend flow end-to-end — open a draft, click "Editar JSON", modify a field, save, verify visual sections update. Test with invalid JSON. Test with missing required key.

- [ ] 3.4 Verify TODO recalculation — edit a draft to add/remove _TODO values, verify todo_count updates in the strategies list and badge.
