# Schemas de datos

## channels.yaml

Ubicacion: `data/channels/channels.yaml`

Canales de YouTube organizados por topic. Cada topic agrupa canales relacionados.

```yaml
topics:
  <topic-id>:
    description: Descripcion del tema
    channels:
      - name: Nombre del canal
        url: https://www.youtube.com/@handle
        last_fetched: null  # se actualiza automaticamente al buscar
```

### Topics actuales

| Topic | Descripcion | Canales |
|-------|-------------|---------|
| `ai-agents` | AI agent frameworks and autonomous systems | AI Jason, Matt Williams |
| `trading` | Algorithmic and quantitative trading | QuantProgram |
| `futures` | Futures strategies | Jacob Amaral |

## strategies.yaml

Ubicacion: `data/strategies/strategies.yaml`

Estrategias de trading extraidas de videos, con reglas y parametros configurables.

```yaml
strategies:
  - name: Nombre de la estrategia
    description: Descripcion general
    source_channel: Canal de origen
    source_videos:
      - "Titulo del video 1"
    parameters:
      - name: nombre_param
        description: Que controla
        type: int|float|string|bool
        default: valor por defecto
        range: rango permitido
    entry_rules:
      - "Regla de entrada (referencia parametros por nombre)"
    exit_rules:
      - "Regla de salida"
    risk_management:
      - "Regla de gestion de riesgo"
    notes:
      - "Observaciones relevantes"
```

### Estrategias actuales

| Estrategia | Instrumento | Canal | Parametros |
|------------|-------------|-------|------------|
| RTY Hybrid BB Monthly Governor | RTY (Russell 2000 futures) | Jacob Amaral | 9 params: ticker, timeframe, BB period/std, targets long/short, stop mensual, contratos, ciclo optimizacion |
