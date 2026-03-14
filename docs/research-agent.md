# Research Agent — Arquitectura

## Estructura

```
yt-ideas-pipeline/                     (repo, git)
  .claude/
    skills/
      yt-scraper/SKILL.md              skill: fetch videos por topic
      notebooklm-analyst/SKILL.md      skill: extraer estrategias con NotebookLM
      db-manager/SKILL.md              skill: guardar en YAML con dedup
    agents/
      research/
        AGENT.md                       instrucciones + feedback del agente
```

## Flujo de ejecucion

```
  ORCHESTRATOR (conversacion principal)
       │
       │  Lee .claude/agents/research/AGENT.md
       │  y lo inyecta como prompt del sub-agente
       │
       ├──> Agent("general-purpose", prompt = AGENT.md + topic)
       │         │
       │         ├─ Lee skills/yt-scraper/SKILL.md ──> ejecuta
       │         │     IN:  topic + channels.yaml
       │         │     OUT: lista de URLs
       │         │     STOP: NO_VIDEOS_FOUND
       │         │
       │         ├─ Lee skills/notebooklm-analyst/SKILL.md ──> ejecuta
       │         │     IN:  URLs de videos
       │         │     OUT: estrategias (YAML)
       │         │     STOP: NO_STRATEGIES_FOUND
       │         │
       │         └─ Lee skills/db-manager/SKILL.md ──> ejecuta
       │               IN:  estrategias
       │               OUT: guardado + dedup
       │
       │         Devuelve resumen al orchestrator
       │
       └──> (puede lanzar otro Agent en paralelo)


  ══════════════════════════════════════════════
   PARALELISMO: el orchestrator puede lanzar
   N agentes research a la vez, cada uno con
   contexto limpio (sin SDD, sin orchestrator rules)
  ══════════════════════════════════════════════

    /research "futures scalping"    /research "options selling"
              │                               │
    ┌─────────▼──────────┐          ┌─────────▼──────────┐
    │  RESEARCH AGENT 1  │          │  RESEARCH AGENT 2  │
    │  (contexto limpio) │          │  (contexto limpio) │
    │  yt -> nlm -> db   │          │  yt -> nlm -> db   │
    └────────────────────┘          └────────────────────┘
```

## Contexto del agente

El agente research recibe un contexto **limpio**, sin:
- Reglas de orchestrator (CLAUDE.md global)
- Workflow SDD
- Otras instrucciones que no sean de research

Solo recibe:
- Su AGENT.md (pipeline + feedback acumulado)
- Acceso a las skills de cada paso

## Feedback

El fichero `AGENT.md` tiene una seccion `## Feedback` donde se acumula
feedback del usuario sobre las estrategias. Ejemplos:

- "No coger estrategias de Forex, solo futuros"
- "Descartar estrategias con mas de 3 indicadores custom"
- "Priorizar estrategias intraday sobre swing"

Esto permite que el agente aprenda sin contaminar el CLAUDE.md global.
