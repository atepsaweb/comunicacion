# Endpoints API — Módulo Agenda

Convenciones del proyecto:
- `/api/internal/*` → `validateInternalSecret(req)` (consume n8n).
- `/api/*` (panel) → `getServerSession(authOptions)`.
- `/api/admin/*` o acciones de Mesa Ejecutiva → además check de `role`.
- Mutaciones administrativas escriben `audit_log`.
- Errores de boundary (Meta, Claude) capturados; internos dejan crashear.

Permisos:
- `secretary`: crea eventos `personal`; *propone* `secretariat`/`mobilization`.
- `executive` y `press_admin`: crean y aprueban todo directamente.

---

## Internos (n8n)

### `POST /api/internal/agenda/parse-event`
Body `{ messageId }`. Parsea con Haiku, crea `events` en `pending_confirmation`, envía confirmación con botones SÍ/NO/EDITAR. Devuelve `{ eventId, status, clarificationNeeded }`.

### `POST /api/internal/agenda/confirm-creation`
Body `{ messageId }`. El usuario respondió en **texto** a una confirmación pendiente. Interpreta sí/no/edición. Resuelve el evento: → `confirmed` (si es personal o el creador es exec/press_admin) | → `proposed` (si secretary común crea institucional) | re-parse (edición) | `cancelled` (no). Devuelve `{ eventId, status }`.

### `POST /api/internal/agenda/button-reply`
Body `{ messageId }`. Decodifica `interactive.button_reply.id` y rutea:
- `evt_confirm_yes|no|edit:<id>` → resuelve pre-confirmación.
- `evt_going|not_going|maybe:<id>` → upsert `event_attendees`.
- `prop_approve|reject:<id>` → aprueba/rechaza propuesta (valida rol del que toca).
Devuelve `{ action, entityId, ok }`. Manda ack de texto al usuario.

### `POST /api/internal/agenda/notifications/dispatch`
Sin body. Lo llama el cron horario. Procesa `event_notifications` pendientes con re-validación, envía templates, registra `outbound_messages`. Devuelve `{ sent, skipped, failed }`. **Idempotente**.

### `POST /api/internal/agenda/events/mark-done`
Sin body. Cron diario. Marca `done` los vencidos, asegura filas `followup`. Devuelve `{ markedDone, followupsScheduled }`.

### `POST /api/internal/agenda/events/:id/outcome`
Body `{ messageId }`. Procesa respuesta a "¿cómo salió?": guarda `outcome_md`, corre `extract-report` contra el report del ciclo del evento, linkea `outcome_report_item_id`. Devuelve `{ reportItemId }`.

### `GET /api/internal/agenda/user-week-events?userId=&cycleId=`
Eventos `confirmed`/`done` del usuario en el rango del ciclo. Para enriquecer `weekly-trigger-send`. Devuelve `{ events: [...] }`.

---

## Panel — eventos (`/api/agenda/*`)

### `GET /api/agenda/events?from=&to=&view=&type=`
Lista eventos visibles para el usuario según rol y tipo:
- `personal`: solo los propios.
- `secretariat`/`mobilization`: todos los `confirmed`/`done`.
- `proposed`: solo visibles a exec/press_admin (bandeja).
Filtros `view` (week/month/day/mine/mobilizations) y rango. Devuelve `{ events: [...] }`.

### `POST /api/agenda/events`
Crear desde el panel. Body `{ title, description_md?, type, starts_at, ends_at?, all_day?, location?, requires_confirmation?, reminder_config?, is_important? }`.
- `is_important` solo lo acepta si el rol es `executive`/`press_admin`; un `secretary` que lo mande recibe 403 (o se ignora). Default `true` para `mobilization`.
- Si creador es exec/press_admin → `confirmed` directo (genera attendees + notifications).
- Si secretary y `type !== 'personal'` → `proposed`.
- Si `personal` → `confirmed` sin attendees.
Audita `event.created`. Devuelve `{ event }`.

### `PATCH /api/agenda/events/:id`
Editar. Solo creador o exec/press_admin. Si cambia `starts_at` de un evento con convocatoria → re-agenda `event_notifications` y dispara `cancellation`/aviso de reprogramación (exento del tope). Audita `event.updated` con before/after.

### `POST /api/agenda/events/:id/cancel`
Body `{ reason? }`. Marca `cancelled`, cancela notificaciones `pending`, envía `cancellation` a convocados que ya recibieron algo. Audita `event.cancelled`.

### `POST /api/agenda/events/:id/approve`  *(exec/press_admin)*
Pasa `proposed` → `confirmed`. Setea `approved_by`/`approved_at`. Genera attendees + notifications. Audita `event.approved`.

### `POST /api/agenda/events/:id/reject`  *(exec/press_admin)*
Body `{ reason? }`. `proposed` → `cancelled`. Notifica al proponente. Audita `event.rejected`.

### `POST /api/agenda/events/:id/attendance`
Confirmar asistencia **desde el panel**. Body `{ status: 'going'|'not_going'|'maybe' }`. Upsert `event_attendees` con `response_source='panel'`. Devuelve `{ attendee }`.

### `GET /api/agenda/events/:id/attendees`
Tablero del evento: lista de los 27 con su estado (incluye `on_leave`). Para la vista de detalle. Devuelve `{ attendees: [...], summary: { going, not_going, maybe, no_response, on_leave } }`.

### `GET /api/agenda/board.xlsx?eventId=` *(exec/press_admin)*
Exporta el tablero de confirmaciones a Excel (patrón `exports/cumplimiento.xlsx` con SheetJS).

---

## Panel — preferencias de notificación (`/api/agenda/notification-prefs`)

### `GET /api/agenda/notification-prefs`
Preferencias del usuario logueado (su fila de `agenda_notification_prefs`, o defaults si no tiene). Devuelve `{ prefs }`.

### `PUT /api/agenda/notification-prefs`
Upsert. Body `{ prefs }` (forma de `agenda_notification_prefs.prefs`). El secretario elige qué recordatorios recibe por tipo de evento. **No** afecta eventos `is_important`. Devuelve `{ prefs }`.

---

## Panel — iCal tokens (`/api/agenda/ical-tokens/*`)

### `GET /api/agenda/ical-tokens`
Los 3 tokens del usuario logueado (uno por scope, el activo). Devuelve `{ tokens: [{ scope, url, last_accessed_at, created_at }] }`. La URL es `https://panel.atepsa.org.ar/api/ical/<token>.ics`.

### `POST /api/agenda/ical-tokens/:scope/regenerate`
Revoca el token activo de ese scope y crea uno nuevo. `scope ∈ {all, secretariat, personal}`. Devuelve `{ token, url }`.

### `DELETE /api/agenda/ical-tokens/:scope`
Revoca sin regenerar (deja el scope sin feed). Devuelve `{ ok }`.

---

## Feed público iCal (sin auth de sesión)

### `GET /api/ical/[token].ics`
- Resuelve `token` en `ical_tokens` (no revocado). Si no existe/revocado → 404.
- Según `scope`, arma la lista de eventos del usuario:
  - `personal`: sus eventos `personal`.
  - `secretariat`: eventos `secretariat`/`mobilization` `confirmed`/`done`.
  - `all`: ambos (según `agenda_ical_include_personal_in_all`).
- Serializa `text/calendar` (VCALENDAR + VEVENTs).
- Actualiza `last_accessed_at`.
- **Solo lectura.** Sin datos sensibles más allá de título/fecha/lugar.
- Headers: `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, max-age=900`, `ETag` por hash del contenido (responder `304` si coincide) para aliviar los refresh de Google/Apple Calendar.

---

## Notas de implementación

- **`button_reply.id` formato**: `<accion>:<entityId>` (ej. `evt_going:01J...`). Límite de Meta: 256 chars en el id, 20 en el title del botón. UUID v7 entra cómodo.
- **Generación de token iCal**: reusar el generador url-safe de `lib/access-tokens.ts`.
- **Helper compartido**: `isUserOnLeave(userId, dateISO)` y `cycleKeyForDate(date)` en `lib/dates.ts` (Fase A1), usados por varios endpoints.
- **Re-validación en dispatch**: el endpoint de dispatch es el único lugar que envía recordatorios; concentra ahí las reglas de audiencia por `kind` y el tope de 4.
