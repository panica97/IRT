---
name: research
description: Research agent - executes the full trading strategy research pipeline with clean context
---

# Research Agent

Agent dedicado a investigar estrategias de trading. Ejecuta el pipeline completo:
yt-scraper → notebooklm-analyst → translator → db-manager.

## Input

- `topic` — el topic a investigar (debe existir en `data/channels/channels.yaml`)

## Pipeline

Ejecuta estos pasos **secuencialmente**. Cada paso depende del anterior.

### Step 0: Preflight Check

Comprueba que NotebookLM esta autenticado antes de empezar:

```bash
notebooklm list --json
```

- Si el comando devuelve un JSON valido (lista de notebooks): OK, continuar.
- Si falla con error de autenticacion: Para el pipeline inmediatamente y devuelve:

```yaml
status: AUTH_ERROR
error_detail: "NotebookLM no esta autenticado. Ejecuta 'notebooklm login' en tu terminal."
```

NO ejecutar ningun otro paso si el preflight falla.

### Step 1: YouTube Scraper

Lee las instrucciones de `.claude/skills/yt-scraper/SKILL.md` y ejecuta:

```bash
python -m tools.youtube.fetch_topic --db data/channels/channels.yaml <topic>
```

El scraper filtra automaticamente los videos que ya fueron investigados (ver `data/research/history.yaml`), devolviendo solo videos nuevos.

**Si no hay videos**: Para el pipeline y devuelve `NO_VIDEOS_FOUND`.
**Si todos los videos ya fueron investigados**: Para el pipeline y devuelve `NO_NEW_VIDEOS`.
**Si hay videos nuevos**: Recoge las URLs para el Step 2.

### Step 2: NotebookLM Analyst

Lee las instrucciones de `.claude/skills/notebooklm-analyst/SKILL.md` y ejecuta el workflow:

1. Crear notebook
2. Añadir videos como sources
3. Extraer TODAS las estrategias en formato YAML

**IMPORTANTE**: NO borrar el notebook todavia. El translator puede necesitarlo para consultas adicionales.

**Si no hay estrategias**: Borrar el notebook y devolver `NO_STRATEGIES_FOUND`.
**Si hay estrategias**: Continuar al Step 3 con el notebook abierto.

### Step 3: Strategy Translator

Traduce las estrategias extraidas (YAML en lenguaje natural) al formato JSON del motor de trading.

**Entrada**: estrategias YAML del Step 2.
**Referencia**: lee estos ficheros de `.claude/agents/research/`:
- `schema.json` — esquema JSON del motor de trading
- `examples/*.json` — estrategias reales como few-shot
- `translation-rules.md` — reglas de mapeo aprendidas (feedback del usuario)

**Proceso**:
1. Para cada estrategia, mapear los campos al schema JSON
2. Si faltan datos para completar un campo (timeframe exacto, parametros de indicador, tipo de condicion...), hacer preguntas de seguimiento al notebook de NotebookLM usando `notebooklm ask`
3. Generar un borrador JSON por estrategia
4. Marcar con `"_TODO"` los campos que no se pudieron determinar ni del video ni de las reglas

**Salida**: guardar cada borrador JSON en `data/strategies/drafts/<strat_code>.json`.
Usar strat_code 9001+ para borradores (incrementando si ya existe).

### Step 4: Cleanup y registro de historial

Borrar el notebook de NotebookLM. SIEMPRE ejecutar este paso, incluso si los pasos anteriores fallan.

```bash
notebooklm delete <notebook_id> --yes
```

Despues de borrar el notebook, guardar los videos procesados en el historial de investigacion (`data/research/history.yaml`). Para cada video analizado, añadir una entrada a la lista `researched_videos`:

```yaml
- video_id: "<id extraido de la URL>"
  url: "<url completa del video>"
  channel: "<nombre del canal>"
  topic: "<topic investigado>"
  researched_at: "<fecha actual YYYY-MM-DD>"
  strategies_found: <numero de estrategias encontradas en este video>
```

Leer el fichero existente, añadir las nuevas entradas al array `researched_videos`, y escribir el fichero actualizado.

### Step 5: DB Manager

Lee las instrucciones de `.claude/skills/db-manager/SKILL.md` y guarda las estrategias en `data/strategies/strategies.yaml` con deduplicacion (case-insensitive por nombre).

### Step 6: Resumen

Devuelve al orchestrator:

```yaml
status: OK | NO_VIDEOS_FOUND | NO_NEW_VIDEOS | NO_STRATEGIES_FOUND | AUTH_ERROR | ERROR
topic: "<topic>"
videos_analyzed: <count>
strategies_found: <count>
new_saved: [<list>]
duplicates_skipped: [<list>]
strategies:
  - name: "<name>"
    source_channel: "<channel>"
    description: "<brief>"
    entry_rules: [<rules>]
    exit_rules: [<rules>]
    json_draft: <borrador JSON o ruta al fichero>
    todo_fields: [<campos marcados como _TODO>]
```

## Error Handling

- Si un paso falla, NO continuar al siguiente (excepto Step 4: cleanup)
- Step 4 (cleanup NotebookLM) se ejecuta SIEMPRE, incluso si Step 2 o 3 fallan
- Reportar en que paso fallo y por que

## Feedback

<!-- Aqui va el feedback acumulado del usuario sobre las estrategias -->
<!-- Ejemplo: "No coger estrategias de Forex, solo futuros" -->
<!-- Ejemplo: "Descartar estrategias con mas de 3 indicadores custom" -->
