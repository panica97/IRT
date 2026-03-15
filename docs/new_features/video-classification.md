# PRD: Pre-filtrado de vídeos y clasificación de contenido

## Problema

Algunos canales de YouTube tienen contenido mixto: vídeos sobre estrategias de trading junto con tours de setup, Q&As, comentarios de mercado y vlogs personales. Actualmente el pipeline envía **todos** los vídeos a NotebookLM para análisis, lo que supone:

- **Gasto innecesario de créditos** de NotebookLM en vídeos irrelevantes
- **Tiempo de procesamiento desperdiciado** — cada vídeo tarda varios minutos en analizarse
- **Ruido en la base de datos** — investigaciones sin estrategias extraídas que dificultan el análisis
- **Sin distinción entre ideas y conocimiento** — una estrategia concreta y un marco teórico (ej. R Expectancy) se tratan igual

## Solución

Dos mejoras complementarias que se aplican en distintos puntos del pipeline:

### 1. Pre-filtro por título (Paso 1.5 — entre yt-scraper y notebooklm-analyst)

Un nuevo paso intermedio (`video-classifier`) analiza los títulos y descripciones de los vídeos usando una llamada ligera a **Claude Haiku** para clasificar cada vídeo en una de tres categorías:

| Categoría | Descripción | Acción |
|-----------|-------------|--------|
| `strategy` | Probablemente contiene una estrategia de trading concreta | Continúa al paso 2 |
| `knowledge` | Conocimiento general de trading, educación, análisis de mercado | Continúa al paso 2 |
| `irrelevant` | Tours de setup, Q&As, vlogs personales, reseñas de equipos | Se descarta |

- Los vídeos `irrelevant` se registran en `research_history` con `strategies_found=0` y el campo `classification=irrelevant`
- Se ahorra en créditos de NotebookLM y tiempo de procesamiento

### 2. Clasificación post-extracción (Mejora del Paso 2)

Cuando `notebooklm-analyst` extrae contenido de un vídeo, clasifica cada elemento extraído como:

| Categoría | Descripción | Ejemplo |
|-----------|-------------|---------|
| `idea` | Estrategia de trading concreta con reglas definidas | "Cruce de medias 9/21 en 15min con filtro de volumen" |
| `knowledge` | Conocimiento útil, framework, concepto o metodología | "R Expectancy como métrica de evaluación de sistemas" |

Ambos tipos se guardan en la base de datos pero con un campo `category` que permite filtrarlos por separado.

### Pipeline actualizado

```
0. preflight
1. yt-scraper          → fetch vídeos
1.5. video-classifier  → NUEVO: clasificar por título (Haiku)
2. notebooklm-analyst  → extraer + clasificar contenido
3. translator          → traducir ideas a JSON (solo ideas, no knowledge)
4. cleanup
5. db-manager
6. summary
```

## Historias de usuario

1. **Como investigador**, quiero que el pipeline descarte automáticamente los vídeos que no tratan sobre trading, para no gastar créditos de NotebookLM en contenido irrelevante.

2. **Como investigador**, quiero ver por qué un vídeo fue descartado (su clasificación), para poder ajustar los criterios si algo relevante se está filtrando.

3. **Como investigador**, quiero que el contenido extraído se clasifique como "idea" o "knowledge", para poder priorizar las estrategias concretas sobre el conocimiento general.

4. **Como usuario del dashboard**, quiero ver contadores separados de Ideas y Knowledge en la página principal, para tener una visión clara de lo que el pipeline está encontrando.

5. **Como usuario del dashboard**, quiero filtrar la lista de estrategias por categoría (idea/knowledge), para centrarme en lo que me interesa en cada momento.

6. **Como usuario del dashboard**, quiero ver en el detalle de una investigación qué clasificación recibió cada vídeo y qué tipo de contenido se extrajo, para entender el rendimiento del pipeline.

## Diseño técnico

### Nuevo skill: `video-classifier`

- **Ubicación:** `.claude/skills/video-classifier/SKILL.md`
- **Input:** Lista de vídeos con título y descripción (output de yt-scraper)
- **Output:** Lista de vídeos clasificados (`strategy`, `knowledge`, `irrelevant`)
- **Modelo:** Claude Haiku (bajo coste, baja latencia)
- **Prompt:** Se le pasa el título y descripción de cada vídeo y se le pide clasificar en las tres categorías. Se puede hacer en batch (varios vídeos en un solo prompt) para minimizar llamadas.

### Modificación de `notebooklm-analyst`

- El prompt de extracción se amplía para que, además de extraer estrategias, clasifique cada elemento como `idea` o `knowledge`.
- El output YAML de cada elemento incluye el campo `category`.

### Modificación de `translator`

- Solo traduce a JSON los elementos con `category: idea` (las estrategias concretas).
- Los elementos `knowledge` se guardan directamente en la base de datos sin pasar por el traductor de Strategy Quant.

### Modificación del `research` orchestrator

- Se añade el paso 1.5 entre yt-scraper y notebooklm-analyst.
- Se filtran los vídeos `irrelevant` antes de pasarlos al paso 2.
- El resumen final incluye estadísticas de clasificación.

## Cambios en la base de datos

### Tabla `research_history`

Añadir columna:

```sql
ALTER TABLE research_history
ADD COLUMN classification VARCHAR(20) DEFAULT NULL;
-- Valores: 'strategy', 'knowledge', 'irrelevant'
```

### Tabla `strategies`

Añadir columna:

```sql
ALTER TABLE strategies
ADD COLUMN category VARCHAR(20) DEFAULT 'idea';
-- Valores: 'idea', 'knowledge'
```

### Migración Alembic

```python
"""add classification and category fields

Revision ID: xxxx
"""

def upgrade():
    op.add_column('research_history',
        sa.Column('classification', sa.String(20), nullable=True))
    op.add_column('strategies',
        sa.Column('category', sa.String(20), server_default='idea', nullable=False))

def downgrade():
    op.drop_column('research_history', 'classification')
    op.drop_column('strategies', 'category')
```

## Cambios en la API

### Endpoints existentes modificados

**`GET /api/strategies`**
- Nuevo query param: `category` (filtro por `idea` | `knowledge` | todos)
- Response incluye el campo `category` en cada estrategia

**`GET /api/dashboard/stats`**
- Añadir contadores separados: `ideas_count`, `knowledge_count`
- Añadir tasa de filtrado: `irrelevant_videos_filtered`

**`GET /api/research/{id}`**
- Incluir `classification` en los vídeos del detalle
- Agrupar contenido extraído por categoría

### Nuevos endpoints (opcionales)

**`GET /api/stats/classification`**
- Estadísticas de clasificación: porcentaje de vídeos por categoría, evolución temporal

## Cambios en el frontend

### Dashboard (`DashboardPage.tsx`)

- Separar el contador actual de estrategias en dos: **Ideas** y **Knowledge**
- Añadir indicador de vídeos filtrados como irrelevantes (ahorro estimado)

### Estrategias (`StrategiesPage.tsx`)

- Añadir tabs o filtro por categoría: `Todas` | `Ideas` | `Knowledge`
- Indicador visual de categoría en cada fila (badge o icono)

### Detalle de investigación (`ResearchDetailPage.tsx`)

- Mostrar clasificación de cada vídeo (badge con color: verde=strategy, azul=knowledge, gris=irrelevant)
- Agrupar contenido extraído en secciones: Ideas y Knowledge
- Mostrar vídeos descartados como irrelevantes en una sección colapsable

### Tipos TypeScript

```typescript
// types/strategy.ts
interface Strategy {
  // ... campos existentes
  category: 'idea' | 'knowledge';
}

// types/research.ts
interface ResearchVideo {
  // ... campos existentes
  classification: 'strategy' | 'knowledge' | 'irrelevant';
}

interface DashboardStats {
  // ... campos existentes
  ideas_count: number;
  knowledge_count: number;
  irrelevant_filtered: number;
}
```

## Plan de migración

### Fase 1: Base de datos y API
1. Crear migración Alembic para los nuevos campos
2. Actualizar modelos SQLAlchemy (`research_history`, `strategies`)
3. Actualizar endpoints de la API
4. Marcar registros existentes: todas las estrategias actuales → `category: 'idea'`

### Fase 2: Pipeline — video-classifier
1. Crear el skill `video-classifier` con su `SKILL.md`
2. Implementar la llamada a Claude Haiku para clasificación por título
3. Integrar en el orquestador `/research` como paso 1.5
4. Tests: probar con títulos conocidos de vídeos relevantes e irrelevantes

### Fase 3: Pipeline — clasificación post-extracción
1. Modificar el prompt de `notebooklm-analyst` para incluir clasificación
2. Actualizar el parser de output para leer el campo `category`
3. Modificar `translator` para filtrar solo `idea`
4. Modificar `db-manager` para guardar el campo `category`

### Fase 4: Frontend
1. Actualizar tipos TypeScript
2. Modificar Dashboard con contadores separados
3. Añadir filtro por categoría en StrategiesPage
4. Actualizar ResearchDetailPage con clasificación visual

### Orden de dependencias

```
Fase 1 (DB + API) → Fase 2 (classifier) ──→ Fase 4 (frontend)
                   → Fase 3 (post-extracción) ↗
```

Las fases 2 y 3 pueden ejecutarse en paralelo. La fase 4 depende de que la API ya exponga los nuevos campos.

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Haiku clasifica mal un vídeo relevante | Media | Alto | Umbral conservador: en caso de duda, clasificar como `strategy`. Log de todos los descartados para revisión manual. |
| Aumento de latencia por paso extra | Baja | Bajo | Haiku es rápido (~200ms). Se pueden clasificar varios títulos en un solo prompt batch. |
| Categorización ambigua idea/knowledge | Media | Medio | Criterio claro en el prompt: si tiene reglas de entrada/salida concretas → idea. Si no → knowledge. |
| Migración rompe datos existentes | Baja | Alto | Valores por defecto seguros (`category: 'idea'`). Migración reversible con downgrade. |
