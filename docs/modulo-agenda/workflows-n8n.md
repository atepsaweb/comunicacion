# Workflows de n8n — Módulo Agenda

Sigue las convenciones de `docs/workflows.md`:
- Naming `<dominio>-<accion>` kebab-case.
- Cada workflow arranca con nodo `Set` "context" (`baseUrl`, `internalApiKey`).
- URLs internas con hostname Docker (`http://web:3000/api/internal/...`).
- Auth: header `Authorization: Bearer {{$env.INTERNAL_API_SECRET}}`.
- Nada de lógica de negocio en nodos `Code` (>5 líneas → endpoint).
- Exportar a `n8n/workflows/<slug>.json` y commitear.

---

## Inventario (nuevos + modificados)

| Slug | Tipo | Frecuencia | Estado |
|---|---|---|---|
| `agenda-notifications-dispatch` | Cron | **Horario** (`0 * * * *`) | NUEVO |
| `agenda-event-done-check` | Cron | Diario (`30 0 * * *` = 00:30 ART) | NUEVO |
| `inbound-message-handle` | Webhook | On-demand | **MODIFICADO** (ramas nuevas) |
| `weekly-trigger-send` | Cron | Jueves 10:00 | **MODIFICADO** (lista de eventos) |

> **Actualizado 2026-06-09**: el dispatch corre cada **5 minutos** (`*/5 * * * *`). El recordatorio `reminder_0h` ("comienza ahora", default de eventos online) necesita precisión de minutos; con cron horario llegaba hasta 59 min tarde. El endpoint es liviano: sin pendientes es una sola query.

---

## 1. `agenda-notifications-dispatch` (NUEVO)

**Trigger**: Cron `*/5 * * * *` (cada 5 minutos).

**Pasos**:
1. `Set` context.
2. `POST /api/internal/agenda/notifications/dispatch`.
   - La app hace todo el trabajo pesado en un solo endpoint (idempotente):
     - Selecciona `event_notifications` con `status='pending' AND scheduled_for <= now()`.
     - Por cada una: re-valida (on_leave / cancelado / ya confirmó), arma el template correcto, envía vía dispatcher `whatsapp.ts`, registra en `outbound_messages`, marca `sent`/`skipped`/`failed`.
     - Aplica el tope de 4 por persona/evento como red de seguridad.
   - Devuelve `{ sent, skipped, failed }`.
3. Si `failed > 0`, alerta a Julián con el detalle.

**Por qué un endpoint y no nodos n8n**: el despacho tiene re-validación y reglas de audiencia por `kind` (ver modelo-de-datos). Eso es lógica de negocio → vive en la app, no en n8n. n8n solo dispara el tick.

**Error handling**: reintento 2x con backoff. Si el endpoint cae, las notificaciones quedan `pending` y salen en el próximo tick (no se pierden).

---

## 2. `agenda-event-done-check` (NUEVO)

**Trigger**: Cron `30 0 * * *` (00:30 ART, todos los días).

**Pasos**:
1. `Set` context.
2. `POST /api/internal/agenda/events/mark-done`.
   - Marca `status='done'` los eventos `confirmed` cuyo `ends_at` (o `starts_at` si no hay `ends_at`) ya pasó.
   - Para cada evento que pase a `done` y tenga `reminder_config.followup === true`, **asegura** que exista la fila `event_notifications(kind='followup')` para el creador, con `scheduled_for` = día siguiente 10:00 ART (si no se creó al confirmar).
   - Devuelve `{ marked_done, followups_scheduled }`.

> Se separa del dispatch para mantener responsabilidades claras: este define qué terminó; el otro envía lo pendiente. El followup en sí lo manda `agenda-notifications-dispatch`.

---

## 3. `inbound-message-handle` (MODIFICADO)

Se agregan dos cosas al workflow existente.

### 3.a — Parseo de botones interactivos (antes de la clasificación de intent)

Hoy el webhook maneja `text`/`audio`/`document`. Meta manda las respuestas de botón como `messages[0].type === 'interactive'` con `interactive.button_reply.id` (ej. `evt_going:<eventId>`, `evt_confirm_yes:<eventId>`, `prop_approve:<eventId>`).

Nuevo branch temprano:
- Si el payload es `interactive` → `POST /api/internal/agenda/button-reply { messageId }`.
  - La app decodifica el `button_reply.id`, identifica acción + entidad, y rutea internamente:
    - `evt_going|evt_not_going|evt_maybe` → actualiza `event_attendees`.
    - `evt_confirm_yes|no|edit` → resuelve la pre-confirmación del evento.
    - `prop_approve|prop_reject` → aprueba/rechaza la propuesta.
  - Devuelve confirmación de texto al usuario por la ventana de 24h (que se abre justo porque tocó el botón).
- Termina el flujo (no pasa por clasificación de intent).

### 3.b — Ramas nuevas en la clasificación de intent

El prompt `classify-intent` ahora puede devolver `event_create` o `event_confirmation_reply` (ver prompts.md). Branches:

- **`event_create`** → `POST /api/internal/agenda/parse-event { messageId }`.
  - App: Haiku parsea el evento → crea `events` en `pending_confirmation` → manda mensaje de confirmación con botones SÍ/NO/EDITAR (template `agenda_invitation` variante confirmación, o interactive).
- **`event_confirmation_reply`** (el usuario respondió en texto, no botón, a una confirmación pendiente) → `POST /api/internal/agenda/confirm-creation { messageId }`.
  - App: si hay un evento del usuario en `pending_confirmation`, interpreta "sí/no/cambiá X" y resuelve. Si es edición, re-parsea fusionando.

> El ruteo de "¿este texto es una edición de un evento pendiente?" se resuelve igual que `report_followup_reply`: si el usuario tiene un `event` en `pending_confirmation`, su próximo mensaje libre se trata como `event_confirmation_reply`. Esa heurística va en el endpoint `inbound`, no en n8n.

---

## 4. `weekly-trigger-send` (MODIFICADO)

Hoy manda el disparo genérico del viernes (jueves 10:00). Se enriquece para incluir los eventos cumplidos de la semana por usuario.

**Cambio**: el loop por usuario ya existe. Antes de enviar, llama (o el endcpoint `send-trigger` ya resuelve internamente):
- `GET /api/internal/agenda/user-week-events?userId=&cycleId=` → eventos `confirmed`/`done` creados por el usuario en el rango del ciclo.
- Si hay eventos, el cuerpo del mensaje incluye: *"Esta semana tenías agendado: X, Y, Z. Contame cómo te fue con cada uno."*

> Restricción Meta: el disparo es proactivo → template. El template `atepsa_weekly_kickoff` necesita una variable extra para la lista de eventos, o se manda como segundo mensaje de texto si la ventana de 24h está abierta. Definir al crear el template. Ver riesgos.md (ventana 24h).

---

## Resumen de integración con ausencias

Ningún workflow nuevo consulta ausencias directamente: lo hace la app en cada endpoint (`parse-event` al generar attendees, `dispatch` al re-validar). La regla `absence.starts_on <= event.starts_at::date <= absence.ends_on` se centraliza en un helper `isUserOnLeave(userId, date)`.

## Crons resultantes en el sistema (panorama)

| Cron | Hora ART | Dominio |
|---|---|---|
| `cycle-bootstrap` | Lun 00:05 | reportes |
| `agenda-event-done-check` | Diario 00:30 | **agenda** |
| `weekly-trigger-send` | Jue 10:00 | reportes (+agenda) |
| `weekly-reminder-send` | Vie 12:00 | reportes |
| `weekly-cycle-close` | Vie 18:00 | reportes |
| `weekly-process` | Vie 19:00 | reportes |
| `weekly-delivery-send` | Lun 08:00 | reportes |
| `escalation-check` | Lun 09:00 | reportes |
| `agenda-notifications-dispatch` | **cada 5 min** | **agenda** |

> Recordatorio de infra (memoria del proyecto): los crons de n8n se re-crean en restart y el timezone está en ART. Verificar al deployar que los dos crons nuevos quedaron activos.
