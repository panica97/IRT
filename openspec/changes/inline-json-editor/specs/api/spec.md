# API Specification: Draft Data Editing

## Purpose

Endpoints for modifying draft strategy JSON data from the frontend.

## Requirements

### Requirement: Full Draft Data Update

The system MUST provide a `PUT /api/strategies/drafts/{strat_code}/data` endpoint that replaces the entire draft data blob.

The endpoint MUST accept a JSON body with a `data` field containing the complete draft object.

The system MUST recalculate `todo_count` and `todo_fields` after every update.

The system MUST return the updated draft with recalculated TODO metadata.

#### Scenario: Successful data update

- GIVEN a draft with strat_code 9007 exists
- WHEN a PUT request is sent with valid draft data
- THEN the draft's data MUST be replaced with the new data
- AND todo_count and todo_fields MUST be recalculated
- AND the response MUST include the updated draft

#### Scenario: Draft not found

- GIVEN no draft with strat_code 9999 exists
- WHEN a PUT request is sent
- THEN the system MUST return HTTP 404
- AND the response body MUST include an error message

#### Scenario: Empty data body

- GIVEN a draft exists
- WHEN a PUT request is sent with an empty object `{}`
- THEN the system MUST return HTTP 422
- AND the response MUST indicate missing required keys

### Requirement: Structural Validation

The system MUST validate that the submitted data contains required top-level keys before saving.

Required keys: `strat_name` (string), `strat_code` (integer), `symbol` (string), `sec_type` (string), `exchange` (string), `currency` (string).

The system MUST validate that `ind_list` is a dict if present.

The system MUST validate that `long_conds`, `short_conds`, and `exit_conds` are lists if present.

The system SHOULD NOT validate nested structures beyond top-level keys.

#### Scenario: Missing required key

- GIVEN a draft exists
- WHEN a PUT request is sent with data missing `strat_name`
- THEN the system MUST return HTTP 422
- AND the response MUST identify which key is missing

#### Scenario: Wrong type for required key

- GIVEN a draft exists
- WHEN a PUT request is sent with `strat_code` as a string instead of integer
- THEN the system MUST return HTTP 422
- AND the response MUST identify the type mismatch

#### Scenario: Valid data with optional keys missing

- GIVEN a draft exists
- WHEN a PUT request is sent with all required keys but without `ind_list`
- THEN the system MUST accept and save the data

### Requirement: Generalized Field Editing

The existing `PATCH /api/strategies/drafts/{strat_code}/fill-todo` endpoint SHOULD accept edits to any field, not only fields containing `_TODO`.

#### Scenario: Edit non-TODO field via PATCH

- GIVEN a draft exists with field `multiplier` set to `50`
- WHEN a PATCH fill-todo request is sent with path `multiplier` and value `100`
- THEN the system MUST update the field to `100`
- AND todo_count MUST be recalculated

#### Scenario: Edit field containing _TODO via PATCH

- GIVEN a draft exists with a condition `cond` containing `_TODO`
- WHEN a PATCH fill-todo request is sent with the path and a new value
- THEN the system MUST update the field
- AND todo_count MUST decrease
