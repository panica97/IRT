---
name: db-manager
description: Save strategies to YAML database with deduplication (case-insensitive by name)
---

# DB Manager

Saves new strategies to the YAML database, avoiding duplicates.

## Database

`data/strategies/strategies.yaml`

## Rules

- Read `data/strategies/strategies.yaml` before writing
- Compare by name (case-insensitive) to detect duplicates
- Only add NEW strategies — do not overwrite existing ones
- Keep YAML format identical to existing strategies
- Write the updated file back to `data/strategies/strategies.yaml`

## Output Format

```yaml
saved:
  - "<strategy name 1>"
  - "<strategy name 2>"
skipped:
  - "<duplicate strategy name>"
total_in_db: <number>
```

## Error Handling

- File doesn't exist: create it with structure `strategies: []`
- Input YAML has invalid format: report which strategies and save nothing
- Write error: report the error
