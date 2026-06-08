# Riesgos técnicos — Módulo Agenda

Cada riesgo con impacto, probabilidad y mitigación. Los marcados 🔴 son los que conviene atacar/decidir temprano.

---

## 🔴 R1 — Volumen de mensajes de WhatsApp (quemar el canal)

**Impacto**: alto. **Prob**: alta si no se controla.

Con 5 eventos activos en una semana × 4 mensajes por persona = **20 mensajes/semana** por secretario, **además** de los 3–4 del flujo de reporte. Un secretario podría recibir 25+ mensajes semanales. Eso satura, genera bloqueos y quejas, y Meta puede penalizar el número por baja calidad.

**Mitigaciones**:
- Tope de 4 por persona por evento, ya en el modelo (`event_notifications` + `reminder_config`).
- **Preferencias por secretario** (`agenda_notification_prefs`, refinamiento 2026-06-07): cada uno silencia los recordatorios que no quiere. Reduce el ruido sin decisión central. **Excepción**: eventos `is_important` (los marca Mesa Ejecutiva / Prensa) **no se pueden silenciar** — garantizan que lo crítico llegue aunque el secretario tenga todo en mute. Es el equilibrio entre "no quemar el canal" y "lo importante llega sí o sí".
- **Tope global diario por persona** (nuevo `system_settings.agenda_max_daily_per_user`, ej. 3): el dispatch saltea/posterga si la persona ya recibió N agenda-msgs hoy. Los `is_important` quedan exentos de este tope. Documentar y agregar en A6.
- Defaults conservadores: `personal` sin recordatorios de convocatoria; `secretariat` con 24h + 2h; `mobilization` con 24h + 12h + 2h. El 7d solo si lo activa el creador.
- A futuro: **digest** (un solo mensaje "tenés 3 eventos esta semana") en vez de N mensajes sueltos. Fuera del MVP, pero el modelo lo permite (agrupar por usuario en el dispatch).
- Monitorear `outbound_messages` por usuario/semana en los logs.

---

## 🔴 R2 — Ventana de 24h de Meta y aprobación de templates

**Impacto**: alto. **Prob**: media.

Meta solo permite texto libre dentro de 24h desde el último mensaje del usuario. Toda convocatoria/recordatorio es **proactiva** → requiere **template aprobado**. Si Meta no aprobó el template (o lo rechaza), el recordatorio no sale (salvo que la persona haya escrito hace <24h).

**Mitigaciones**:
- Arrancar el trámite de templates en A1/A2 (latencia de días).
- Dos templates por mensaje: con botones y fallback de texto (ya en decisión 1). El dispatcher `whatsapp.ts` ya cae a texto si no hay template configurado.
- Para el disparo del viernes enriquecido (A9): si la ventana de 24h está abierta (el usuario interactuó), mandar texto libre con la lista de eventos; si no, va en el template `atepsa_weekly_kickoff` con variable de eventos.
- El parseo de la respuesta a un botón abre la ventana de 24h: aprovechar para mandar el ack y cualquier pregunta de edición como texto libre.

---

## 🔴 R3 — Motor de notificaciones: precisión, idempotencia, doble envío

**Impacto**: alto. **Prob**: media.

El cron horario podría: enviar dos veces si corre solapado; no acertar la ventana de 2h; enviar a alguien que ya confirmó o se fue de licencia entre el cómputo y el envío.

**Mitigaciones**:
- Estado en `event_notifications` con `UNIQUE(event_id, user_id, kind)` → cada notificación se envía una sola vez (transición `pending→sent`). Marcar `sent` **antes** o en la misma transacción que el envío, con manejo de fallo (`failed`, reintenta próximo tick).
- Re-validación en el momento del envío (on_leave / cancelado / ya respondió), no en el cómputo.
- Tolerancia ±1h por el cron horario: documentado y aceptado. Si molesta para el 2h, bajar a `*/30`.
- Probar con reloj simulado en A6 (inyectar `now`).
- Lock simple: el endpoint dispatch procesa en lotes y es idempotente; si n8n lo dispara dos veces, el `UNIQUE` y el estado `sent` evitan duplicados.

---

## R4 — Concurrencia: eventos solapados / creación simultánea

**Impacto**: medio. **Prob**: baja.

Dos miembros de Mesa Ejecutiva crean el mismo evento (o uno solapado) casi al mismo tiempo. No hay constraint que lo impida.

**Mitigaciones**:
- **Detección soft, no bloqueo**: al crear/confirmar un evento `secretariat`/`mobilization`, el endpoint busca eventos del mismo tipo con solapamiento de horario y devuelve un warning ("Hay otro evento en ese rango: X. ¿Continuar?"). El panel lo muestra; no se aborta.
- No hay constraint de unicidad de eventos (un mismo horario puede tener varias cosas legítimas).
- `audit_log` registra creador y timestamp para resolver confusiones a mano.

---

## R5 — Cancelaciones y reprogramaciones

**Impacto**: medio. **Prob**: media.

Al cancelar/reprogramar hay que: cancelar notificaciones pendientes, avisar a quienes ya fueron convocados, y no pasarse del tope (pero el aviso de cancelación es crítico).

**Mitigaciones**:
- `cancellation` está **exenta del tope de 4** (es servicio, no spam).
- Cancelar: `event.status='cancelled'`, `event_notifications` pendientes → `skipped(skip_reason='event_cancelled')`, y se crea una notificación `cancellation` a quienes tengan al menos una notificación `sent` (no avisamos a quien nunca supo del evento).
- Reprogramar (cambio de `starts_at`): equivale a regenerar las notificaciones futuras con los nuevos tiempos + una `cancellation`/aviso de cambio. Las ya enviadas quedan; las pendientes se recalculan.
- Todo auditado (before/after en `audit_log`).

---

## R6 — Evento tardío vs ciclo cerrado (integración reporte)

**Impacto**: medio. **Prob**: media.

Evento el viernes a la noche → followup el sábado 10:00, cuando el ciclo ya está `closed`/`processed`. El ítem del outcome no tendría dónde caer limpio.

**Mitigaciones**:
- El outcome se adjunta al `report` del ciclo del evento **igual**, aunque esté cerrado (como adenda con `source_message_id`).
- Si el ciclo ya fue `processed`, el ítem queda marcado y entra en un eventual re-procesamiento manual (`cycle-reprocess` ya existe), o se documenta como "llegado tarde, no consolidado".
- Alternativa configurable: empujar el followup de eventos de viernes/sábado al ciclo siguiente. Decidir en A9; por defecto, adjuntar al ciclo del evento.

---

## R7 — Performance del feed iCal

**Impacto**: bajo-medio. **Prob**: baja.

27 usuarios × 3 feeds = hasta 81 URLs. Google/Apple/Outlook refrescan cada pocas horas (no es tráfico alto), pero cada hit arma una query + serialización.

**Mitigaciones**:
- Query liviana (índice en `ical_tokens.token`, eventos por scope/fecha).
- `ETag` por hash del contenido + `Cache-Control: private, max-age=900` → respuestas `304` baratas.
- Limitar el feed a una ventana razonable (ej. eventos de -1 mes a +6 meses), no todo el historial.
- Es read-only y sin estado: escala trivial para este tamaño.

---

## R8 — Fuga del token iCal

**Impacto**: medio (privacidad). **Prob**: baja.

El feed no tiene auth de sesión: quien tenga la URL ve los eventos de ese scope.

**Mitigaciones**:
- Token largo aleatorio (43 chars base64url), no adivinable.
- Revocable al instante (regenerar). UI clara sobre el riesgo en `/mi-calendario`.
- El feed expone solo título/fecha/lugar; nada de PII sensible ni detalle de conflictos internos. Para eventos `mobilization` sensibles, evaluar excluirlos del feed o resumir el título (configurable).
- `last_accessed_at` permite detectar uso anómalo.

---

## R9 — Zona horaria (ART vs UTC)

**Impacto**: medio. **Prob**: media.

El sistema guarda `timestamptz` pero el código de fechas mezcla cálculos UTC "good enough" (ver `messages/absence/route.ts`). Un evento "martes 10:00" mal convertido sale 3h corrido.

**Mitigaciones**:
- `parse-event` devuelve siempre offset `-03:00`; la app guarda UTC correcto.
- Mostrar siempre con `timeZone: 'America/Argentina/Buenos_Aires'` (patrón del dashboard).
- En `lib/dates.ts`, ser explícito con ART en los cálculos de "día siguiente 10:00" del followup y en `cycleKeyForDate`. No copiar el atajo UTC de absence.
- Argentina no tiene DST hoy, pero no hardcodear `-3` en lógica nueva: usar la TZ nombrada.

---

## R10 — Solapamiento clasificación reporte vs evento

**Impacto**: bajo-medio. **Prob**: media.

"El martes tuve reunión con EANA" (reporte, pasado) vs "el martes tengo reunión con EANA" (evento, futuro). El clasificador puede confundirlos.

**Mitigaciones**:
- `classify-intent` instruido en tiempo verbal/temporalidad (ver prompts.md).
- Estado conversacional manda: si hay un evento en `pending_confirmation`, el próximo mensaje es edición.
- Ante baja `confidence`, el bot repregunta en vez de adivinar ("¿Querés que lo agende o es algo que ya pasó para tu reporte?").
- Falla recuperable: si clasifica mal, el usuario corrige y no se pierde nada (el mensaje queda en `inbound_messages`).

---

## R11 — Dependencia nueva: `react-big-calendar`

**Impacto**: bajo. **Prob**: baja.

Primera lib de UI compleja del proyecto (la regla del CLAUDE.md pide discutir cada dependencia). Suma peso y CSS a sobrescribir; mantenimiento futuro.

**Mitigaciones**:
- Decisión ya tomada (opción B, aprobada por Julián).
- Usar `date-fns` como localizer (más liviano que moment).
- Aislar la lib en el componente de calendario; el resto del módulo no depende de ella, así que es reemplazable.
- Si el estilado se vuelve un pozo, hay fallback a la vista lista (CSS puro) para mobile.

---

## Resumen de decisiones que estos riesgos imponen al diseño

1. Tope de 4 por evento, tope global diario por persona, **y** preferencias por secretario con override de eventos `is_important` no silenciables (R1).
2. Dos templates por mensaje + fallback de texto (R2).
3. `event_notifications` con `UNIQUE(event_id,user_id,kind)` y re-validación en envío (R3).
4. Cancelación exenta del tope, avisa solo a quien ya supo (R5).
5. Outcome se adjunta al ciclo del evento aunque esté cerrado (R6).
6. ETag + cache + ventana acotada en el feed iCal (R7).
7. Token largo, revocable, sin PII sensible (R8).
8. TZ nombrada ART en toda lógica de fecha nueva (R9).
