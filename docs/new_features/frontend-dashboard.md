# PRD: Frontend Dashboard para Trading Research Pipeline

## 1. Titulo y resumen

**Frontend Dashboard** -- interfaz web para visualizar y gestionar los datos del pipeline de investigacion de trading (canales, estrategias, historial) y monitorizar en tiempo real el estado de las investigaciones lanzadas desde el CLI.

El dashboard NO lanza investigaciones. El flujo de research sigue siendo exclusivo de Claude Code CLI. El frontend es una ventana de lectura y gestion de datos sobre los mismos ficheros YAML/JSON que usa el pipeline.

---

## 2. Contexto y problema

Actualmente toda la interaccion con los datos del pipeline se hace via CLI o editando ficheros YAML/JSON a mano. Esto presenta varios problemas:

- **Visibilidad limitada**: no hay forma rapida de ver todas las estrategias, canales o el historial de investigacion sin abrir ficheros individuales.
- **Gestion de canales**: anadir o eliminar canales requiere editar `channels.yaml` manualmente, con riesgo de romper el formato.
- **Borradores JSON**: los drafts en `data/strategies/drafts/*.json` contienen campos `_TODO` que necesitan atencion del usuario, pero no hay forma facil de identificarlos.
- **Estado del research**: cuando el agente de investigacion esta corriendo, no hay feedback visual del progreso.

El dashboard resuelve estos problemas ofreciendo una interfaz web que lee y escribe los mismos ficheros que el pipeline, sin duplicar datos ni introducir una base de datos separada.

---

## 3. Arquitectura

```
VPS (produccion) / Local (desarrollo)
  Claude Code CLI --> ejecuta research --> escribe YAML/JSON
                                                |
  FastAPI backend --> lee/escribe mismos ficheros --+
       |
       |-- REST API para gestion de datos
       |-- WebSocket para estado del research en tiempo real

Navegador del usuario
  React app --HTTP/WS--> FastAPI backend
```

### Principios clave

- **Ficheros como base de datos**: no hay base de datos. Los ficheros YAML/JSON en `data/` son la unica fuente de verdad.
- **Lectura compartida**: tanto el CLI como el backend leen los mismos ficheros. Las escrituras del backend (por ejemplo, anadir un canal) modifican los mismos ficheros que el CLI lee.
- **Sin conflictos de escritura**: el research (CLI) y el dashboard (API) no escriben al mismo fichero simultaneamente. El research escribe a `strategies.yaml`, `history.yaml` y `drafts/`. El dashboard escribe a `channels.yaml` y lee el resto. Excepcion: `current.yaml` lo escribe el CLI y lo lee el dashboard (solo lectura).

---

## 4. Stack tecnologico

| Capa | Tecnologia | Justificacion |
|------|------------|---------------|
| Frontend | React 18 + TypeScript | Ecosistema amplio, tipado estatico, componentes reutilizables |
| Estilos | Tailwind CSS | Utilidades, rapido de prototipar, coherente |
| Estado frontend | React Query (TanStack Query) | Cache, invalidacion automatica, polling sencillo |
| Build frontend | Vite | Rapido, soporte nativo de TypeScript |
| Backend | FastAPI (Python 3.12) | Asincrono, validacion con Pydantic, WebSocket nativo, mismo lenguaje que el pipeline |
| Validacion | Pydantic v2 | Modelos tipados para YAML/JSON |
| YAML | PyYAML / ruamel.yaml | ruamel.yaml preserva comentarios y orden de claves |
| WebSocket | fastapi.websockets | Integrado en FastAPI |
| Despliegue | Docker Compose | Mismo compose que el pipeline existente |
| Proxy reverso | Caddy o Nginx | HTTPS automatico en VPS |

---

## 5. Funcionalidades

### 5.1 Gestion de canales (CRUD)

**Descripcion**: permite ver, anadir y eliminar canales de YouTube agrupados por topic. Opera sobre `data/channels/channels.yaml`.

**Estructura actual del fichero**:
```yaml
topics:
  futures:
    description: Futures strategies
    channels:
    - name: Jacob Amaral
      url: https://www.youtube.com/@jacobamaral
      last_fetched: '2026-03-14'
  trading:
    description: Algorithmic and quantitative trading
    channels:
    - name: QuantProgram
      url: https://www.youtube.com/@QuantProgram
      last_fetched: null
```

**Criterios de aceptacion**:

- [ ] Listar todos los topics con sus canales en vista de tarjetas agrupadas.
- [ ] Cada tarjeta de canal muestra: nombre, URL (enlace), fecha del ultimo fetch (o "Nunca" si es null).
- [ ] Boton "Anadir canal" dentro de cada topic: formulario con campos `name` y `url`. Validar que la URL tiene formato de canal de YouTube (`https://www.youtube.com/@...` o `https://www.youtube.com/c/...` o `https://www.youtube.com/channel/...`).
- [ ] Boton "Eliminar canal" con confirmacion. No permitir eliminar si solo queda un canal en el topic (el topic quedaria sin canales).
- [ ] Al anadir un canal, el campo `last_fetched` se inicializa como `null`.
- [ ] Los cambios se persisten inmediatamente en `channels.yaml` via la API.
- [ ] Mensajes de error claros si la API falla (fichero bloqueado, formato invalido, etc.).
- [ ] No se puede anadir un canal con la misma URL que otro ya existente en el mismo topic (deduplicacion).

### 5.2 Historial de investigacion

**Descripcion**: visualiza los videos investigados desde `data/research/history.yaml`. Solo lectura.

**Estructura del fichero**:
```yaml
researched_videos:
  - video_id: "G0c7GAg-FCY"
    url: "https://youtube.com/watch?v=G0c7GAg-FCY"
    channel: "Jacob Amaral"
    topic: "futures"
    researched_at: "2026-03-14"
    strategies_found: 1
```

**Criterios de aceptacion**:

- [ ] Tabla con columnas: video ID (enlace a YouTube), canal, topic, fecha, estrategias encontradas.
- [ ] Filtros: por topic (dropdown), por canal (dropdown, dependiente del topic seleccionado), por rango de fechas.
- [ ] Ordenacion por fecha (descendente por defecto), por canal o por numero de estrategias.
- [ ] Contador total de videos investigados visible en la cabecera.
- [ ] Si la lista esta vacia, mostrar mensaje "No se han investigado videos todavia".
- [ ] Paginacion o scroll infinito si hay mas de 50 entradas.

### 5.3 Visor de estrategias

**Descripcion**: visualiza las estrategias en dos formatos: las estrategias YAML crudas (`strategies.yaml`) y los borradores JSON traducidos (`drafts/*.json`).

#### 5.3.1 Estrategias YAML

**Estructura del fichero** (ver `data/strategies/strategies.yaml` para el formato completo):
```yaml
strategies:
  - name: RTY Hybrid BB Monthly Governor Strategy
    description: "..."
    source_channel: Jacob Amaral
    source_videos: [...]
    parameters: [...]
    entry_rules: [...]
    exit_rules: [...]
    risk_management: [...]
    notes: [...]
```

**Criterios de aceptacion**:

- [ ] Lista de estrategias con nombre, canal fuente y descripcion resumida.
- [ ] Al hacer clic en una estrategia, expandir o navegar a una vista de detalle con:
  - Descripcion completa
  - Parametros en tabla (nombre, tipo, default, rango)
  - Reglas de entrada como lista
  - Reglas de salida como lista
  - Gestion de riesgo como lista
  - Notas
  - Videos fuente (como enlaces a YouTube)
- [ ] Filtro por canal fuente.
- [ ] Busqueda por texto libre (busca en nombre y descripcion).

#### 5.3.2 Borradores JSON (Drafts)

**Estructura del fichero** (ver `data/strategies/drafts/9001.json` para referencia):
- Ficheros JSON individuales por estrategia, con `strat_code` como identificador.
- Campos `_TODO` indican valores que el usuario debe completar manualmente.
- Campo `_notes` contiene observaciones sobre la traduccion.

**Criterios de aceptacion**:

- [ ] Lista de borradores con: strat_code, strat_name, symbol, estado (active/tested/prod como badges).
- [ ] Vista de detalle renderizada de forma legible (NO mostrar JSON crudo):
  - Seccion "Instrumento": symbol, secType, exchange, currency, multiplier.
  - Seccion "Indicadores": tabla con indicador, parametros, timeframe.
  - Seccion "Condiciones Long": lista de condiciones con su tipo y codigo.
  - Seccion "Condiciones Short": igual.
  - Seccion "Stop Loss / Take Profit": configuracion renderizada.
  - Seccion "Parametros de control": tabla.
  - Seccion "Notas": contenido de `_notes`.
- [ ] **Campos `_TODO` resaltados** en rojo/naranja con un icono de atencion. Deben ser visualmente obvios.
- [ ] Contador de campos `_TODO` visible en la lista (por ejemplo "3 campos pendientes").
- [ ] Filtro para ver solo borradores con campos `_TODO` pendientes.

### 5.4 Estado del research en tiempo real

**Descripcion**: el agente de investigacion (CLI) escribe su estado en `data/research/current.yaml`. El backend lo sirve via WebSocket al frontend.

**Estructura del fichero de estado**:
```yaml
status: running | completed | error | idle
topic: "futures"
step: 2
step_name: "notebooklm-analyst"
total_steps: 6
channel: "Jacob Amaral"
videos_processing: ["G0c7GAg-FCY"]
started_at: "2026-03-14T10:30:00"
error_detail: null
```

**Criterios de aceptacion**:

- [ ] Panel de estado con indicador visual del estado actual:
  - `running`: indicador verde pulsante con nombre del paso actual.
  - `completed`: indicador verde estatico con resumen.
  - `error`: indicador rojo con detalle del error.
  - `idle`: indicador gris con "No hay investigacion en curso".
- [ ] Barra de progreso basada en `step` / `total_steps`.
- [ ] Detalle visible: topic, paso actual (nombre legible), canal siendo procesado, videos en proceso (como enlaces).
- [ ] Timestamp de inicio formateado ("hace 5 minutos" o similar).
- [ ] Actualizacion via WebSocket: el backend observa `current.yaml` (polling cada 2 segundos al fichero) y envia actualizaciones por WebSocket cuando hay cambios.
- [ ] Si el fichero no existe o esta vacio, mostrar estado `idle`.
- [ ] Cuando transiciona a `completed`, mostrar un resumen breve y enlace a la pagina de estrategias.

**Nombres legibles de los pasos**:

| step | step_name | Nombre en UI |
|------|-----------|-------------|
| 0 | preflight | Comprobacion de autenticacion |
| 1 | yt-scraper | Buscando videos |
| 2 | notebooklm-analyst | Extrayendo estrategias |
| 3 | translator | Traduciendo a JSON |
| 4 | cleanup | Limpieza |
| 5 | db-manager | Guardando en base de datos |
| 6 | summary | Resumen final |

### 5.5 Dashboard (pagina principal)

**Descripcion**: vista resumen con estadisticas globales y accesos directos.

**Criterios de aceptacion**:

- [ ] Tarjetas de resumen (stats cards):
  - Total de topics
  - Total de canales
  - Total de videos investigados
  - Total de estrategias (YAML)
  - Total de borradores JSON
  - Borradores con `_TODO` pendientes
- [ ] Seccion "Ultima investigacion": muestra el ultimo research completado (de history.yaml, el mas reciente por fecha).
- [ ] Seccion "Estado actual": mini-widget del estado del research (version compacta de la pagina Live).
- [ ] Enlaces rapidos a cada seccion.

### 5.6 Seguridad

**Descripcion**: autenticacion por API key para un solo usuario.

**Criterios de aceptacion**:

- [ ] API key configurada via variable de entorno `DASHBOARD_API_KEY` en `.env`.
- [ ] Toda peticion HTTP al backend debe incluir el header `X-API-Key`.
- [ ] Si la API key es invalida o falta, devolver `401 Unauthorized`.
- [ ] El frontend almacena la API key en localStorage despues de que el usuario la introduzca en un formulario de login.
- [ ] Pantalla de login: un unico campo "API Key" + boton "Entrar". No hay usuario/password.
- [ ] CORS configurado via variable de entorno `CORS_ORIGINS` (lista separada por comas).
- [ ] En produccion, el backend corre detras de un proxy reverso (Caddy/Nginx) que gestiona HTTPS.
- [ ] Endpoint `GET /api/health` publico (sin autenticacion) para health checks.

---

## 6. Paginas y vistas

### 6.1 Layout general

- **Sidebar izquierdo** fijo con navegacion:
  - Dashboard (icono home)
  - Canales
  - Historial
  - Estrategias
  - Live
- **Header superior** con titulo del proyecto y un indicador de estado del research (punto verde/rojo/gris).
- **Area de contenido** principal a la derecha del sidebar.
- Tema oscuro por defecto (los traders usan pantallas muchas horas).

### 6.2 Pagina Dashboard

```
+--------------------------------------------------+
| [Stats Cards - 6 tarjetas en grid 3x2]           |
|  Topics: 3  | Canales: 5  | Videos: 12           |
|  Estrategias: 8 | Drafts: 3 | TODOs: 2           |
+--------------------------------------------------+
| Estado actual          | Ultima investigacion    |
| [Mini widget Live]     | Topic: futures           |
|                        | Fecha: 2026-03-14        |
|                        | Videos: 3                |
|                        | Estrategias: 1           |
+--------------------------------------------------+
```

### 6.3 Pagina Canales

```
+--------------------------------------------------+
| Canales                          [+ Anadir topic] |
+--------------------------------------------------+
| > futures (2 canales)                             |
|   Futures strategies                              |
|   +--------------------------------------------+ |
|   | Jacob Amaral     | @jacobamaral | 14/03/26 | |
|   |                                    [Borrar] | |
|   | NQ Scalper       | @nqscalper   | Nunca    | |
|   |                                    [Borrar] | |
|   +--------------------------------------------+ |
|   [+ Anadir canal]                               |
|                                                   |
| > trading (1 canal)                               |
|   ...                                             |
+--------------------------------------------------+
```

### 6.4 Pagina Historial

```
+--------------------------------------------------+
| Historial de investigacion       Total: 12 videos |
+--------------------------------------------------+
| Filtros: [Topic v] [Canal v] [Desde] [Hasta]      |
+--------------------------------------------------+
| Video ID    | Canal         | Topic   | Fecha     |
| G0c7GAg-FCY | Jacob Amaral | futures | 14/03/26  |
| a1b2c3d4    | QuantProgram | trading | 12/03/26  |
| ...                                               |
+--------------------------------------------------+
```

### 6.5 Pagina Estrategias

Dos pestanas: **YAML** y **Drafts JSON**.

**Pestana YAML**:
```
+--------------------------------------------------+
| Estrategias YAML                                  |
| [Buscar...____________]  [Canal: Todos v]         |
+--------------------------------------------------+
| > RTY Hybrid BB Monthly Governor Strategy         |
|   Jacob Amaral | 3 videos fuente                  |
|   Multi-mode futures trading strategy...          |
|   [Click para expandir detalle]                   |
+--------------------------------------------------+
```

**Pestana Drafts JSON**:
```
+--------------------------------------------------+
| Borradores JSON                [Solo con TODOs v] |
+--------------------------------------------------+
| 9001 | RTY_BB_MonthlyGov_1 | RTY | 5 TODOs      |
|       active: No | tested: No | prod: No         |
|   [Ver detalle]                                   |
+--------------------------------------------------+
```

**Vista detalle de draft**:
```
+--------------------------------------------------+
| 9001 - RTY_BB_MonthlyGov_1          [5 TODOs]    |
+--------------------------------------------------+
| Instrumento                                       |
|   Symbol: RTY | Tipo: FUT | Exchange: CME         |
|   Multiplier: 50 | Min Tick: 0.1                  |
+--------------------------------------------------+
| Indicadores (1 day)                               |
|   PRICE  | high, period=1        | HIGH_1D        |
|   BBANDS | close, period=20, 2.0 | BB_20_2_1D     |
|   ATR    | period=20             | ATR_20_1D_SL   |
+--------------------------------------------------+
| Condiciones Long                                  |
|   cross_ind_relation: HIGH_1D crosses_below ...   |
+--------------------------------------------------+
| Stop Loss                                         |
|   Tipo: indicator                                 |
|   multiple: [!] _TODO    <-- resaltado en rojo    |
|   col: ATR_20_1D_SL                               |
+--------------------------------------------------+
| Notas                                             |
|   monthly_governor: La logica del Monthly...      |
+--------------------------------------------------+
```

### 6.6 Pagina Live

```
+--------------------------------------------------+
| Estado del Research en Tiempo Real                |
+--------------------------------------------------+
|                                                   |
|   [============================------] 4/6        |
|                                                   |
|   Estado: EN CURSO (punto verde pulsante)         |
|   Topic: futures                                  |
|   Paso: 4 - Limpieza                              |
|   Canal: Jacob Amaral                             |
|   Videos: G0c7GAg-FCY (enlace)                    |
|   Inicio: hace 12 minutos                         |
|                                                   |
+--------------------------------------------------+
```

Cuando `idle`:
```
+--------------------------------------------------+
|                                                   |
|   (punto gris)                                    |
|   No hay investigacion en curso                   |
|   Lanza una con /research <topic> en el CLI       |
|                                                   |
+--------------------------------------------------+
```

---

## 7. Estructura de ficheros

```
frontend/
  src/
    components/
      layout/
        Sidebar.tsx
        Header.tsx
        Layout.tsx
      common/
        StatsCard.tsx
        StatusBadge.tsx
        ConfirmDialog.tsx
        TodoBadge.tsx
        LoadingSpinner.tsx
      channels/
        ChannelCard.tsx
        ChannelForm.tsx
        TopicGroup.tsx
      strategies/
        StrategyCard.tsx
        StrategyDetail.tsx
        DraftCard.tsx
        DraftDetail.tsx
        TodoHighlight.tsx
        IndicatorTable.tsx
        ConditionList.tsx
      history/
        HistoryTable.tsx
        HistoryFilters.tsx
      live/
        ResearchStatus.tsx
        ProgressBar.tsx
        StepIndicator.tsx
    pages/
      DashboardPage.tsx
      ChannelsPage.tsx
      HistoryPage.tsx
      StrategiesPage.tsx
      LivePage.tsx
      LoginPage.tsx
    services/
      api.ts              # Cliente HTTP con interceptor de API key
      channels.ts          # Llamadas a /api/channels
      strategies.ts        # Llamadas a /api/strategies
      history.ts           # Llamadas a /api/history
      research.ts          # WebSocket para estado live
    hooks/
      useWebSocket.ts      # Hook generico de WebSocket con reconexion
      useResearchStatus.ts # Hook especifico para estado del research
    types/
      channel.ts
      strategy.ts
      draft.ts
      history.ts
      research.ts
    App.tsx
    main.tsx
    router.tsx
  public/
  index.html
  package.json
  tsconfig.json
  tailwind.config.js
  vite.config.ts
  Dockerfile

api/
  main.py                  # App FastAPI, CORS, middleware de auth
  config.py                # Settings (rutas a ficheros, API key, CORS)
  dependencies.py          # Dependency injection (auth, file paths)
  routers/
    channels.py            # CRUD canales
    strategies.py          # Lectura estrategias YAML + JSON drafts
    history.py             # Lectura historial
    research.py            # WebSocket estado live
    health.py              # Health check
  services/
    yaml_manager.py        # Lectura/escritura YAML con ruamel.yaml
    json_manager.py        # Lectura de drafts JSON
    file_watcher.py        # Polling de current.yaml para WebSocket
  models/
    channel.py             # Pydantic models para canales
    strategy.py            # Pydantic models para estrategias
    draft.py               # Pydantic models para drafts JSON
    history.py             # Pydantic models para historial
    research.py            # Pydantic models para estado del research
  requirements.txt
  Dockerfile
```

---

## 8. API endpoints

### Base URL

- Desarrollo: `http://localhost:8000/api`
- Produccion: `https://tu-dominio.com/api`

### Autenticacion

Todas las rutas (excepto `/api/health`) requieren header:
```
X-API-Key: <valor de DASHBOARD_API_KEY>
```

### 8.1 Health Check

```
GET /api/health
```

**Respuesta** `200`:
```json
{
  "status": "ok",
  "files": {
    "channels": true,
    "strategies": true,
    "history": true,
    "drafts_dir": true
  }
}
```

### 8.2 Canales

#### Listar todos los topics y canales

```
GET /api/channels
```

**Respuesta** `200`:
```json
{
  "topics": {
    "futures": {
      "description": "Futures strategies",
      "channels": [
        {
          "name": "Jacob Amaral",
          "url": "https://www.youtube.com/@jacobamaral",
          "last_fetched": "2026-03-14"
        }
      ]
    }
  }
}
```

#### Obtener canales de un topic

```
GET /api/channels/{topic}
```

**Respuesta** `200`: objeto del topic con su descripcion y array de canales.
**Respuesta** `404`: `{"detail": "Topic 'xxx' no encontrado"}`.

#### Anadir canal a un topic

```
POST /api/channels/{topic}
Content-Type: application/json

{
  "name": "NQ Scalper",
  "url": "https://www.youtube.com/@nqscalper"
}
```

**Validaciones**:
- `name`: string no vacio, max 100 caracteres.
- `url`: debe ser URL valida de canal de YouTube.
- No puede existir otro canal con la misma `url` en el mismo topic.

**Respuesta** `201`:
```json
{
  "name": "NQ Scalper",
  "url": "https://www.youtube.com/@nqscalper",
  "last_fetched": null
}
```

**Respuesta** `409`: `{"detail": "Canal con URL 'xxx' ya existe en topic 'futures'"}`.
**Respuesta** `422`: error de validacion.

#### Eliminar canal de un topic

```
DELETE /api/channels/{topic}/{channel_name}
```

**Validaciones**:
- El topic debe existir.
- El canal debe existir dentro del topic.
- No se puede eliminar si es el unico canal del topic.

**Respuesta** `204`: sin cuerpo.
**Respuesta** `404`: topic o canal no encontrado.
**Respuesta** `409`: `{"detail": "No se puede eliminar el unico canal del topic"}`.

### 8.3 Historial

#### Listar historial de investigacion

```
GET /api/history?topic=futures&channel=Jacob+Amaral&from=2026-03-01&to=2026-03-31&sort=date&order=desc&page=1&limit=50
```

Todos los query params son opcionales.

**Respuesta** `200`:
```json
{
  "total": 12,
  "page": 1,
  "limit": 50,
  "items": [
    {
      "video_id": "G0c7GAg-FCY",
      "url": "https://youtube.com/watch?v=G0c7GAg-FCY",
      "channel": "Jacob Amaral",
      "topic": "futures",
      "researched_at": "2026-03-14",
      "strategies_found": 1
    }
  ]
}
```

#### Obtener estadisticas del historial

```
GET /api/history/stats
```

**Respuesta** `200`:
```json
{
  "total_videos": 12,
  "total_strategies_found": 8,
  "by_topic": {
    "futures": {"videos": 5, "strategies": 3},
    "trading": {"videos": 7, "strategies": 5}
  },
  "by_channel": {
    "Jacob Amaral": {"videos": 3, "strategies": 2}
  },
  "last_research": {
    "topic": "futures",
    "date": "2026-03-14",
    "videos": 2,
    "strategies": 1
  }
}
```

### 8.4 Estrategias

#### Listar estrategias YAML

```
GET /api/strategies?channel=Jacob+Amaral&search=bollinger
```

Query params opcionales: `channel`, `search` (busca en nombre y descripcion).

**Respuesta** `200`:
```json
{
  "total": 1,
  "strategies": [
    {
      "name": "RTY Hybrid BB Monthly Governor Strategy",
      "description": "A multi-mode futures...",
      "source_channel": "Jacob Amaral",
      "source_videos": ["Building an RTY..."],
      "parameters": [...],
      "entry_rules": [...],
      "exit_rules": [...],
      "risk_management": [...],
      "notes": [...]
    }
  ]
}
```

#### Obtener una estrategia YAML por nombre

```
GET /api/strategies/{strategy_name}
```

**Respuesta** `200`: objeto completo de la estrategia.
**Respuesta** `404`: no encontrada.

#### Listar borradores JSON (drafts)

```
GET /api/strategies/drafts?has_todos=true
```

Query param opcional: `has_todos` (boolean, filtrar solo los que tienen campos `_TODO`).

**Respuesta** `200`:
```json
{
  "total": 1,
  "drafts": [
    {
      "strat_code": 9001,
      "strat_name": "RTY_BB_MonthlyGov_1",
      "symbol": "RTY",
      "active": false,
      "tested": false,
      "prod": false,
      "todo_count": 5,
      "todo_fields": [
        "stop_loss_init.indicator_params.multiple",
        "take_profit_init.indicator_params.multiple",
        "control_params.start_date",
        "control_params.end_date",
        "control_params.timestamp"
      ]
    }
  ]
}
```

#### Obtener un borrador JSON por strat_code

```
GET /api/strategies/drafts/{strat_code}
```

**Respuesta** `200`: el JSON completo del borrador, con un campo adicional `_todo_summary`:
```json
{
  "strat_code": 9001,
  "strat_name": "RTY_BB_MonthlyGov_1",
  "...": "...(todos los campos del JSON original)...",
  "_todo_summary": {
    "count": 5,
    "fields": [
      {"path": "stop_loss_init.indicator_params.multiple", "context": "Stop Loss - multiple de ATR"},
      {"path": "take_profit_init.indicator_params.multiple", "context": "Take Profit - multiple de ATR"},
      {"path": "control_params.start_date", "context": "Fecha de inicio del backtest"},
      {"path": "control_params.end_date", "context": "Fecha de fin del backtest"},
      {"path": "control_params.timestamp", "context": "Timestamp de creacion"}
    ]
  }
}
```

**Respuesta** `404`: borrador no encontrado.

### 8.5 Estado del research (WebSocket)

```
WS /api/research/status
```

**Protocolo**:

1. El cliente abre la conexion WebSocket.
2. El servidor envia el estado actual inmediatamente.
3. El servidor hace polling a `data/research/current.yaml` cada 2 segundos.
4. Si detecta cambios (comparando contenido o timestamp del fichero), envia el nuevo estado.
5. Si el fichero no existe, envia `{"status": "idle"}`.

**Mensaje del servidor**:
```json
{
  "status": "running",
  "topic": "futures",
  "step": 2,
  "step_name": "notebooklm-analyst",
  "step_display": "Extrayendo estrategias",
  "total_steps": 6,
  "channel": "Jacob Amaral",
  "videos_processing": ["G0c7GAg-FCY"],
  "started_at": "2026-03-14T10:30:00",
  "error_detail": null
}
```

**Autenticacion WebSocket**: la API key se pasa como query param:
```
ws://localhost:8000/api/research/status?api_key=<key>
```

### 8.6 Estadisticas globales (Dashboard)

```
GET /api/stats
```

**Respuesta** `200`:
```json
{
  "total_topics": 3,
  "total_channels": 5,
  "total_videos_researched": 12,
  "total_strategies": 8,
  "total_drafts": 3,
  "drafts_with_todos": 2,
  "last_research": {
    "topic": "futures",
    "date": "2026-03-14",
    "strategies_found": 1
  }
}
```

---

## 9. Seguridad

### Autenticacion

- **Mecanismo**: API key estatica, configurada via variable de entorno `DASHBOARD_API_KEY`.
- **Header HTTP**: `X-API-Key: <key>`.
- **WebSocket**: query param `api_key=<key>` (los WebSockets no soportan headers custom en el handshake desde el navegador).
- **Respuesta no autenticada**: `401 Unauthorized` con body `{"detail": "API key invalida o no proporcionada"}`.

### CORS

- Variable de entorno `CORS_ORIGINS`: lista separada por comas de origenes permitidos.
- Ejemplo desarrollo: `CORS_ORIGINS=http://localhost:5173`
- Ejemplo produccion: `CORS_ORIGINS=https://dashboard.tu-dominio.com`

### HTTPS

- En produccion, el backend NO gestiona TLS directamente.
- Un proxy reverso (Caddy recomendado por su auto-HTTPS con Let's Encrypt) se encarga del TLS.
- El backend escucha en `0.0.0.0:8000` sin TLS.
- El proxy redirige `https://dashboard.tu-dominio.com` -> `http://api:8000`.
- El frontend se sirve como ficheros estaticos desde el mismo proxy o un servidor Nginx.

### Fichero .env

```env
DASHBOARD_API_KEY=tu-api-key-segura-aqui
CORS_ORIGINS=http://localhost:5173
DATA_DIR=/app/data
```

Este fichero esta en `.gitignore`. Se incluye un `.env.example` en el repositorio con valores placeholder.

### Proteccion de ficheros

- El backend solo tiene acceso de lectura/escritura a la carpeta `data/`.
- No expone ficheros del sistema ni de configuracion del pipeline.
- Las rutas de ficheros en la API no aceptan path traversal (`..`).

---

## 10. Despliegue (Docker Compose)

### docker-compose.yml actualizado

```yaml
version: "3.8"

services:
  pipeline:
    build: .
    volumes:
      - ./data:/app/data
      - ./config:/app/config
      - ./tools:/app/tools
    # Servicio existente del pipeline

  api:
    build: ./api
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data    # Mismo volumen que pipeline
    env_file:
      - .env
    environment:
      - DATA_DIR=/app/data
    depends_on:
      - pipeline
    restart: unless-stopped

  frontend:
    build: ./frontend
    ports:
      - "5173:80"
    depends_on:
      - api
    restart: unless-stopped

  # Produccion: anadir servicio de proxy reverso
  # caddy:
  #   image: caddy:2
  #   ports:
  #     - "80:80"
  #     - "443:443"
  #   volumes:
  #     - ./Caddyfile:/etc/caddy/Caddyfile
  #     - caddy_data:/data
```

### Volumenes clave

El volumen `./data:/app/data` es compartido entre `pipeline` y `api`. Esto garantiza que ambos servicios leen y escriben los mismos ficheros. Es el pilar fundamental de la arquitectura.

### Dockerfile del API (`api/Dockerfile`)

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Dockerfile del Frontend (`frontend/Dockerfile`)

```dockerfile
# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### Desarrollo local

```bash
# Backend
cd api && pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend && npm install
npm run dev   # Vite dev server en puerto 5173
```

---

## 11. Fuera de alcance

Las siguientes funcionalidades NO estan incluidas en esta version y se consideran trabajo futuro:

- **Edicion de borradores JSON desde el frontend**: los campos `_TODO` se visualizan pero no se editan. La edicion se hace manualmente en los ficheros o via CLI.
- **Lanzar investigaciones desde el frontend**: el research sigue siendo exclusivo de Claude Code CLI. El dashboard solo muestra el estado.
- **Sistema de autenticacion con usuarios**: no hay registro, login con password ni roles. Solo API key unica.
- **Diseno responsive/movil**: el dashboard esta pensado para uso en escritorio. La adaptacion movil es trabajo futuro.
- **Notificaciones push**: cuando una investigacion termina, no se envia notificacion al navegador. El usuario debe estar en la pagina Live.
- **Gestion de topics** (crear/eliminar topics): solo se gestionan canales dentro de topics existentes. La creacion de topics se hace editando `channels.yaml`.
- **Historial de cambios/audit log**: no se registra quien hizo que cambio en los canales.
- **Exportacion de datos**: no hay boton de exportar a CSV/Excel.
- **Tests E2E del frontend**: los tests unitarios son recomendados pero no obligatorios en la primera iteracion.

---

## 12. Dependencias con el pipeline existente

### Cambio requerido: fichero de estado del research

El agente de investigacion (`.claude/agents/research/AGENT.md`) necesita ser modificado para escribir el fichero `data/research/current.yaml` en cada paso del pipeline. Actualmente el agente no escribe este fichero.

#### Que hay que anadir al AGENT.md

Despues de cada paso del pipeline (Steps 0-6), el agente debe escribir/actualizar `data/research/current.yaml` con el estado actual. Al finalizar (exito o error), debe escribir el estado final (`completed` o `error`). Si no hay research en curso, el fichero debe contener `status: idle`.

**Estructura del fichero `data/research/current.yaml`**:

```yaml
status: idle | running | completed | error
topic: "<topic>"
step: <numero 0-6>
step_name: "<nombre del paso>"
total_steps: 6
channel: "<canal siendo procesado o null>"
videos_processing: ["<video_ids>"]
started_at: "<ISO 8601>"
completed_at: "<ISO 8601 o null>"
error_detail: "<mensaje de error o null>"
result_summary:
  videos_analyzed: <int>
  strategies_found: <int>
  new_saved: [<list>]
  duplicates_skipped: [<list>]
```

#### Instrucciones de escritura por paso

Anadir al AGENT.md, al inicio del pipeline (antes del Step 0):

```
Antes de empezar cualquier paso, escribir el estado inicial:
  status: running, step: 0, step_name: preflight, started_at: <ahora>

Al empezar cada paso, actualizar:
  step: <numero>, step_name: <nombre>, channel: <canal si aplica>, videos_processing: <ids si aplica>

Al completar el pipeline, escribir:
  status: completed, completed_at: <ahora>, result_summary: <resumen>

Si ocurre un error, escribir:
  status: error, error_detail: <detalle>, step donde fallo

Despues de que el orchestrator procese el resultado, escribir:
  status: idle (limpiar todos los campos excepto status)
```

#### Fichero nuevo: `data/research/current.yaml`

Crear el fichero con estado inicial:

```yaml
status: idle
```

Este fichero debe anadirse al repositorio con el estado `idle` para que el backend siempre tenga algo que leer.

### Sin otros cambios al pipeline

El resto del pipeline no necesita modificaciones. Los ficheros `channels.yaml`, `strategies.yaml`, `history.yaml` y `drafts/*.json` ya existen y tienen la estructura que el dashboard necesita. El backend simplemente los lee (y en el caso de canales, tambien los escribe).
