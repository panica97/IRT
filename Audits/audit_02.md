# Audit 02 - Phase 10 Backtesting Implementation

**Date**: 2026-03-22
**Scope**: New backtesting feature — backend (API + models + migration), worker (host-side process), frontend (BacktestPanel + integration)
**Auditor**: Claude Opus 4.6 (1M context)
**Status**: Complete

---

## Tracking Table

| # | Severity | Category | Finding | File(s) | Status | Resolved In |
|---|----------|----------|---------|---------|--------|-------------|
| 01 | HIGH | Race Condition | `claim_job` uses SELECT then UPDATE without row-level locking | `api/services/backtest_service.py:160-179` | Resolved | 2026-03-22 |
| 02 | HIGH | Race Condition | `complete_job` / `fail_job` do not validate job is in `running` state | `api/services/backtest_service.py:189-248` | Resolved | 2026-03-22 |
| 03 | HIGH | Security | Worker endpoints (`/claim`, `/results`, `/fail`) are accessible to any authenticated user | `api/routers/backtests.py:64-87` | Resolved | 2026-03-22 |
| 04 | MEDIUM | Input Validation | `BacktestCreateRequest` has no validation on `symbol`, `timeframe`, or date format | `api/models/schemas/backtest.py:11-16` | Open | — |
| 05 | MEDIUM | Input Validation | `status` filter on list endpoint accepts arbitrary strings silently | `api/routers/backtests.py:32` | Open | — |
| 06 | MEDIUM | Data Integrity | `backtest_jobs` and `backtest_results` missing from health check `_EXPECTED_TABLES` | `api/routers/health.py:13-21` | Open | — |
| 07 | MEDIUM | Resource Leak | Temp directory `irt-backtests/` never cleaned up, only individual files | `worker/bridge.py:61`, `worker/executor.py:44-53` | Open | — |
| 08 | MEDIUM | Error Handling | `get_pending_job` endpoint returns `Response(status_code=204)` but declares `response_model=BacktestJobResponse | None` | `api/routers/backtests.py:38-45` | Open | — |
| 09 | MEDIUM | Frontend | `backtestable` prop only checks `todo_count === 0`, not strategy status | `frontend/src/components/strategies/DraftViewer.tsx:216` | Open | — |
| 10 | MEDIUM | Frontend | No pagination on backtest list endpoint or UI | `api/services/backtest_service.py:100-126`, `api/routers/backtests.py:29-35` | Open | — |
| 11 | MEDIUM | Frontend | Delete mutation has no error handling or user feedback | `frontend/src/components/strategies/BacktestPanel.tsx:261-266` | Open | — |
| 12 | MEDIUM | Worker | No stale job recovery — jobs stuck in `running` if worker crashes | `worker/main.py`, `api/services/backtest_service.py` | Open | — |
| 13 | LOW | Code Quality | `body: Any` type hint on `create_job` loses type safety | `api/services/backtest_service.py:21` | Open | — |
| 14 | LOW | Code Quality | Duplicate metric fields `total_trades` and `trade_count` in `BacktestMetrics` type | `frontend/src/types/backtest.ts:8,11` | Open | — |
| 15 | LOW | Code Quality | `formatRelativeTime` is a fifth instance of time formatting logic | `frontend/src/components/strategies/BacktestPanel.tsx:39-52` | Open | — |
| 16 | LOW | Data Integrity | Dates stored as strings (`String(10)`) instead of `Date` type | `tools/db/models.py:197-198`, `api/alembic/versions/007_add_backtesting.py:34-35` | Open | — |
| 17 | LOW | Worker | `_resolve_python` relies on fragile directory traversal (`parent.parent.parent`) | `worker/engine.py:40` | Open | — |
| 18 | LOW | Security | Engine command injection possible if `strat_code` or dates contain shell-special chars | `worker/engine.py:85-95` | Open | — |

---

## Findings by Severity

### HIGH (3 findings)

#### H-01: `claim_job` race condition — no row-level locking
- **File**: `api/services/backtest_service.py:160-179`
- **Detail**: `claim_job` does a `SELECT` to check `status == 'pending'`, then sets `status = 'running'`. Between the SELECT and the flush, another worker (or API request) can read the same pending state and also claim the job. The DB has a CHECK constraint on status values but no mechanism to prevent two concurrent claims.
- **Risk**: Two workers execute the same backtest simultaneously, causing duplicate results and wasted resources.
- **Route**: Use `SELECT ... FOR UPDATE` via `.with_for_update()` on the SQLAlchemy query, or use an atomic `UPDATE ... WHERE status = 'pending' RETURNING *` pattern.

#### H-02: `complete_job` and `fail_job` skip status validation
- **File**: `api/services/backtest_service.py:189-248`
- **Detail**: Neither `complete_job` nor `fail_job` check that `job.status == "running"` before transitioning. A pending job could be marked as completed, or a completed job could be overwritten as failed. The `claim_job` function correctly validates `status == "pending"`, but the other two transition functions do not follow the same pattern.
- **Risk**: Invalid state transitions, data corruption (e.g., posting results to a job that was never claimed).
- **Route**: Add `if job.status != "running": raise HTTPException(409, ...)` to both `complete_job` and `fail_job`.

#### H-03: Worker-only endpoints lack authorization separation
- **File**: `api/routers/backtests.py:64-87`
- **Detail**: The `/claim`, `/results`, and `/fail` endpoints are internal worker operations but share the same authentication as user-facing endpoints. Any dashboard user with the API key can claim a job, post fake results, or mark jobs as failed. There is no role separation.
- **Risk**: A malicious or buggy frontend could tamper with backtest results.
- **Route**: Either add a separate worker API key/header check, move worker endpoints to a separate router with distinct auth, or document the trade-off for a single-user system.

---

### MEDIUM (9 findings)

#### M-04: No input validation on `BacktestCreateRequest`
- **File**: `api/models/schemas/backtest.py:11-16`
- **Detail**:
  - `symbol`: No length limit, no pattern validation. Could be empty string or contain special characters.
  - `timeframe`: No validation against the allowed set (`1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`). The DB column is `String(20)` so anything fits.
  - `start_date` / `end_date`: Declared as `str` with no date format validation. The service does `body.start_date >= body.end_date` (string comparison), which works for `YYYY-MM-DD` but silently accepts malformed dates like `"hello"` or `"2026-13-45"`.
- **Route**: Add Pydantic `field_validator` for date format, `Literal` for timeframe, `constr(min_length=1, max_length=20)` for symbol.

#### M-05: Status filter accepts arbitrary strings
- **File**: `api/routers/backtests.py:32`
- **Detail**: `status: str | None = Query(None)` accepts any string. An invalid status like `"cancelled"` returns empty results silently instead of telling the user the filter is wrong.
- **Route**: Use `Literal["pending", "running", "completed", "failed"]` or validate in the service layer with a 422 response.

#### M-06: Missing tables in health check
- **File**: `api/routers/health.py:13-21`
- **Detail**: `_EXPECTED_TABLES` does not include `"backtest_jobs"` or `"backtest_results"`. The health check will not detect if the migration was not run.
- **Route**: Add `"backtest_jobs"` and `"backtest_results"` to the list.

#### M-07: Temp directory accumulation
- **File**: `worker/bridge.py:61`, `worker/executor.py:44-53`
- **Detail**: `export_draft_to_file` creates `{tempdir}/irt-backtests/` and never deletes the directory itself. `_cleanup_temp_file` only removes individual strategy JSON files. Over time, the directory persists (minor), and if cleanup fails (e.g., process crash between bridge and executor), stale files accumulate.
- **Route**: Use `tempfile.TemporaryDirectory()` as a context manager in `execute_backtest_job`, or add periodic cleanup.

#### M-08: `get_pending_job` endpoint response type conflict
- **File**: `api/routers/backtests.py:38-45`
- **Detail**: The endpoint declares `response_model=BacktestJobResponse | None` and returns `Response(status_code=204)` when no job is pending. FastAPI may try to validate the `Response` object against `BacktestJobResponse`, or silently pass it through. The `Response` object bypasses the `response_model` serialization entirely. While this works at runtime, it's semantically inconsistent — the declared type suggests the response body could be `null`, but it actually returns no body with 204.
- **Route**: Remove `response_model` from the signature and handle serialization manually, or use `JSONResponse` with explicit status codes.

#### M-09: `backtestable` prop doesn't check strategy status
- **File**: `frontend/src/components/strategies/DraftViewer.tsx:216`
- **Detail**: `backtestable={draft.todo_count === 0}` only checks todo count. The API also requires `strategy.status === "validated"`. If a draft has `todo_count=0` but its parent strategy is not validated, the form is enabled but submission will fail with a 422 from the API.
- **Risk**: Confusing UX — user fills out the form and clicks "Run" only to get an error.
- **Route**: Also check `draft.strategy_status === 'validated'` if that field is available in the DraftDetail response, or add a comment documenting that the API is the authoritative gate.

#### M-10: No pagination on backtest list
- **File**: `api/services/backtest_service.py:100-126`, `api/routers/backtests.py:29-35`
- **Detail**: `list_jobs` fetches ALL matching rows without `LIMIT/OFFSET`. After many backtests on a single draft, this returns unbounded data. This was previously flagged for strategies (audit_01 M-06) and fixed — the same pattern should be applied here.
- **Route**: Add `page` and `limit` query parameters matching the existing pagination pattern in the strategies endpoint.

#### M-11: Delete mutation has no error handling
- **File**: `frontend/src/components/strategies/BacktestPanel.tsx:261-266`
- **Detail**: The `deleteMutation` has `onSuccess` but no `onError` handler. If deletion fails (e.g., trying to delete a running job returns 409), the user gets no feedback.
- **Route**: Add an `onError` handler that shows the error detail, similar to the `createMutation` pattern.

#### M-12: No stale job recovery
- **Files**: `worker/main.py`, `api/services/backtest_service.py`
- **Detail**: If the worker crashes or is killed while processing a job, that job stays in `running` state forever. There is no timeout mechanism on the API side, no TTL check, and no heartbeat. The job is effectively orphaned.
- **Route**: Add a scheduled task or startup check that transitions `running` jobs older than `job_timeout` back to `pending` or `failed`. Alternatively, add a `last_heartbeat` column that the worker updates periodically.

---

### LOW (6 findings)

#### L-13: `body: Any` type hint
- **File**: `api/services/backtest_service.py:21`
- **Detail**: `create_job` accepts `body: Any` instead of `body: BacktestCreateRequest`. This loses type safety and IDE autocomplete.
- **Route**: Import and use `BacktestCreateRequest` as the type.

#### L-14: Duplicate metric fields in TypeScript type
- **File**: `frontend/src/types/backtest.ts:8,11`
- **Detail**: `BacktestMetrics` defines both `total_trades: number` and `trade_count: number`. The component uses `metrics.total_trades ?? metrics.trade_count ?? 0` as a fallback chain. This suggests uncertainty about which field the engine returns.
- **Route**: Confirm which field the engine actually returns and remove the other. If both are possible, document why.

#### L-15: Another `formatRelativeTime` / time helper duplication
- **File**: `frontend/src/components/strategies/BacktestPanel.tsx:39-52`
- **Detail**: Audit 01 flagged `formatDuration` duplication (M-14, resolved). Now `formatRelativeTime` is a new time formatting helper that could be extracted to the shared utils file.
- **Route**: Move to `frontend/src/utils/` alongside the deduplicated `formatDuration`.

#### L-16: Dates as strings instead of proper date type
- **Files**: `tools/db/models.py:197-198`, `api/alembic/versions/007_add_backtesting.py:34-35`
- **Detail**: `start_date` and `end_date` are stored as `String(10)` in the database. While the CHECK constraint `start_date < end_date` works for `YYYY-MM-DD` string comparison, using `Date` type would provide native date validation and comparison.
- **Route**: Low risk as-is (the CHECK constraint provides safety), but consider using `sa.Date()` in a future migration if date arithmetic or querying by date ranges is needed.

#### L-17: Fragile Python executable resolution
- **File**: `worker/engine.py:40`
- **Detail**: `_resolve_python` navigates `Path(engine_path).resolve().parent.parent.parent` to find the ops-worker venv. This assumes a very specific directory structure (`packages/backtest-engine/main.py`). If the engine is reorganized, the resolution silently falls back to `sys.executable` which may lack required dependencies.
- **Route**: Add a `WORKER_PYTHON_PATH` environment variable as an explicit override, falling back to the current heuristic.

#### L-18: Subprocess command uses list form (safe), but no explicit shell=False
- **File**: `worker/engine.py:85-105`
- **Detail**: `subprocess.run(cmd, ...)` uses a list for `cmd`, which avoids shell injection. The `strat_code` is an integer and dates come from the DB. This is low risk because `subprocess.run` with a list does NOT use a shell, so special characters in arguments are not interpreted. Documenting this security property would be helpful.
- **Route**: Add a comment noting that list-form subprocess is used deliberately to avoid shell injection. Consider validating date format before passing to subprocess.

---

## Cross-Cutting Analysis

### API Endpoint Coverage (Backtesting)

| Frontend Service | Backend Endpoint | Match |
|---|---|---|
| `createBacktest()` | `POST /api/backtests` | OK |
| `getBacktest(jobId)` | `GET /api/backtests/{job_id}` | OK |
| `getBacktestsByDraft(stratCode)` | `GET /api/backtests?draft_strat_code={code}` | OK |
| `deleteBacktest(jobId)` | `DELETE /api/backtests/{job_id}` | OK |
| _(worker internal)_ | `GET /api/backtests/pending` | OK (not called from frontend) |
| _(worker internal)_ | `PATCH /api/backtests/{job_id}/claim` | OK (not called from frontend) |
| _(worker internal)_ | `POST /api/backtests/{job_id}/results` | OK (not called from frontend) |
| _(worker internal)_ | `PATCH /api/backtests/{job_id}/fail` | OK (not called from frontend) |

**Result**: Full coverage. Frontend and worker endpoints all have matching backend routes.

### State Machine Analysis

Valid transitions per the CHECK constraint and business logic:

```
pending  --[claim]--> running  --[complete]--> completed
                               --[fail]------> failed
```

**Gap**: `complete_job` and `fail_job` don't enforce that the job is in `running` state (H-02). A job could go `pending -> completed` or `completed -> failed`.

### Data Flow Analysis

```
Frontend (BacktestPanel)
  |-- POST /api/backtests --> creates job (status=pending)
  |-- GET /api/backtests?draft_strat_code=X --> polls for updates (3s interval when active)

Worker (main.py poll loop)
  |-- GET /api/backtests/pending --> finds oldest pending job
  |-- PATCH /api/backtests/{id}/claim --> transitions to running
  |-- bridge.export_draft_to_file() --> GET /api/strategies/drafts/{code} --> temp file
  |-- engine.run_engine() --> subprocess with timeout
  |-- POST /api/backtests/{id}/results --> stores metrics + trades
  |-- OR PATCH /api/backtests/{id}/fail --> stores error message
  |-- cleanup temp file
```

**Observations**: The data flow is well-structured with clear separation. The worker communicates exclusively via HTTP (no direct DB access), which is clean. The polling interval (3s frontend, 5s worker) means reasonable latency. The main risk is in the claim step (H-01).

### Recurring Patterns

1. **Missing input validation on new schemas** — Same pattern as the original codebase: Pydantic schemas accept raw strings without format/pattern validation. This was not flagged in audit 01 because the existing schemas had simpler inputs.

2. **flush() without commit()** — Same pattern as audit 01 M-11. The backtest service uses `flush()` throughout, relying on the session lifecycle in `get_db` to commit. Consistent with the rest of the codebase.

3. **No pagination on new list endpoints** — Same issue as audit 01 M-06 (strategies). The fix was applied to strategies but not preemptively applied to the new backtests list.

---

## Action Items

**HIGH Priority:**
1. Add `SELECT ... FOR UPDATE` to `claim_job` — Effort: small
   Route: quick fix
2. Add status validation to `complete_job` and `fail_job` — Effort: small
   Route: quick fix
3. Evaluate worker endpoint authorization (document trade-off or add worker key) — Effort: medium
   Route: quick fix (document) or /sdd-new (implement)

**MEDIUM Priority:**
1. Add Pydantic validators to `BacktestCreateRequest` (date format, timeframe enum, symbol constraints) — Effort: small
   Route: quick fix
2. Add `Literal` type to status filter on list endpoint — Effort: small
   Route: quick fix
3. Add `backtest_jobs` and `backtest_results` to health check `_EXPECTED_TABLES` — Effort: small
   Route: quick fix
4. Fix `get_pending_job` endpoint response model — Effort: small
   Route: quick fix
5. Improve `backtestable` check in DraftViewer to include strategy status — Effort: small
   Route: quick fix
6. Add pagination to backtest list endpoint — Effort: small
   Route: quick fix (copy pattern from strategies)
7. Add `onError` to delete mutation — Effort: small
   Route: quick fix
8. Design stale job recovery mechanism — Effort: medium
   Route: /sdd-new
9. Use `TemporaryDirectory` context manager in executor — Effort: small
   Route: quick fix

**LOW Priority:**
1. Type `body` parameter as `BacktestCreateRequest` in service — Effort: small
2. Resolve `total_trades` vs `trade_count` duplication — Effort: small
3. Extract `formatRelativeTime` to shared utils — Effort: small
4. Consider `Date` type for start/end dates in future migration — Effort: medium
5. Add `WORKER_PYTHON_PATH` env var — Effort: small
6. Document subprocess security properties — Effort: small

---

## Statistics

| Metric | Value |
|---|---|
| Total findings | 18 |
| HIGH severity | 3 |
| MEDIUM severity | 9 |
| LOW severity | 6 |
| Backend findings | 8 |
| Frontend findings | 4 |
| Worker findings | 4 |
| Cross-cutting findings | 2 |
| Files audited (backend) | 5 |
| Files audited (frontend) | 4 |
| Files audited (worker) | 4 |
| New API endpoints | 8 (5 user-facing + 3 worker) |
| Frontend-backend coverage | 100% |
| State machine gaps | 1 (missing transition guards) |
| Race conditions | 1 (claim_job) |
