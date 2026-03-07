# Jarvis — Multi-Agent Trading Research Pipeline

Pipeline que monitorea canales de YouTube de trading, extrae estrategias usando NotebookLM y las prepara para backtesting en Strategy Quant. Orquestado por Claude Code como sistema multi-agente.

## Quickstart

```bash
# Build
docker compose build

# Buscar videos
docker compose run pipeline python -m tools.youtube.search "futures trading" --count 5

# Fetch por topic
docker compose run pipeline python -m tools.youtube.fetch_topic --db data/channels/channels.yaml futures --days 14
```

Desde Claude Code:

```
/yt-search --topic futures --days 14
/yt-channels list
/notebooklm
```

## Documentacion

- [Arquitectura](docs/architecture.md) — pipelines, agentes, stack, estructura de directorios
- [Tools](docs/tools.md) — scripts de YouTube, slash commands
- [Schemas de datos](docs/data-schemas.md) — channels.yaml, strategies.yaml
- [Docker](docs/docker.md) — build, ejecucion, volumenes, deploy
