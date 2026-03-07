# Arquitectura

## Vision general

Jarvis es un sistema multi-agente orquestado por Claude Code con dos pipelines:

```
                    ┌─────────────────────────────────────┐
                    │           Claude Code CLI            │
                    │         (orquestador principal)       │
                    └──────────┬──────────────┬────────────┘
                               │              │
                 ┌─────────────▼──┐    ┌──────▼─────────┐
                 │   Research      │    │   Code          │
                 │   Quant         │    │   Pipeline      │
                 └─────────────┬──┘    └──────┬─────────┘
                               │              │
          ┌──────────┬─────────┼────────┐     ├── developer
          │          │         │        │     ├── reviewer
     yt_scraper  notebooklm  db_mgr  backtester  └── tester
```

## Pipeline Research Quant

Flujo principal de extraccion de estrategias:

```
1. YouTube Scraper          Busca videos recientes por topic
        │                   tools/youtube/fetch_topic.py
        │
2. NotebookLM Agent         Crea notebook, anade videos como fuentes,
        │                   extrae estrategia via chat
        │
3. DB Manager               Guarda la estrategia estructurada
        │                   en data/strategies/strategies.yaml
        │
4. Backtester               Traduce reglas a Strategy Quant
                            y ejecuta backtest (pendiente)
```

## Pipeline Code

Agentes de desarrollo del propio proyecto:

- **Developer** — implementa features y fixes
- **Reviewer** — revisa codigo antes de merge
- **Tester** — escribe y ejecuta tests

## Stack

| Componente | Tecnologia |
|------------|------------|
| Orquestador | Claude Code CLI |
| Scripts | Python 3.12 |
| Busqueda YouTube | yt-dlp |
| Extraccion estrategias | NotebookLM (notebooklm-py) |
| Backtesting | Strategy Quant (pendiente) |
| Datos | YAML (channels, strategies) |
| Deploy | Docker + VPS |

## Estructura de directorios

```
jarvis/
├── CLAUDE.md                  Contexto global para Claude Code
├── Dockerfile                 Imagen Python 3.12
├── docker-compose.yml         Servicio pipeline con volumenes
├── requirements.txt           Dependencias Python
├── .env                       Secrets (no versionado)
├── .claude/
│   ├── commands/              Slash commands (en ~/.claude/ del host)
│   └── skills/
│       └── notebooklm/        Skill completa de NotebookLM
├── agents/
│   ├── research/              Pipeline de investigacion
│   │   ├── youtube_scraper/
│   │   ├── notebooklm/
│   │   ├── db_manager/
│   │   └── backtester/
│   └── code/                  Pipeline de desarrollo
│       ├── developer/
│       ├── reviewer/
│       └── tester/
├── tools/                     Scripts Python ejecutables
│   ├── youtube/               search, fetch_topic, channels
│   ├── notebooklm/            (pendiente)
│   └── database/              (pendiente)
├── config/
│   └── settings.json          Configuracion global
├── data/
│   ├── channels/              channels.yaml
│   ├── strategies/            strategies.yaml
│   └── backtests/             Resultados (CSV/JSON)
└── queue/
    └── tasks.md               Cola de tareas entre agentes
```
