# Phase 14: Worker Dockerization

**Status:** Planned
**Priority:** MEDIUM
**Depends on:** Phase 11 (Multi-Timeframe Complete Backtest)
**Goal:** Containerize the backtest worker so the entire IRT stack runs in Docker, ready for VPS deployment.

---

## Sub-phases

| # | Task | Route | Status |
|---|------|-------|--------|
| 14.1 | Create `worker/Dockerfile` — Python 3.12-slim, install pandas, pyarrow, requests, pydantic-settings | quick fix | Planned |
| 14.2 | Add `worker` service to `docker-compose.yml` — volume mounts for hist data and engine, depends_on api, env from worker/.env | quick fix | Planned |
| 14.3 | Bundle backtest engine inside worker container (COPY or multi-stage build from ops-worker) | /sdd-new | Planned |
| 14.4 | Update `worker/engine.py` — resolve Python path inside container (no host venv) | quick fix | Planned |
| 14.5 | Test end-to-end: docker compose up -d → create backtest job → worker picks up and completes | quick fix | Planned |
| 14.6 | VPS deployment config — production docker-compose with persistent volumes, restart policies | /sdd-new | Planned |

## Key Decisions

- **Engine bundling**: Either COPY the engine into the worker image (self-contained) or mount it as a volume (flexible, lighter images). Volume mount is simpler for dev, COPY is better for VPS.
- **Historical data**: Volume mount from host (dev) or persistent Docker volume (VPS).
- **Worker scaling**: Single instance for now. Can add replicas later if needed.

## Notes

- Reference Operations-Platform worker Dockerfile for TA-Lib compilation pattern
- The worker needs network access to the API container (docker network)
- Consider multi-stage build to keep image size small
