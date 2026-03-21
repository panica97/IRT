# Design: Inline JSON Editor for Drafts

## Overview

This design describes the technical implementation for adding inline JSON editing capabilities to drafts. It covers a new PUT endpoint for full data replacement, structural validation, relaxation of the `fill_todo` _TODO constraint, and a toggle-based edit mode in the DraftViewer component.

---

## Backend Design

### 1. New Pydantic Schema: `UpdateDraftDataRequest`

**File:** `api/models/schemas/draft.py`

```python
class UpdateDraftDataRequest(BaseModel):
    data: dict[str, Any]
```

Single field — the complete draft data object. All structural validation happens in the service layer, not in the schema, because the rules are domain-specific (required keys, conditional types) and benefit from clear error messages.

### 2. New Service Function: `update_draft_data`

**File:** `api/services/strategy_service.py`

```python
async def update_draft_data(
    db: AsyncSession, strat_code: int, data: dict[str, Any]
) -> dict[str, Any]:
```

**Flow:**
1. Fetch draft by `strat_code` — raise `HTTPException(404)` if not found.
2. Call `_validate_draft_structure(data)` — raises `HTTPException(422)` on failure.
3. Set `draft.data = data`.
4. Recalculate TODOs via existing `_extract_todo_fields(data)`.
5. Update `draft.todo_fields` and `draft.todo_count`.
6. `await db.commit()` + `await db.refresh(draft)`.
7. Return `await get_draft_by_code(db, strat_code)` (same response shape as existing detail endpoint).

**Implementation:**

```python
async def update_draft_data(
    db: AsyncSession, strat_code: int, data: dict[str, Any]
) -> dict[str, Any]:
    """Replace entire draft data blob with structural validation."""
    result = await db.execute(
        select(Draft).where(Draft.strat_code == strat_code)
    )
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Draft con strat_code {strat_code} no encontrado",
        )

    _validate_draft_structure(data)

    draft.data = data

    # Recalculate TODO metadata
    todo_details = _extract_todo_fields(data)
    todo_paths = [t["path"] for t in todo_details]
    draft.todo_fields = todo_paths
    draft.todo_count = len(todo_paths)

    await db.commit()
    await db.refresh(draft)

    return await get_draft_by_code(db, strat_code)
```

### 3. New Validation Helper: `_validate_draft_structure`

**File:** `api/services/strategy_service.py`

This is a pure function (no DB access). It validates only the top-level structure — no deep schema validation.

```python
def _validate_draft_structure(data: dict[str, Any]) -> None:
    """Validate required top-level keys and types in draft data.

    Raises HTTPException(422) with a detail message on failure.
    """
    errors: list[str] = []

    # Required string keys
    required_strings = ["strat_name", "symbol", "sec_type", "exchange", "currency"]
    for key in required_strings:
        if key not in data:
            errors.append(f"Falta clave requerida: '{key}'")
        elif not isinstance(data[key], str):
            errors.append(f"'{key}' debe ser string, recibido {type(data[key]).__name__}")

    # Required int key
    if "strat_code" not in data:
        errors.append("Falta clave requerida: 'strat_code'")
    elif not isinstance(data["strat_code"], int):
        errors.append(f"'strat_code' debe ser int, recibido {type(data['strat_code']).__name__}")

    # Optional keys with type constraints
    if "ind_list" in data and not isinstance(data["ind_list"], dict):
        errors.append(f"'ind_list' debe ser dict, recibido {type(data['ind_list']).__name__}")

    for cond_key in ["long_conds", "short_conds", "exit_conds"]:
        if cond_key in data and not isinstance(data[cond_key], list):
            errors.append(f"'{cond_key}' debe ser list, recibido {type(data[cond_key]).__name__}")

    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "Estructura de draft invalida", "errors": errors},
        )
```

**Design decisions:**
- Collects ALL errors before raising, so the user sees everything wrong at once.
- Error messages in Spanish consistent with existing codebase.
- The `detail` uses a dict with `message` + `errors` array for structured frontend consumption.

### 4. New Router Endpoint

**File:** `api/routers/strategies.py`

```python
@router.put("/drafts/{strat_code}/data")
async def update_draft_data(
    strat_code: int,
    body: UpdateDraftDataRequest,
    db: AsyncSession = Depends(get_db),
):
    return await strategy_service.update_draft_data(db, strat_code, body.data)
```

**Placement:** After the existing `fill-todo` PATCH endpoint and before the `GET ""` list endpoint. This keeps all `/drafts/` routes grouped together before the `/{strategy_name}` catch-all routes.

**Import addition:** Add `UpdateDraftDataRequest` to the import from `api.models.schemas.draft`.

### 5. Modify `fill_todo`: Remove `_TODO` Check

**File:** `api/services/strategy_service.py`

**Current code (lines 417-421):**
```python
if not (isinstance(current_value, str) and "_TODO" in current_value):
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"El valor en '{path}' no contiene '_TODO' (valor actual: {current_value!r})",
    )
```

**Action:** Remove this entire block (5 lines). The PATCH endpoint becomes a general-purpose field editor. The rest of the function (path navigation, value replacement, TODO recalculation) remains unchanged.

**Rationale:** The _TODO restriction was a safety guard when this was strictly a "fill TODO" feature. Now that users need to edit any field (e.g., fix a wrong multiplier), this restriction is counterproductive. The field still gets recalculated by `_extract_todo_fields` after every edit regardless.

---

## Frontend Design

### 6. New API Function: `updateDraftData`

**File:** `frontend/src/services/strategies.ts`

```typescript
export async function updateDraftData(
  stratCode: number,
  data: Record<string, unknown>,
): Promise<DraftDetail> {
  const { data: response } = await api.put<DraftDetail>(
    `/strategies/drafts/${stratCode}/data`,
    { data },
  );
  return response;
}
```

Follows the same pattern as existing functions. Uses `api.put` consistent with the HTTP method. The body wraps `data` in an object matching `UpdateDraftDataRequest`.

### 7. DraftViewer Component Changes

**File:** `frontend/src/components/strategies/DraftViewer.tsx`

#### New State

```typescript
const [editMode, setEditMode] = useState(false);
const [jsonText, setJsonText] = useState('');
const [jsonError, setJsonError] = useState<string | null>(null);
```

#### New Imports

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateDraftData } from '../../services/strategies';
```

#### Mutation Setup

```typescript
const queryClient = useQueryClient();

const mutation = useMutation({
  mutationFn: (data: Record<string, unknown>) =>
    updateDraftData(draft.strat_code, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['draft', draft.strat_code] });
    queryClient.invalidateQueries({ queryKey: ['drafts'] });
    setEditMode(false);
    setJsonError(null);
  },
  onError: (error: any) => {
    // Extract backend validation errors
    const detail = error?.response?.data?.detail;
    if (typeof detail === 'object' && detail?.errors) {
      setJsonError(detail.errors.join('\n'));
    } else if (typeof detail === 'string') {
      setJsonError(detail);
    } else {
      setJsonError('Error al guardar los cambios');
    }
  },
});
```

**Query invalidation:** Invalidates both `['draft', strat_code]` (detail view) and `['drafts']` (list view, since todo_count may change). This follows the same pattern used in InstrumentsPage.

#### Enter Edit Mode Handler

```typescript
const handleEditJson = () => {
  setJsonText(JSON.stringify(draft.data, null, 2));
  setJsonError(null);
  setEditMode(true);
};
```

#### Save Handler

```typescript
const handleSaveJson = () => {
  try {
    const parsed = JSON.parse(jsonText);
    setJsonError(null);
    mutation.mutate(parsed);
  } catch (e) {
    setJsonError(`JSON invalido: ${(e as Error).message}`);
  }
};
```

**Two-layer validation:** Client-side `JSON.parse` catches syntax errors instantly. Server-side `_validate_draft_structure` catches structural issues (missing keys, wrong types).

#### Cancel Handler

```typescript
const handleCancelEdit = () => {
  setEditMode(false);
  setJsonError(null);
};
```

#### UI Changes in JSX

Replace the existing "Ver JSON" toggle block (lines 127-139) with:

```tsx
{/* JSON view / edit toggle */}
<div>
  <div className="flex items-center gap-2">
    <button
      onClick={() => setShowJson(!showJson)}
      className="text-xs text-text-muted hover:text-text-secondary transition-colors underline"
    >
      {showJson ? 'Ocultar JSON' : 'Ver JSON'}
    </button>
    {!editMode && (
      <button
        onClick={handleEditJson}
        className="text-xs text-accent hover:text-accent/80 transition-colors underline"
      >
        Editar JSON
      </button>
    )}
  </div>

  {editMode ? (
    <div className="mt-2 space-y-2">
      <textarea
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        className="w-full font-mono text-xs bg-surface-2 text-text-primary border border-border rounded p-3 resize-y focus:outline-none focus:ring-1 focus:ring-accent"
        style={{ minHeight: '400px' }}
        spellCheck={false}
      />
      {jsonError && (
        <p className="text-xs text-danger bg-danger/10 border border-danger/20 rounded px-2 py-1 whitespace-pre-wrap">
          {jsonError}
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={handleSaveJson}
          disabled={mutation.isPending}
          className="text-xs px-3 py-1 bg-accent text-surface-0 rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {mutation.isPending ? 'Guardando...' : 'Guardar'}
        </button>
        <button
          onClick={handleCancelEdit}
          disabled={mutation.isPending}
          className="text-xs px-3 py-1 bg-surface-2 text-text-secondary border border-border rounded hover:bg-surface-3 transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  ) : (
    showJson && (
      <pre
        ref={preRef}
        className="mt-2 text-xs text-text-secondary bg-surface-0/50 rounded p-3 overflow-x-auto max-h-80 overflow-y-auto"
      >
        {JSON.stringify(draft.data, null, 2)}
      </pre>
    )
  )}
</div>
```

**Layout decisions:**
- "Editar JSON" button sits next to "Ver JSON" — visible without needing to open JSON first.
- When editMode is active, the `<pre>` is replaced by `<textarea>` (never both visible).
- The "Ver JSON" button remains functional independently of edit mode.
- Error message uses `whitespace-pre-wrap` to display multi-line validation errors (one per line from backend).
- Both buttons disabled during mutation to prevent double-submit.

---

## Data Flow

```
User clicks "Editar JSON"
  -> jsonText = JSON.stringify(draft.data, null, 2)
  -> editMode = true, textarea renders

User edits JSON in textarea
  -> jsonText state updates on each keystroke

User clicks "Guardar"
  -> JSON.parse(jsonText)
     -> FAIL: setJsonError("JSON invalido: ..."), stay in editMode
     -> OK: mutation.mutate(parsed)

mutation.mutate(parsed)
  -> PUT /api/strategies/drafts/{strat_code}/data  { data: parsed }
  -> Router: body validated as UpdateDraftDataRequest (data is dict)
  -> Service: update_draft_data(db, strat_code, body.data)
     -> Fetch draft by strat_code (404 if not found)
     -> _validate_draft_structure(data)
        -> FAIL: HTTPException(422, { message, errors[] })
           -> onError: setJsonError(errors.join('\n')), stay in editMode
        -> OK: continue
     -> draft.data = data
     -> _extract_todo_fields(data) -> recalculate todo_fields, todo_count
     -> db.commit() + db.refresh()
     -> return get_draft_by_code(db, strat_code)
  -> onSuccess:
     -> invalidateQueries(['draft', strat_code])
     -> invalidateQueries(['drafts'])
     -> setEditMode(false)
     -> Visual sections re-render with new data
     -> TODO count badge updates
```

---

## Files Modified — Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `api/models/schemas/draft.py` | Add class | `UpdateDraftDataRequest` schema |
| `api/services/strategy_service.py` | Add function | `_validate_draft_structure()` helper |
| `api/services/strategy_service.py` | Add function | `update_draft_data()` service |
| `api/services/strategy_service.py` | Modify function | `fill_todo()` — remove _TODO check (5 lines) |
| `api/routers/strategies.py` | Add endpoint | `PUT /drafts/{strat_code}/data` |
| `api/routers/strategies.py` | Modify import | Add `UpdateDraftDataRequest` |
| `frontend/src/services/strategies.ts` | Add function | `updateDraftData()` |
| `frontend/src/components/strategies/DraftViewer.tsx` | Modify | Add editMode state, mutation, edit UI |
| `frontend/src/components/strategies/DraftViewer.tsx` | Modify imports | Add `useMutation`, `useQueryClient`, `updateDraftData` |

---

## Edge Cases & Error Handling

| Scenario | Layer | Behavior |
|----------|-------|----------|
| Malformed JSON in textarea | Client | `JSON.parse` throws, `jsonError` displays message, stays in editMode |
| Valid JSON but missing `strat_name` | Server | `_validate_draft_structure` returns 422 with `["Falta clave requerida: 'strat_name'"]` |
| Valid JSON but `strat_code` is string | Server | 422 with `["'strat_code' debe ser int, recibido str"]` |
| Multiple validation errors | Server | All collected and returned in `errors` array |
| Draft not found (stale tab) | Server | 404 with detail message |
| Network error | Client | `onError` catches, displays generic message |
| User cancels after editing | Client | `handleCancelEdit` discards `jsonText`, no API call |
| Save succeeds but data has new _TODO fields | Server | `_extract_todo_fields` recalculates, `todo_count` increases |
| Save removes all _TODO fields | Server | `todo_count` becomes 0, badge disappears in UI |

---

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| User accidentally overwrites good data | Low | Edit mode requires explicit "Editar JSON" click; cancel discards. Single user, no concurrent edits. |
| Large JSON slow to parse client-side | Very low | `JSON.parse` and `JSON.stringify` are native and fast even for large objects. |
| Backend validation too strict for future data shapes | Low | Only validates 6 required keys + 4 optional type checks. Easy to extend `_validate_draft_structure`. |
| Textarea UX insufficient for complex edits | Medium | Acknowledged in proposal as out-of-scope. CodeMirror or Monaco in future iteration. |
