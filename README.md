# Jarvis

Sistema de agentes IA que opera como una empresa con dos departamentos:

## Research

Investiga y extrae estrategias de trading cuantitativo:

1. **YouTube Scraper** — monitorea canales de trading y detecta videos relevantes
2. **NotebookLM Analyst** — analiza los videos y extrae estrategias estructuradas (reglas de entrada/salida, parametros, gestion de riesgo)
3. **DB Manager** — mantiene las bases de datos de canales y estrategias
4. **Backtester** — traduce las estrategias a Strategy Quant y ejecuta backtests

## Code

Desarrolla y mantiene la infraestructura del sistema:

1. **Developer** — implementa features y fixes
2. **Reviewer** — revisa codigo antes de integrar
3. **Tester** — valida que todo funcione

## Stack

- **Orquestador:** Claude Code CLI
- **Lenguaje:** Python 3.12
- **Scraping:** yt-dlp
- **Analisis:** NotebookLM (notebooklm-py)
- **Backtesting:** Strategy Quant
- **Deploy:** Docker + VPS

## Documentacion

- [Arquitectura](docs/architecture.md) — pipelines, estructura, flujo de datos
- [Tools](docs/tools.md) — scripts y slash commands
- [Schemas de datos](docs/data-schemas.md) — channels.yaml, strategies.yaml
- [Docker](docs/docker.md) — build, deploy, volumenes
