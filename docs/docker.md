# Docker

## Build

```bash
docker compose build
```

Imagen base `python:3.12-slim`. Instala dependencias de `requirements.txt`.

## Ejecucion

Los scripts se invocan con `docker compose run`:

```bash
# Buscar en YouTube
docker compose run pipeline python -m tools.youtube.search "futures trading" --count 5

# Fetch por topic
docker compose run pipeline python -m tools.youtube.fetch_topic --db data/channels/channels.yaml futures --days 14

# Gestionar canales
docker compose run pipeline python -m tools.youtube.channels --db data/channels/channels.yaml topics
```

## Volumenes

| Volumen | Contenedor | Proposito |
|---------|------------|-----------|
| `./data` | `/app/data` | Datos persistentes (channels, strategies, backtests) |
| `./config` | `/app/config` | Configuracion |

Los datos viven fuera del contenedor. Rebuilds no los pierden.

## Variables de entorno

Definidas en `.env` (no versionado):

```
NOTEBOOKLM_AUTH_JSON=    # Auth de NotebookLM para CI/CD
SQ_API_KEY=              # Strategy Quant (futuro)
```

## Deploy en VPS

```bash
git clone <repo>
cp .env.example .env     # rellenar secrets
docker compose up -d
```
