# Prompts de Claude — Módulo Agenda

Sigue `docs/prompts-strategy.md`:
- Modelo más barato que sirva. Haiku salvo que la calidad para ojo humano lo justifique.
- Prompt caching en system + few-shot.
- Salida JSON donde la procesa código; texto natural solo para lo que lee un humano.
- Prompt inicial en `apps/web/src/lib/ai/prompts/<slug>.ts`, sembrado en tabla `prompts`, editable desde el panel. Runtime lee el activo de DB vía `getActivePrompt(slug)`.

---

## Mapa de prompts del módulo

| Slug | Modelo | Nuevo/Reuso | Razón |
|---|---|---|---|
| `parse-event` | **Haiku** | NUEVO | Extracción estructurada de fecha/hora/lugar/tipo. Tarea acotada, schema claro. Como `extract-report`. |
| `classify-intent` | Haiku | MODIFICADO | Agregar 2 categorías (`event_create`, `event_confirmation_reply`). |
| `extract-report` | Haiku | REUSO | El followup "¿cómo salió?" se procesa con el pipeline existente. |

**No** hay prompts nuevos para invitaciones ni recordatorios: esos mensajes son **templates de Meta** pre-aprobados (envío proactivo obligado). La IA solo interpreta el evento al cargarlo y reparsea en ediciones.

El mensaje de confirmación ("Entendí: reunión con EANA el martes 15…") se **arma en código** desde el JSON de `parse-event`, no con otra llamada a Claude: es determinístico, gratis y más confiable que pedirle a la IA que reformatee lo que ya parseó.

---

## `parse-event` (NUEVO, Haiku)

**Input**:
- Texto del mensaje (transcripción si era audio).
- Fecha/hora actual en ART (para resolver "el martes", "mañana", "en dos semanas").
- Si es una edición: el evento parseado previo (para fusionar).

**Output** JSON:
```json
{
  "title": "Reunión con EANA por recategorización",
  "type": "secretariat",
  "starts_at": "2026-07-15T10:00:00-03:00",
  "ends_at": null,
  "all_day": false,
  "location": "Sede central EANA",
  "participants_text": "secretario general y adjunto",
  "requires_confirmation": true,
  "confidence": 0.82,
  "missing_fields": ["ends_at"],
  "clarification_needed": false,
  "clarification_question": null
}
```

**Reglas del system prompt**:
- ATEPSA = sindicato de navegación aérea de Argentina. Vocabulario: EANA, ANAC, paritaria, movilización, plenario, asamblea, secretariado (ver glosario).
- Inferir `type`:
  - menciona "movilización", "paro", "concentración", "medida de fuerza" → `mobilization`.
  - menciona reunión/actividad del Secretariado, gestión institucional → `secretariat`.
  - algo personal del que habla, sin convocar a otros ("tengo dentista", "reunión con mi dependencia") → `personal`.
  - ante la duda, `personal` (el más restrictivo en visibilidad). El creador puede cambiarlo en la confirmación.
- `requires_confirmation`: siempre `true` si `type === 'mobilization'`. En `secretariat`, `true` solo si el texto sugiere que se espera asistencia.
- Fechas relativas: resolver contra la fecha actual provista. Año actual si no se especifica. Si una fecha es ambigua o falta lo esencial (no hay fecha) → `clarification_needed: true` + `clarification_question` (una pregunta corta).
- Zona horaria: siempre devolver `starts_at`/`ends_at` con offset `-03:00` (ART). La app convierte a UTC al guardar.
- No inventar lugar ni participantes: si no se dijeron, `null`.

**Few-shot**: 3 ejemplos — uno completo (movilización con fecha y hora), uno con fecha relativa ("el jueves que viene a las 3"), uno ambiguo (sin fecha → clarification).

**maxTokens**: 512 (output chico).

---

## `classify-intent` (MODIFICADO, Haiku)

Agregar al enum de salida:
- `event_create`: el mensaje describe algo a agendar ("anotá que el martes tenemos reunión", "agendá la movilización del 20").
- `event_confirmation_reply`: respuesta a una confirmación de evento pendiente ("sí dale", "no, cambiá la hora a las 4", "está bien").

> El sistema **prioriza el estado conversacional sobre la clasificación**: si el usuario tiene un `event` en `pending_confirmation`, su próximo mensaje libre se rutea como `event_confirmation_reply` sin depender 100% del clasificador (igual que `report_followup_reply` con `awaiting_followup`). El clasificador es ayuda, no autoridad única.

Cuidar el solapamiento con `report`: "el martes tuve una reunión con EANA" (pasado, reporte) vs "el martes tengo reunión con EANA" (futuro, evento). El system prompt debe distinguir **tiempo verbal y temporalidad**: pasado/esta semana → `report`; futuro/agendar → `event_create`.

---

## `extract-report` (REUSO, Haiku) — integración del followup

Cuando llega la respuesta a "¿cómo salió el evento X?":
1. La app guarda el texto en `events.outcome_md`.
2. Llama a `extract-report` con el texto del outcome + contexto del evento (título, fecha, tipo), apuntando al `report` del **ciclo del evento** (no necesariamente el ciclo abierto).
3. El ítem resultante se inserta en `report_items` con `source_message_id` del mensaje del outcome, y su id se guarda en `events.outcome_report_item_id`.
4. Categoría sugerida: si `type==='mobilization'` → `accion_gremial`; si `secretariat` → la que infiera la IA.

> Caso borde: evento el viernes a la noche → followup el sábado, con el ciclo ya cerrado (`closed`/`processed`). El ítem se adjunta igual al report de ese ciclo (queda como adenda), y si el ciclo ya se procesó, se marca para que el próximo re-procesamiento lo tome, o se documenta como "llegó tarde". Ver riesgos.md.

---

## Estimación de costo incremental

| Tarea | Llamadas/sem (estimado) | Modelo | Costo |
|---|---|---|---|
| parse-event | ~10 (creación + ediciones) | Haiku | despreciable (~USD 0.01) |
| classify-intent | ya contabilizado | Haiku | sin cambio |
| extract-report (outcomes) | ~5 | Haiku | despreciable |

El módulo agrega **menos de USD 0.10/mes** en Claude. Sin riesgo de presupuesto. El costo real del módulo es el volumen de **mensajes de WhatsApp**, no de IA (ver riesgos.md).

---

## Seed

Agregar `parse-event` al seed de prompts (`scripts/seed-prompts.ts`), con `model_hint='claude-haiku-4-5-20251001'`, `is_active=true`, `version=1`. Igual que los 8 slugs actuales.
