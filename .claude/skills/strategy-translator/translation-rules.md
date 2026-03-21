# Translation Rules

Reglas de mapeo aprendidas para traducir estrategias de lenguaje natural a JSON del motor de trading.
Estas reglas se acumulan con el feedback del usuario.

**Fuente de verdad**: `docs/STRATEGY_FILE_REFERENCE.md` — especificacion completa del motor IBKR. Leer SIEMPRE antes de generar drafts.

## Reglas de filtrado (skip)

- **Ideas sin logica concreta de entrada/salida** → skip (log como "too vague for translation")
  No se puede generar JSON si no hay condiciones claras de cuando entrar o salir.

- **Enfoques historicos o abandonados** → skip
  Si el video menciona que ya no usa esa estrategia o que era de hace anos, no traducir.

- **Meta-estrategias** → skip
  Gestion de portfolio, scaling de prop firms, psicologia de trading, money management generico.
  Solo traducir estrategias con reglas de entrada/salida accionables.

## Reglas de traduccion

- **Ante la duda sobre un valor de parametro** → usar `"_TODO"`, nunca inventar.
  Es mejor un draft incompleto que uno con valores inventados.

- **Preferir 2-4 variantes sobre 1 estrategia perfecta.**
  Explorar combinaciones de timeframe, metodo de salida y filtros.

- **Cada variante debe tener un `strat_name` descriptivo** que incluya la variacion.
  Formato sugerido: `"<Indicador>_<Logica>_<Exit>_<Timeframe>"`.
  Ejemplos: `"RSI_Divergence_SAR_360m"`, `"RSI_Divergence_TimeExit_240m"`, `"VWAP_Bounce_ATR_Daily"`.

## Reglas de mapeo (feedback del usuario)

- **El campo `cond` debe ser inequivoco cuando se compara el mismo indicador a diferentes shifts.**
  **Origen**: El translator genero `"LOW_6H < LOW_6H"` con shift_1=0, shift_2=1. Parece que compara algo consigo mismo.
  **Ejemplo**: `"LOW_6H < LOW_6H"` → `"LOW_6H(0) < LOW_6H(1)"`

- **NO usar `group` en `long_conds` ni `short_conds`.**
  **Origen**: El translator puso `"group": 1` en las tres entry conditions de una divergencia RSI. Las entry conditions son SIEMPRE ALL AND, los groups solo aplican a `exit_conds`.
  **Ejemplo**: `{"cond_type": "price_relation", "cond": "...", "group": 1}` → quitar `"group"`

- **Shift values deben ser >= 1, nunca 0.**
  **Origen**: Shift 0 no existe en el motor — la barra actual aun no se ha formado. El minimo es shift 1 (ultima barra completada).
  **Ejemplo**: `"shift_1": 0` → `"shift_1": 1`

- **Indicadores multi-output deben usar indCode con prefijo `MULT_`.**
  **Origen**: Documentacion del motor (`docs/STRATEGY_FILE_REFERENCE.md`).
  **Ejemplo**: BBANDS con `"indCode": "BB_20_2_1D"` → `"indCode": "MULT_1D"` (genera BBAND_upperband_1D, etc.)
