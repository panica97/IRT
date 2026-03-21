# Frontend Specification: Draft JSON Editor

## Purpose

UI for editing draft JSON data inline within the DraftViewer component.

## Requirements

### Requirement: Edit Mode Toggle

The DraftViewer MUST provide a button to toggle between read-only and edit mode.

The button MUST be labeled "Editar JSON" when in read-only mode and display the JSON in a `<textarea>`.

The button MUST be clearly visible near the existing "Ver JSON" toggle area.

#### Scenario: Enter edit mode

- GIVEN the user is viewing a draft in read-only mode
- WHEN the user clicks "Editar JSON"
- THEN the JSON MUST be displayed in an editable textarea
- AND "Guardar" and "Cancelar" buttons MUST appear
- AND the textarea MUST contain the current draft data formatted with 2-space indentation

#### Scenario: Cancel edit mode

- GIVEN the user is in edit mode with unsaved changes
- WHEN the user clicks "Cancelar"
- THEN the textarea MUST be replaced with the read-only view
- AND all unsaved changes MUST be discarded

### Requirement: JSON Validation

The system MUST validate that the textarea content is valid JSON before allowing save.

#### Scenario: Valid JSON save

- GIVEN the user has modified the JSON in the textarea
- WHEN the user clicks "Guardar"
- AND the content is valid JSON
- THEN the system MUST send a PUT request to the backend
- AND show a success indicator
- AND return to read-only mode with updated data

#### Scenario: Invalid JSON

- GIVEN the user has modified the JSON with a syntax error
- WHEN the user clicks "Guardar"
- THEN the system MUST NOT send a request to the backend
- AND MUST display an error message indicating the JSON is invalid
- AND MUST remain in edit mode

#### Scenario: Backend validation error

- GIVEN the user saves valid JSON missing a required key
- WHEN the backend returns HTTP 422
- THEN the system MUST display the backend error message
- AND MUST remain in edit mode so the user can fix the issue

### Requirement: Data Refresh

After a successful save, the system MUST invalidate relevant queries so all views reflect the updated data.

#### Scenario: Visual sections update after edit

- GIVEN the user edits the JSON and saves successfully
- WHEN returning to read-only mode
- THEN the visual sections (Instrument, Indicators, Conditions) MUST reflect the new data
- AND the TODO count badge MUST be recalculated

### Requirement: Textarea UX

The textarea MUST use monospace font (`font-mono`) for readability.

The textarea MUST have adequate height (minimum 400px) to show sufficient JSON content.

The textarea MUST use theme-consistent styling (surface-2 background, border-border, text-text-primary).

#### Scenario: Large JSON editing

- GIVEN a draft with complex nested JSON
- WHEN the user enters edit mode
- THEN the textarea MUST be scrollable
- AND the JSON MUST be properly indented
