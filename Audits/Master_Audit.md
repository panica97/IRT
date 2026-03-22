# Master Audit - IRT Project

**Last updated**: 2026-03-22

---

## Audit History

| Audit | Date | Scope | Findings | HIGH | MEDIUM | LOW | Resolved |
|-------|------|-------|----------|------|--------|-----|----------|
| [audit_01](audit_01.md) | 2026-03-22 | Full codebase | 30 | 0 | 0 | 1 | 29 |

---

## Open Findings Summary

### HIGH (0 open)

_All resolved._

### MEDIUM (0 open)

_All resolved._

### LOW (1 open)

| # | Finding | Source |
|---|---------|--------|
| 30 | No test suite | audit_01 |

---

## Resolved Findings

| # | Severity | Finding | Source | Resolved In |
|---|----------|---------|--------|-------------|
| 01 | HIGH | Default API key in source code | audit_01 | 7d6c636 |
| 02 | HIGH | API key in WebSocket query param (log leakage) | audit_01 | 7d6c636 |
| 03 | HIGH | Health endpoint returns 200 when DB is down | audit_01 | 7d6c636 |
| 04 | HIGH | No rate limiting on any endpoint | audit_01 | 7d6c636 |
| 05 | HIGH | Dual auth mechanism (middleware + dependency) | audit_01 | 7d6c636 |
| 07 | MEDIUM | Unused `inspect` import | audit_01 | 7d6c636 |
| 08 | MEDIUM | `fill_todo` overwrites non-TODO fields | audit_01 | 7d6c636 |
| 09 | MEDIUM | History sort param silent fallback | audit_01 | 7d6c636 |
| 10 | MEDIUM | `instruments` missing from health check tables | audit_01 | 7d6c636 |
| 11 | MEDIUM | flush() without commit() pattern fragility | audit_01 | 7d6c636 |
| 13 | MEDIUM | JSONB columns typed as dict but default to list | audit_01 | 7d6c636 |
| 14 | MEDIUM | `formatDuration` duplicated 4x | audit_01 | 7d6c636 |
| 15 | MEDIUM | `any` type in DraftViewer | audit_01 | 7d6c636 |
| 16 | MEDIUM | No Error Boundary | audit_01 | 7d6c636 |
| 17 | MEDIUM | WebSocket unlimited retries | audit_01 | 7d6c636 |
| 18 | MEDIUM | API key in localStorage | audit_01 | 7d6c636 |
| 19 | MEDIUM | PostgreSQL port exposed to host | audit_01 | 7d6c636 |
| 20 | MEDIUM | No Docker health checks for api/frontend | audit_01 | 7d6c636 |
| 21 | MEDIUM | Nginx missing security headers/limits | audit_01 | 7d6c636 |
| 22 | LOW | Duplicated `_extract_todo_fields` | audit_01 | 7d6c636 |
| 23 | LOW | Unused import (dup of 07) | audit_01 | 7d6c636 |
| 24 | LOW | Last-channel guard undocumented | audit_01 | 7d6c636 |
| 25 | LOW | No favicon/meta tags | audit_01 | 7d6c636 |
| 26 | LOW | No-op channel filter in HistoryPage | audit_01 | 7d6c636 |
| 27 | LOW | Root Dockerfile unclear | audit_01 | 7d6c636 |
| 28 | LOW | `node_modules` in project root | audit_01 | 7d6c636 |
| 06 | MEDIUM | No pagination on strategies list | audit_01 | pending |
| 29 | LOW | `onupdate` only for ORM ops | audit_01 | 7d6c636 |

---

## Aggregate Statistics

| Metric | Value |
|---|---|
| Total audits | 1 |
| Total findings (all time) | 30 |
| Open findings | 1 |
| Resolved findings | 29 |
| Resolution rate | 97% |
