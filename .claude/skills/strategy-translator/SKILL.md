---
name: strategy-translator
description: Structure raw strategy ideas for the frontend and generate IBKR draft variants (creative proposer)
---

# Strategy Translator

Takes raw strategy ideas (as extracted by notebooklm-analyst with flat string arrays) and does two things:
1. **Part A** -- Structures the idea for the frontend and updates the DB
2. **Part B** -- Translates valid ideas into IBKR JSON draft variants (creative proposer)

## Input

- `strategy_names`: list of strategy names already saved in DB by db-manager (raw format)
- `notebook_id` (optional): NotebookLM notebook ID for follow-up questions

## Part A: Structure Ideas for the Frontend

For EACH strategy in the input list:

1. Fetch the strategy from the DB by name
2. Transform raw fields into properly structured format:
   - `parameters`: convert from flat strings like `"indicators: ['VWAP', 'ATR']"` into proper objects `[{name, description, type, default, range}]`
   - `entry_rules`: keep as list of strings but clean up (remove prefixes like "long:", "short:" -- make each rule a clear standalone sentence)
   - `exit_rules`: same cleanup
   - `risk_management`: same cleanup
   - `notes`: same cleanup
3. Update the strategy in the DB:

```python
from tools.db.session import sync_session_ctx
from tools.db.strategy_repo import upsert_strategy

with sync_session_ctx() as session:
    upsert_strategy(
        session,
        name=strategy_name,
        parameters=structured_parameters,
        entry_rules=cleaned_entry_rules,
        exit_rules=cleaned_exit_rules,
        risk_management=cleaned_risk_management,
        notes=cleaned_notes,
    )
```

Part A ALWAYS runs for every strategy.

## Part B: Translate to IBKR Drafts (Creative Proposer)

For each idea with concrete entry/exit logic, generate **2-4 JSON draft variants** for the IBKR trading engine.

### Reference Files

Read in this order:
1. `docs/STRATEGY_FILE_REFERENCE.md` -- **primary source of truth**. Complete specification of every field, indicator, condition type, shift behavior, and entry/exit logic. Read the Conditions section (section 5) carefully before writing any conditions.
2. `examples/*.json` (in this skill's directory) -- real strategies as few-shot for exact format
3. `translation-rules.md` (in this skill's directory) -- filtering and mapping rules
4. `schema.json` (in this skill's directory) -- JSON schema for validation (but STRATEGY_FILE_REFERENCE.md takes precedence for semantics)

### Filtering (skip)

Discard ideas that do NOT have concrete entry/exit logic:
- Ideas too vague or conceptual -> skip (log as "too vague for translation")
- Historical/abandoned approaches -> skip
- Meta-strategies (portfolio management, prop firm scaling, trading psychology) -> skip

### Critical Rules for Conditions

These rules come from the trading engine spec (`docs/STRATEGY_FILE_REFERENCE.md`). Getting them wrong produces invalid strategies.

**Entry vs Exit logic**:
- `long_conds` and `short_conds`: ALL conditions are ANDed together. Do NOT use `group` field in entry conditions.
- `exit_conds`: use `group` for OR logic between groups (AND within same group). Conditions without `group` act as standalone singletons (OR). Use `"mode": "force"` for conditions that trigger immediate exit regardless of groups.

**Shifts**:
- `shift_1` applies to the LEFT operand, `shift_2` applies to the RIGHT operand
- Shift values must be >= 1. Shift 0 does not exist — the current bar has not completed yet
- shift 1 = most recent completed bar, shift 2 = bar before that, etc.
- For `num_relation` (indicator vs number): only `shift_1` matters, `shift_2` is ignored

**The `cond` string must be unambiguous**:
- When comparing the same indicator at different shifts, include the shift in the string: `"LOW_6H(0) < LOW_6H(1)"` — never write `"LOW_6H < LOW_6H"`
- For compound expressions, shifts apply to ALL indicators on that side: `"abs(CLOSE_6h - OPEN_6h) < 0.2 * ATR_20_6h"` with shift_1=0 means CLOSE and OPEN both at shift 0
- Cross operators use `above` / `bellow` (note: `bellow` is the engine spelling, not `below`)

**Multi-output indicators** (MACD, STOCH, BBANDS, KELTNER, ICHIMOKU):
- `indCode` MUST start with `"MULT_"` followed by a suffix
- Output columns are auto-named using the suffix (e.g., `MULT_4h` → `stoch_slowk_4h`, `BBAND_upperband_4h`)

**Scope: pure strategies only**:
- The translator generates ONLY the core logic: indicators for entry/exit conditions, entry conditions, and exit conditions
- Do NOT generate `stop_loss_init`, `take_profit_init`, or `stop_loss_mgmt` — leave them all as default (all `false`, empty params). SL/TP and risk management are added manually later
- Do NOT create indicators dedicated to SL/TP (e.g., ATR_SL, ATR_TP) — only indicators needed by conditions
- Exit conditions should be limited to: stop & reverse (empty `exit_conds` with opposite entry triggering close), `num_bars` (time-based exit), or a specific technical condition from the source material

### Creative Process

For each idea with actionable entry/exit rules:

1. Read `docs/STRATEGY_FILE_REFERENCE.md` (especially sections 4 and 5) and the examples in `examples/` to understand the exact format
2. Analyze the idea: what indicators? what entry/exit conditions?
3. Think about variants -- differences can be:
   - **Timeframe**: e.g., 240min vs 360min vs daily
   - **Exit method**: stop & reverse vs time-based exit (num_bars)
   - **Market specialization**: if the idea mentions better-performing markets
4. If data is missing to complete a field, query the NotebookLM notebook (if `notebook_id` provided):
   ```bash
   notebooklm ask "<question>" -n <notebook_id>
   ```
5. Generate one complete JSON per variant following `schema.json` strictly
6. Mark unknown values with `"_TODO"` -- never guess parameter values
7. Each variant gets a unique `strat_code` and a descriptive `strat_name`
   - Format: `"<Indicator>_<Logic>_<Exit>_<Timeframe>"`
   - Examples: `"RSI_Divergence_SAR_360m"`, `"VWAP_Bounce_ATR_Daily"`

### strat_code Assignment

Get the next available code from the DB:

```python
from tools.db.session import sync_session_ctx
from tools.db.draft_repo import get_all_drafts

with sync_session_ctx() as session:
    existing = get_all_drafts(session)
    max_code = max((d.strat_code for d in existing), default=9000)
    next_code = max_code + 1
```

Each variant gets a unique `strat_code` starting from `next_code` and incrementing.

### Save Drafts

```python
from tools.db.session import sync_session_ctx
from tools.db.draft_repo import upsert_draft

with sync_session_ctx() as session:
    upsert_draft(session, strat_code=next_code, strat_name="<name>", data=draft_json)
    upsert_draft(session, strat_code=next_code+1, strat_name="<name_variant2>", data=draft_json_v2)
    # ... one call per variant
    # Automatically computes todo_count and todo_fields from _TODO values in data
```

## Rules

- Process ALL strategies passed in `strategy_names`
- Part A (structuring) ALWAYS runs for every strategy
- Part B (IBKR translation) runs only for valid ideas -- skip if too vague per `translation-rules.md`
- Use `"_TODO"` for unknown values, never guess
- Each variant must have a distinct `strat_name` that describes the variation clearly
- Objective: 2-4 variants per idea when the idea has enough detail. If only one reasonable implementation exists, one variant is sufficient.

## Output Format

```yaml
structured:
  - name: "<strategy name>"
    status: ok | skipped
    reason: "<if skipped>"
drafts_created:
  - strat_code: 9001
    strat_name: "<descriptive name>"
    strategy: "<parent strategy name>"
    todo_count: <N>
total_drafts: <N>
```

## Error Handling

- DATABASE_URL not set: report the error, cannot proceed
- Connection error: report the error
- Strategy not found in DB: report which strategy and skip it
- NotebookLM query fails: continue without the extra data, use `"_TODO"` for missing fields
