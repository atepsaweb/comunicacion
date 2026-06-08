# Análisis del proyecto existente

Relevamiento hecho el 2026-06-07 antes de diseñar el módulo. Qué hay, qué se reutiliza, qué se construye nuevo.

---

## Stack confirmado en código (no solo en docs)

- **Next.js 14 App Router**, TypeScript strict, sin `any`.
- **PostgreSQL** con todas las tablas en el schema `app` (`pgSchema('app')` en `db/schema/users.ts`). **Importante**: cualquier tabla nueva del módulo va en `appSchema`, no en `public`.
- **Drizzle ORM**, PK `uuid` con `$defaultFn(() => uuidv7())` en todas las tablas. Timestamps `withTimezone: true`.
- **WhatsApp = Meta Cloud API** (WAHA quedó descartado). Cliente en `lib/meta-cloud.ts`, dispatcher en `lib/whatsapp.ts`.
- **Claude** vía `lib/ai/client.ts` (`callAI()`), con logging obligatorio a `ai_invocations` y prompt caching por bloques.
- **Prompts editables** en DB (`getActivePrompt(slug)` en `lib/ai/db-prompts.ts`), con fallback a archivos TS en `lib/ai/prompts/*.ts`.
- **Pino** para logs (`lib/logger.ts`).
- **shadcn/ui mínimo**: solo `button`, `card`, `input`, `label` en `components/ui/`. No hay más primitivas instaladas.
- **Auth**: NextAuth v4 (`lib/auth.ts`), sesión con `session.user.{id, role, full_name}`. Login por access-token (link único) y OTP.

## Tablas existentes relevantes para el módulo

| Tabla | Relevancia para Agenda |
|---|---|
| `users` | Creadores, invitados, aprobadores. Roles `secretary`/`executive`/`press_admin`. |
| `weekly_cycles` | El evento se asocia a un ciclo **calculado por fecha**, sin FK. Para el trigger del viernes y el followup. |
| `absences` | Filtro clave: `starts_on <= fecha_evento <= ends_on` excluye de convocatoria/recordatorio. |
| `reports` / `report_items` | Destino del followup "¿cómo salió?". El ítem se inserta en el report del ciclo del evento. |
| `inbound_messages` | El webhook de WhatsApp ya cae acá; el módulo agrega ramas de clasificación. Tiene `quoted_wamid`/`quoted_body` para threading. |
| `outbound_messages` | Log de toda invitación/recordatorio/followup que mande el bot. |
| `ai_invocations` | Log automático vía `callAI()`. |
| `prompts` | El prompt `parse-event` se siembra acá igual que los 8 actuales. |
| `system_settings` | Defaults de recordatorios, templates de Meta (`whatsapp_meta_templates`). |
| `audit_log` | Auditar creación/edición/cancelación/aprobación de eventos. |

## Qué se reutiliza tal cual (sin tocar)

- `validateInternalSecret(req)` — protege todos los `/api/internal/agenda/*`.
- `callAI()` + `parseAIJson()` — para `parse-event`.
- `getActivePrompt('parse-event')` — patrón idéntico a los prompts actuales.
- `sendWhatsAppText()` y `sendWhatsAppTemplate()` — confirmaciones y fallback.
- Patrón de inserción en `outbound_messages` tras cada envío (ver `messages/absence/route.ts` como referencia canónica).
- `PanelShell` + `SidebarNav` — solo se agregan ítems al array `navItems`.
- `Card`/`CardHeader`/`CardContent` — para las vistas.
- Patrón page.tsx server + `*-client.tsx` para vistas con interacción (ej. `ausencias`, `usuarios`).
- Exportación a Excel con `xlsx` (SheetJS), ya usada en `exports/cumplimiento.xlsx` — se replica para el tablero de confirmaciones.
- Cálculo de ISO week + lunes UTC: copiar de `cycles/ensure-next/route.ts` (`getISOWeekAndYear`, `isoWeekToMondayUTC`). **No reescribir**, extraer a helper compartido si conviene.

## Qué hay que extender (modifica código/SQL existente)

1. **Enums** (migración nueva, valores agregados):
   - `messageIntentEnum` += `event_create`, `event_confirmation_reply`
   - `outboundPurposeEnum` += `event_invitation`, `event_reminder`, `event_followup`, `event_proposal`
   - `aiPurposeEnum` += `parse_event`
2. **`lib/meta-cloud.ts`**: agregar `sendMetaInteractive(phone, body, buttons[])` (tipo `interactive` / `button`). Hoy solo hay texto y template.
3. **Webhook entrante / `inbound-message-handle`**: parsear `messages[0].type === 'interactive'` con `interactive.button_reply.id`. Hoy solo maneja text/audio/document.
4. **`inbound-message-handle`**: dos ramas nuevas (`event_create`, `event_confirmation_reply`) + ruteo de respuestas de botones a los endpoints de agenda.
5. **`weekly-trigger-send`**: enriquecer el mensaje del viernes con la lista de eventos cumplidos de la semana por usuario.
6. **`SidebarNav`**: sección Agenda.

## Qué no existe y se construye nuevo

- **Librería de calendario**: no hay ninguna en `package.json`. Se instala `react-big-calendar` + `date-fns` (decisión 2).
- **Generación de feeds iCal**: nada. Se construye el serializador `.ics` (a mano, formato simple VEVENT, o `ical-generator` si se aprueba la dependencia).
- **Tabla de tokens iCal**: los `access_tokens` de login no sirven (otra semántica). Tabla nueva `ical_tokens`.
- **Cron de notificaciones sub-diario**: todos los crons actuales son semanales. El módulo necesita uno **horario** para acertar las ventanas de 2h/12h.
- **Botones interactivos**: la capacidad existe en Meta pero no está implementada.

## Decisiones que tomé en consecuencia

- **Eventos en schema `app`**, UUID v7, timestamptz: consistente con todo lo demás.
- **Sin FK evento→ciclo**: el ciclo se deriva de `starts_at`. Permite agendar a futuro sin que el ciclo exista. Para queries del trigger/followup se busca por rango de fechas.
- **Pre-confirmación como estado del evento** (`pending_confirmation`), no como tabla aparte: reusa el patrón conversacional de `reports.status='awaiting_followup'`. El próximo mensaje del creador con un evento en ese estado se trata como edición.
- **Propuestas = `events.status='proposed'`**, no tabla `event_proposals` separada: la bandeja es un query filtrado. Menos superficie, misma funcionalidad.
- **Notificaciones pre-computadas** en tabla `event_notifications`: al confirmar el evento se generan las filas pendientes. El cron solo despacha. Esto hace trivial enforcement del tope de 4 y la personalización por evento.
- **Texto de invitación/recordatorio = templates de Meta**, no generado por IA: los mensajes proactivos (fuera de ventana 24h) obligan a template aprobado. La IA solo interpreta el evento al cargarlo.

## Observaciones / deuda detectada (fuera de scope, no tocar en este módulo salvo pedido)

- `SidebarNav` oculta "Logs Auditoría" con comentario "tabla sin datos aún", pero `audit_log` ya recibe escrituras. Inconsistencia menor, no bloquea.
- `cycles/ensure-next/route.ts` duplica lógica de ISO week que probablemente esté repetida en otros endpoints de ciclos. Candidato a extraer a `lib/dates.ts`. El módulo Agenda va a necesitar lo mismo (mapear fecha→ciclo), así que conviene extraerlo en la Fase A1 y reusar.
- El cálculo de "lunes de la semana" en `messages/absence/route.ts` usa UTC directo (comentado como "good enough"). Para eventos con hora puntual en ART (UTC-3) hay que ser más cuidadoso: almacenar `timestamptz` y convertir a `America/Argentina/Buenos_Aires` al mostrar, como ya hace el dashboard (`formatCloseDate`).
