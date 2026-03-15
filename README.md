# IRT (Ideas Research Team)

Pipeline de investigación de estrategias de trading. Monitorea canales de YouTube, extrae estrategias con NotebookLM y las persiste en PostgreSQL con un dashboard en tiempo real.

## Stack

- **Orquestador:** Claude Code CLI
- **Backend:** Python 3.12, FastAPI
- **Frontend:** React 18 + TypeScript + Tailwind CSS
- **Base de datos:** PostgreSQL 16
- **Scraping:** yt-dlp
- **Análisis:** NotebookLM (notebooklm-py)
- **Deploy:** Docker + Docker Compose

## Pipeline de investigación

```
yt-scraper → notebooklm-analyst → translator → db-manager
```

1. **yt-scraper** — busca vídeos recientes en canales de trading registrados
2. **notebooklm-analyst** — analiza los vídeos y extrae estrategias estructuradas
3. **translator** — traduce las estrategias a formato JSON normalizado
4. **db-manager** — guarda en PostgreSQL con deduplicación

Se lanza con `/research <topic>` desde Claude Code.

## Estructura del proyecto

```
api/                    FastAPI backend (puerto 8000)
frontend/               React dashboard (puerto 5173)
tools/                  Scripts Python del pipeline
  youtube/              Búsqueda y scraping (yt-dlp)
  notebooklm/           Integración con NotebookLM
  database/             Gestión de base de datos
config/                 Configuración global
data/                   Datos persistentes (channels, strategies)
docs/                   Documentación
.claude/skills/         Skills de Claude Code (research, yt-scraper, etc.)
```

## Requisitos

- Docker y Docker Compose
- Fichero `.env` con las variables necesarias (ver `.env.example`)

## Cómo ejecutar

```bash
# Levantar todos los servicios
docker compose up -d

# El dashboard estará en http://localhost:5173
# La API estará en http://localhost:8000

# Ejecutar el pipeline manualmente
docker compose run pipeline python -m tools.youtube.search "futures trading" --count 5

# Ver canales registrados
docker compose run pipeline python -m tools.youtube.channels --db data/channels/channels.yaml topics
```

## Servicios

| Servicio | Puerto | Descripción |
|----------|--------|-------------|
| `frontend` | 5173 | Dashboard React |
| `api` | 8000 | API FastAPI |
| `postgres` | 5432 | Base de datos |
| `pipeline` | — | Scripts del pipeline (bajo demanda) |
