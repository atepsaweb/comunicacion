# Plan de implementación — Módulo Agenda

Nueve fases. Cada una autocontenida, con objetivo, deliverables, criterio de aceptación y dependencias. Pensado para sesiones con Sonnet.

> **Estado**: **Fase A1 completada y deployada el 2026-06-07** (commit 30b2572). Schema, enums, migración 0004 (aplicada a la DB de producción), `lib/dates.ts` y seed de settings. Próxima: **A2** (botones interactivos de WhatsApp + templates Meta).

**Regla de oro de cada fase**: cierra con `pnpm typecheck` y `pnpm lint` en verde. Cada PR que toque schema actualiza `docs/modulo-agenda/modelo-de-datos.md`; cada PR que toque workflows exporta el JSON y actualiza `workflows-n8n.md`.

---

## Orden y dependencias (resumen visual)

```
A1 (schema + helpers)
 ├─> A2 (botones Meta)  ──┐
 ├─> A4 (panel CRUD)      │
 │     └─> A5 (asistencia)┤
 ├─> A3 (alta x WhatsApp)─┤  (A3 necesita A2)
 │     └─> A7 (propuestas)┤
 ├─> A6 (motor notif.)  ──┤  (A6 necesita A2)
 ├─> A8 (iCal)            │  (solo necesita A1)
 └─> A9 (integración reporte) (necesita A1, A3, A6)
```

Paralelizable: A4 (UI) y A8 (iCal) pueden ir en paralelo a A2/A3 desde que A1 esté. A5 depende de A4. A9 es la última (toca código existente).

**Riesgo alto → atacar temprano**: A2 (botones interactivos + aprobación de templates Meta, que tiene latencia externa) y A6 (motor de notificaciones, la lógica más sensible). Empezar el trámite de templates Meta apenas arranca A1.

---

## Fase A1 — Schema, enums, helpers de fecha

**Objetivo**: la base de datos y los helpers compartidos listos.

**Deliverables**:
- `db/schema/events.ts`, `event-attendees.ts`, `event-notifications.ts`, `ical-tokens.ts` (o agrupar en `agenda.ts`), re-exportados desde `index.ts`.
- Enums nuevos en `enums.ts` + `ALTER TYPE ADD VALUE` para los 3 existentes.
- Migración generada (`pnpm db:generate`) y revisada (ojo con `ADD VALUE` fuera de transacción).
- `lib/dates.ts`: extraer `cycleKeyForDate()` / `getISOWeekAndYear()` / `isoWeekToMondayUTC()` de `cycles/ensure-next` (refactor: ese endpoint pasa a importarlo). Agregar `isUserOnLeave(userId, dateISO)`.
- Keys nuevas en `system_settings` sembradas (`agenda_reminder_defaults`, `agenda_max_notifications_per_event`).

**Criterio**: `pnpm db:migrate` corre limpio en una DB de prueba; los tipos Drizzle (`Event`, `EventAttendee`, etc.) compilan.

**Dependencias**: ninguna. **Estimación**: 1 sesión.

---

## Fase A2 — Botones interactivos de WhatsApp + templates Meta

**Objetivo**: el sistema puede mandar y recibir botones.

**Deliverables**:
- `sendMetaInteractive(phone, body, buttons[])` en `meta-cloud.ts` + wrapper en `whatsapp.ts`.
- Parseo de `messages[0].type === 'interactive'` en el webhook/endpoint `inbound` → genera `inbound_message` y rutea a `button-reply`.
- Convención de `button_reply.id`: `<accion>:<entityId>`.
- Templates Meta a crear/aprobar (trámite externo, arrancar ya): `agenda_invitation`, `agenda_reminder`, `agenda_followup`, `agenda_proposal_approval` (cada uno con su variante de botones y su fallback de texto, registrados en `whatsapp_meta_templates`).

**Criterio**: mandás un mensaje con 3 botones a un número de prueba, tocás uno, el webhook recibe el `button_reply.id` correcto y el sistema lo loguea.

**Dependencias**: A1. **Riesgo**: aprobación de templates por Meta tiene latencia (días). Fallback de texto mitiga. **Estimación**: 1–2 sesiones (+ espera Meta).

---

## Fase A3 — Alta de eventos por WhatsApp

**Objetivo**: cargar un evento hablándole al bot, con confirmación.

**Deliverables**:
- Prompt `parse-event` (`lib/ai/prompts/parse-event.ts`) + seed.
- `classify-intent` ampliado (`event_create`, `event_confirmation_reply`).
- Endpoints `parse-event`, `confirm-creation`, `button-reply` (rama de confirmación).
- Ramas nuevas en `inbound-message-handle` (exportar JSON).
- Estado conversacional: `pending_confirmation` y su resolución (sí/no/editar).

**Criterio**: mandás "agendá reunión con EANA el martes que viene a las 10", el bot repregunta con los datos y botones, confirmás, el evento queda `confirmed` (o `proposed` si sos secretary común).

**Dependencias**: A1, A2. **Estimación**: 2 sesiones.

---

## Fase A4 — Panel: calendario + alta + detalle

**Objetivo**: ver y crear eventos desde el panel.

**Deliverables**:
- Instalar `react-big-calendar` + `date-fns`.
- `/agenda` (calendario, switcher de vistas), `/agenda/nuevo` (form), `/agenda/[id]` (detalle).
- Endpoints `GET/POST /api/agenda/events`, `PATCH`, `cancel`.
- Ítems de sidebar.

**Criterio**: creás un evento desde el panel, aparece en el calendario, lo abrís, lo editás y lo cancelás.

**Dependencias**: A1 (puede ir en paralelo a A2/A3). **Estimación**: 2–3 sesiones (estilado del calendario).

---

## Fase A5 — Confirmación de asistencia + tablero

**Objetivo**: convocar y ver quién va.

**Deliverables**:
- Generación de `event_attendees` al confirmar evento `secretariat`/`mobilization` (excluye `on_leave`).
- `button-reply` rama asistencia + `POST .../attendance` (panel).
- Tablero en `/agenda/[id]` + `GET .../attendees` + export `board.xlsx`.

**Criterio**: confirmás una movilización, los 27 reciben convocatoria con botones, tocan, el tablero muestra el estado en tiempo real y los de licencia figuran "en licencia".

**Dependencias**: A2, A4. **Estimación**: 2 sesiones.

---

## Fase A6 — Motor de notificaciones (recordatorios + followup)

**Objetivo**: recordatorios escalonados automáticos con tope de 4.

**Deliverables**:
- Generación de filas `event_notifications` al confirmar evento (según `reminder_config`, tope 4).
- Endpoint `notifications/dispatch` con re-validación y reglas de audiencia por `kind`.
- **Preferencias por secretario** (R1): tabla `agenda_notification_prefs`, endpoints GET/PUT, evaluación en el dispatch con override de `is_important`. Tope global diario por persona (`agenda_max_daily_per_user`, exento para `is_important`).
- Endpoint `events/mark-done`.
- Workflows `agenda-notifications-dispatch` (horario) y `agenda-event-done-check` (diario).

**Criterio**: creás un evento para mañana con recordatorios 24h/12h/2h; el cron los va mandando en sus ventanas, respeta el tope, saltea a los de licencia y a los que ya confirmaron donde corresponde.

**Dependencias**: A2 (templates de recordatorio), A5 (attendees). **Riesgo alto**: lógica sensible, probar con relojes simulados. **Estimación**: 2 sesiones.

---

## Fase A7 — Propuestas + aprobación

**Objetivo**: secretarios comunes proponen, Mesa Ejecutiva aprueba.

**Deliverables**:
- Flujo `proposed`: creación por secretary común → bandeja.
- `/agenda/propuestas` + `approve`/`reject` (panel).
- Aprobación por WhatsApp: template `agenda_proposal_approval` con botones → `button-reply` rama propuesta. Al crear una propuesta, se avisa a exec/press_admin por WhatsApp.

**Criterio**: un secretary propone una movilización; la Mesa Ejecutiva la ve en la bandeja y por WhatsApp; aprueba con un botón; el evento pasa a `confirmed` y dispara la convocatoria.

**Dependencias**: A3, A5. **Estimación**: 1–2 sesiones.

---

## Fase A8 — Feeds iCal + gestión de tokens

**Objetivo**: suscribir el calendario personal a Google/Apple/Outlook.

**Deliverables**:
- Serializador `.ics` (`lib/ical.ts`) — VCALENDAR/VEVENT, o `ical-generator` si se aprueba la dependencia.
- `GET /api/ical/[token].ics` (público, ETag, cache 15min).
- `/mi-calendario` + endpoints de tokens (list/regenerate/revoke).

**Criterio**: generás tu token "Secretariado", lo pegás en Google Calendar, aparecen los eventos; regenerás y el link viejo deja de funcionar.

**Dependencias**: A1 (independiente del resto). **Estimación**: 1–2 sesiones.

---

## Fase A9 — Integración con el reporte semanal

**Objetivo**: cerrar el loop con los reportes. **La fase más delicada: toca código en producción.**

**Deliverables**:
- `events/:id/outcome`: el followup "¿cómo salió?" alimenta `report_items` del ciclo del evento (reusa `extract-report`).
- `weekly-trigger-send` enriquecido: lista de eventos de la semana por usuario.
- `GET .../user-week-events`.
- Manejo del caso borde (evento viernes noche → followup con ciclo cerrado).

**Criterio**: tras una movilización, el bot pregunta cómo salió; respondés; el texto aparece como ítem en tu reporte de esa semana. El jueves, el disparo te lista lo que tenías agendado.

**Dependencias**: A1, A3, A6. **Estimación**: 2 sesiones.

---

## Estimación total

| Fase | Sesiones |
|---|---|
| A1 | 1 |
| A2 | 1–2 (+ Meta) |
| A3 | 2 |
| A4 | 2–3 |
| A5 | 2 |
| A6 | 2 |
| A7 | 1–2 |
| A8 | 1–2 |
| A9 | 2 |

**Total**: ~14–18 sesiones. MVP usable (A1–A6, sin propuestas/iCal/integración reporte): ~10–12 sesiones.

---

## Convenciones de PR (heredadas del proyecto)

- 1 PR por fase (A4 y A6 pueden partirse).
- Cada PR: typecheck + lint en verde.
- Actualiza los docs del módulo que toque.
- Exporta workflows de n8n modificados a `n8n/workflows/`.
- Migraciones revisadas a mano antes de correr en el VPS (`ADD VALUE`, CASCADE).
